/**
 * POST /api/cabinets/{slug}/admin/leads/{lead_id}/anchor
 *
 * Ancre un mandat signé dans le registre blockchain (file d'attente Merkle).
 *
 * Étapes :
 *   1. Vérifie auth admin du cabinet
 *   2. Récupère le lead + ses champs mandat
 *   3. Vérifie que mandat_signe_at est rempli (sinon erreur)
 *   4. Calcule le hash SHA256 canonique du mandat (RGPD-safe : pas de PII)
 *   5. Appelle la fonction Postgres queue_mandate_anchor pour upsert
 *      dim_mandate_anchor (idempotent : retry safe)
 *   6. Renvoie l'anchor_id + hash + status='pending'
 *
 * Le cron mensuel construira le Merkle Tree et publiera le Root sur Solana
 * (smart contract Anchor Rust en Y2). L'anchor_status passera alors à
 * 'batched' puis 'anchored' avec le solana_tx_sig.
 *
 * Conformité :
 *   - RGPD CNIL 2018-303 : seul le hash est public (irréversible). Données
 *     personnelles restent dans Postgres, effaçables sur demande (art. 17).
 *   - Loi Hoguet : le mandat reste dans le registre interne du cabinet
 *     (dim_cabinet_leads), la blockchain n'est qu'une preuve d'antériorité.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminSession } from "@/lib/admin-auth";
import { computeMandatHash } from "@/lib/mandate/canonical-hash";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type LeadRow = {
  id: string;
  cabinet_slug: string;
  visitor_name: string;
  address: string;
  type_bien: string;
  surface: number | null;
  mandat_type: "vente" | "recherche" | "location" | null;
  mandat_modalite: "simple" | "exclusif" | "semi_exclusif" | null;
  mandat_signe_at: string | null;
  mandat_numero_registre: string | null;
  mandat_duree_mois: number | null;
  mandat_commission_pct: number | null;
  mandat_prix_net_vendeur: number | null;
  mandat_prix_max: number | null;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; lead_id: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug, lead_id } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  // Auth
  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = getSupabase();

  // 1. Récupère le lead
  const { data: leadRaw, error: leadErr } = await sb
    .from("dim_cabinet_leads")
    .select(
      "id, cabinet_slug, visitor_name, address, type_bien, surface, " +
        "mandat_type, mandat_modalite, mandat_signe_at, mandat_numero_registre, " +
        "mandat_duree_mois, mandat_commission_pct, " +
        "mandat_prix_net_vendeur, mandat_prix_max",
    )
    .eq("id", lead_id)
    .eq("cabinet_slug", slug)
    .maybeSingle();

  if (leadErr) {
    console.error("[admin/anchor] lead query error:", leadErr);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!leadRaw) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  // Cast via unknown — Supabase ne sait pas inférer le shape exact depuis
  // une string select() concaténée, mais on connaît la forme à l'exécution.
  const lead = leadRaw as unknown as LeadRow;

  // 2. Validations préalables
  if (!lead.mandat_signe_at) {
    return NextResponse.json(
      { error: "mandat_not_signed", message: "Renseigne d'abord la date de signature du mandat" },
      { status: 400 },
    );
  }
  if (!lead.mandat_type) {
    return NextResponse.json(
      { error: "mandat_type_missing", message: "Le type de mandat (vente/recherche/location) est requis" },
      { status: 400 },
    );
  }

  // 3. Calcule le hash canonique
  const { hash, payload, canonical_json } = computeMandatHash({
    lead_id: lead.id,
    cabinet_slug: lead.cabinet_slug,
    mandat_type: lead.mandat_type,
    mandat_modalite: lead.mandat_modalite,
    mandat_signe_at: lead.mandat_signe_at,
    mandat_numero_registre: lead.mandat_numero_registre,
    mandat_duree_mois: lead.mandat_duree_mois,
    mandat_commission_pct: lead.mandat_commission_pct,
    mandat_prix_net_vendeur: lead.mandat_prix_net_vendeur,
    mandat_prix_max: lead.mandat_prix_max,
    visitor_name: lead.visitor_name,
    address: lead.address,
    type_bien: lead.type_bien,
    surface: lead.surface,
  });

  // 4. Queue l'ancrage via fonction Postgres (idempotent + audit)
  const { data: rpcResult, error: rpcErr } = await sb.rpc("queue_mandate_anchor", {
    p_lead_id: lead_id,
    p_mandate_hash: hash,
    p_canonical_payload: payload,
    p_triggered_by_email: session.email,
  });

  if (rpcErr) {
    console.error("[admin/anchor] rpc error:", rpcErr);
    return NextResponse.json(
      { error: "queue_failed", detail: rpcErr.message },
      { status: 500 },
    );
  }

  // 5. Renvoie l'état d'ancrage à jour pour affichage immédiat
  const { data: anchor } = await sb
    .from("dim_mandate_anchor")
    .select(
      "id, mandate_hash_sha256, anchor_status, merkle_root_batch_id, " +
        "solana_tx_sig, solana_slot, anchored_at, triggered_by_email, " +
        "retry_count, created_at",
    )
    .eq("lead_id", lead_id)
    .maybeSingle();

  return NextResponse.json({
    success: true,
    anchor_id: rpcResult ?? anchor?.id,
    anchor,
    // Le canonical_json est renvoyé pour permettre à l'agent d'inspecter
    // ce qui sera ancré (transparence). Pas affiché par défaut côté UI mais
    // disponible pour le bouton "Voir le hash et son contenu".
    debug: {
      canonical_json,
      hash,
    },
  });
}
