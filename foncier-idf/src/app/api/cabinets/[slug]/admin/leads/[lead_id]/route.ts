/**
 * GET /api/cabinets/{slug}/admin/leads/{lead_id}
 *   Détail complet d'un lead avec son historique de statuts.
 *
 * PATCH /api/cabinets/{slug}/admin/leads/{lead_id}
 *   Mise à jour des champs workflow CRM/ERP : planification visite, signature
 *   mandat (type, durée, commission, prix), marquer vente. Trace l'historique
 *   pour traçabilité légale (loi Hoguet + déontologie).
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

// Colonnes lecture seule pour le détail lead — incluent les champs mandat
// (migration 36) + anchor status via la vue v_cabinet_registre_mandats_extended.
const LEAD_SELECT_COLUMNS =
  "id, cabinet_slug, visitor_name, visitor_email, visitor_phone, " +
  "intent, type_bien, address, surface, wizard_answers, " +
  "prix_m2_median, prix_m2_p10, prix_m2_p90, prix_total_median, nb_ventes, " +
  "email_to_cabinet_sent, email_to_visitor_sent, status, " +
  "cabinet_notes, notes_agent, created_at, updated_at, " +
  // Champs mandat (migration 36)
  "mandat_type, mandat_modalite, mandat_signe_at, mandat_duree_mois, " +
  "mandat_date_fin, mandat_commission_pct, mandat_prix_net_vendeur, " +
  "mandat_prix_max, mandat_numero_registre, mandat_criteres_recherche, " +
  "visite_planifiee_at, visite_realisee_at, visite_notes, " +
  "vente_prix_final, vente_date, vente_compromis_date";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; lead_id: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug, lead_id } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = getSupabase();

  const { data: lead, error } = await sb
    .from("dim_cabinet_leads")
    .select(LEAD_SELECT_COLUMNS)
    .eq("id", lead_id)
    .eq("cabinet_slug", slug)
    .maybeSingle();

  if (error) {
    console.error("[admin/leads/detail] query error:", error);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  // Historique des statuts
  const { data: history } = await sb
    .from("dim_lead_status_history")
    .select("from_status, to_status, changed_at, changed_by_email, note")
    .eq("lead_id", lead_id)
    .order("changed_at", { ascending: false });

  // Status d'ancrage blockchain (si une entrée dim_mandate_anchor existe)
  const { data: anchor } = await sb
    .from("dim_mandate_anchor")
    .select(
      "id, mandate_hash_sha256, anchor_status, merkle_root_batch_id, " +
        "solana_tx_sig, solana_slot, anchored_at, triggered_by_email, " +
        "error_message, retry_count, created_at, updated_at",
    )
    .eq("lead_id", lead_id)
    .maybeSingle();

  return NextResponse.json({ lead, history: history ?? [], anchor: anchor ?? null });
}

// ──────────────────────────────────────────────────────────────────────────
// PATCH — mise à jour des champs workflow + mandat
// ──────────────────────────────────────────────────────────────────────────

// Champs autorisés en update (whitelist anti-injection)
const UPDATABLE_FIELDS = new Set([
  // Workflow visite
  "visite_planifiee_at",
  "visite_realisee_at",
  "visite_notes",
  // Mandat (signe / type / modalité / durée / com / prix / numéro / critères)
  "mandat_type",
  "mandat_modalite",
  "mandat_signe_at",
  "mandat_duree_mois",
  "mandat_commission_pct",
  "mandat_prix_net_vendeur",
  "mandat_prix_max",
  "mandat_criteres_recherche",
  // Vente finale
  "vente_prix_final",
  "vente_date",
  "vente_compromis_date",
  // Notes libres agent
  "notes_agent",
]);

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; lead_id: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug, lead_id } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Filtre les champs autorisés
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (UPDATABLE_FIELDS.has(key)) {
      patch[key] = body[key];
    }
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_updatable_fields" }, { status: 400 });
  }

  // Validations métier
  if (patch.mandat_type !== undefined && patch.mandat_type !== null) {
    if (!["vente", "recherche", "location"].includes(patch.mandat_type as string)) {
      return NextResponse.json({ error: "invalid_mandat_type" }, { status: 400 });
    }
  }
  if (patch.mandat_modalite !== undefined && patch.mandat_modalite !== null) {
    if (!["simple", "exclusif", "semi_exclusif"].includes(patch.mandat_modalite as string)) {
      return NextResponse.json({ error: "invalid_mandat_modalite" }, { status: 400 });
    }
  }
  if (
    patch.mandat_commission_pct !== undefined &&
    patch.mandat_commission_pct !== null &&
    (typeof patch.mandat_commission_pct !== "number" ||
      patch.mandat_commission_pct < 0 ||
      patch.mandat_commission_pct > 20)
  ) {
    return NextResponse.json({ error: "invalid_commission_pct" }, { status: 400 });
  }
  if (
    patch.mandat_duree_mois !== undefined &&
    patch.mandat_duree_mois !== null &&
    (typeof patch.mandat_duree_mois !== "number" ||
      patch.mandat_duree_mois < 1 ||
      patch.mandat_duree_mois > 36)
  ) {
    return NextResponse.json({ error: "invalid_duree_mois" }, { status: 400 });
  }

  const sb = getSupabase();

  // Update + retourne le lead complet pour confirmation côté client
  const { data: updated, error } = await sb
    .from("dim_cabinet_leads")
    .update(patch)
    .eq("id", lead_id)
    .eq("cabinet_slug", slug)
    .select(LEAD_SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    console.error("[admin/leads/PATCH] update error:", error);
    return NextResponse.json({ error: "db_error", detail: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  // ── Ancrage AUTOMATIQUE quand le mandat est signé ────────────────────────
  // Déclenché dès qu'on a mandat_signe_at + mandat_type non-null après update.
  // Idempotent : la RPC queue_mandate_anchor ne touche pas un anchor déjà
  // anchored. Best-effort : si ça échoue (ex: trigger DB), on log mais on
  // ne fait pas planter la requête utilisateur.
  let anchor_auto_triggered = false;
  const u = updated as unknown as {
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

  if (u.mandat_signe_at && u.mandat_type) {
    try {
      const { hash, payload } = computeMandatHash({
        lead_id: u.id,
        cabinet_slug: u.cabinet_slug,
        mandat_type: u.mandat_type,
        mandat_modalite: u.mandat_modalite,
        mandat_signe_at: u.mandat_signe_at,
        mandat_numero_registre: u.mandat_numero_registre,
        mandat_duree_mois: u.mandat_duree_mois,
        mandat_commission_pct: u.mandat_commission_pct,
        mandat_prix_net_vendeur: u.mandat_prix_net_vendeur,
        mandat_prix_max: u.mandat_prix_max,
        visitor_name: u.visitor_name,
        address: u.address,
        type_bien: u.type_bien,
        surface: u.surface,
      });
      const { error: rpcErr } = await sb.rpc("queue_mandate_anchor", {
        p_lead_id: lead_id,
        p_mandate_hash: hash,
        p_canonical_payload: payload,
        p_triggered_by_email: session.email,
      });
      if (rpcErr) {
        console.warn("[admin/leads/PATCH] auto-anchor failed (non-bloquant):", rpcErr);
      } else {
        anchor_auto_triggered = true;
      }
    } catch (e) {
      console.warn("[admin/leads/PATCH] hash compute failed (non-bloquant):", e);
    }
  }

  return NextResponse.json({
    lead: updated,
    updated_fields: Object.keys(patch),
    anchor_auto_triggered,
  });
}
