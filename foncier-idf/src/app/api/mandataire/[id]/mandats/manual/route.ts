/**
 * POST /api/mandataire/{id}/mandats/manual
 *
 * Crée un nouveau lead + génère le mandat Hoguet en une seule transaction.
 * Pour les cas où Diara a un client en main directement (sans pré-lead).
 *
 * Body JSON :
 *   {
 *     visitor_name, visitor_email, visitor_phone, address, type_bien,
 *     surface, description?, intent (par défaut "vendeur"),
 *     mandat_type, mandat_modalite, duree_mois, commission_pct,
 *     commission_charge ("vendeur" | "acquereur"),
 *     prix_net_vendeur (si vente), prix_max (si recherche)
 *   }
 *
 * Auth : UUID en URL (pattern workspace).
 *
 * Gates :
 *   1. UUID mandataire valide
 *   2. Mandataire trouvé + contract_signed_at NOT NULL
 *   3. Champs minimum requis (visitor_name, address, mandat_type)
 *
 * Réponse : { lead_id, docx_url, filename, hash_sha256, numero_registre, template_used }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { generateMandatHoguet } from "@/lib/contracts/generate-mandat-hoguet";
import {
  extractRequestContext,
  logPIIAccess,
} from "@/lib/rgpd/log-pii-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_mandataire_id" }, { status: 400 });
  }

  const supabase = getSupabase();

  // 1. Vérifier mandataire + contrat signé
  const { data: mandataire, error: mErr } = await supabase
    .from("eurealimmo_mandataires")
    .select("id, first_name, last_name, email, contract_signed_at")
    .eq("id", id)
    .maybeSingle();

  if (mErr || !mandataire) {
    return NextResponse.json({ error: "mandataire_not_found" }, { status: 404 });
  }
  if (!mandataire.contract_signed_at) {
    return NextResponse.json(
      {
        error: "contract_not_signed",
        message:
          "Votre contrat de mandataire commercial Eurealimmo n'est pas encore signé. La génération de mandats Hoguet est désactivée tant que l'activation opérationnelle n'a pas eu lieu.",
      },
      { status: 403 },
    );
  }

  // 2. Lire le body
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const visitor_name = String(body.visitor_name ?? "").trim();
  const visitor_email = String(body.visitor_email ?? "").trim();
  const visitor_phone = String(body.visitor_phone ?? "").trim();
  const address = String(body.address ?? "").trim();
  const type_bien = String(body.type_bien ?? "Appartement").trim();
  const surface = body.surface ? Number(body.surface) : null;
  const cabinet_slug = String(body.cabinet_slug ?? "eurealimmo").trim();

  if (!visitor_name || !address) {
    return NextResponse.json(
      { error: "missing_fields", message: "visitor_name et address sont requis" },
      { status: 400 },
    );
  }

  // 3. Créer le lead
  const { data: leadIns, error: leadErr } = await supabase
    .from("dim_cabinet_leads")
    .insert({
      cabinet_slug,
      mandataire_id: id,
      visitor_name,
      visitor_email: visitor_email || null,
      visitor_phone: visitor_phone || null,
      address,
      type_bien,
      surface,
      intent: String(body.intent ?? "vendeur"),
      consentement: true,
      status: "mandat_signe",
      mandat_type: String(body.mandat_type ?? "vente"),
      mandat_modalite: String(body.mandat_modalite ?? "simple"),
      mandat_duree_mois: body.duree_mois ? Number(body.duree_mois) : 3,
      mandat_commission_pct: body.commission_pct ? Number(body.commission_pct) : 5,
      mandat_commission_charge: String(body.commission_charge ?? "acquereur"),
      mandat_prix_net_vendeur: body.prix_net_vendeur ? Number(body.prix_net_vendeur) : null,
      mandat_prix_max: body.prix_max ? Number(body.prix_max) : null,
      mandat_signe_at: new Date().toISOString(),
      wizard_answers: {
        manual_creation: true,
        creation_source: "mandataire_workspace_manual",
        description: body.description ?? null,
      },
    })
    .select("id")
    .single();

  if (leadErr || !leadIns) {
    return NextResponse.json(
      {
        error: "lead_creation_failed",
        message: leadErr?.message ?? "Échec création lead",
      },
      { status: 500 },
    );
  }

  const lead_id = (leadIns as { id: string }).id;

  // 4. Générer le mandat
  try {
    const result = await generateMandatHoguet({
      supabase,
      leadId: lead_id,
      cabinetSlug: cabinet_slug,
      mandatType: body.mandat_type as
        | "vente"
        | "recherche_acquereur"
        | "mise_en_location"
        | "recherche_bien_locatif"
        | undefined,
      mandatModalite: body.mandat_modalite as
        | "simple"
        | "exclusif"
        | "semi_exclusif"
        | undefined,
      dureeMois: body.duree_mois as number | undefined,
      commissionPct: body.commission_pct as number | undefined,
      commissionCharge: body.commission_charge as
        | "vendeur"
        | "acquereur"
        | undefined,
      prixNetVendeur: body.prix_net_vendeur as number | undefined,
      prixMax: body.prix_max as number | undefined,
    });

    // 5. Log RGPD
    const reqCtx = extractRequestContext(req);
    await logPIIAccess({
      supabase,
      cabinetSlug: cabinet_slug,
      actorEmail: mandataire.email,
      actorRole: "mandataire",
      resourceType: "lead",
      resourceId: lead_id,
      action: "UPDATE",
      ip: reqCtx.ip,
      userAgent: reqCtx.userAgent,
      endpoint: reqCtx.endpoint,
      httpMethod: reqCtx.httpMethod,
      metadata: {
        action_type: "manual_mandat_creation",
        mandataire_id: id,
        mandataire_name: `${mandataire.first_name} ${mandataire.last_name}`,
        template: result.template_used,
        numero_registre: result.numero_registre,
      },
    });

    return NextResponse.json({
      ok: true,
      lead_id,
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[mandats/manual] generation error:", msg);
    return NextResponse.json(
      { error: "generation_failed", message: msg, lead_id },
      { status: 500 },
    );
  }
}
