/**
 * POST /api/mandataire/{id}/leads/{lead_id}/generate-mandat-hoguet
 *
 * Permet à un mandataire (ex: Diara) de générer un mandat Hoguet depuis
 * son workspace, pour un lead qui lui est attribué.
 *
 * Auth : UUID mandataire dans l'URL (pattern workspace).
 *
 * Gates :
 *   1. UUID mandataire valide
 *   2. Lead existe ET mandataire_id === uuid de l'URL
 *   3. Mandataire a son contract_signed_at NOT NULL
 *
 * Réponse : { docx_url, filename, hash_sha256, numero_registre, template_used }
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
  ctx: { params: Promise<{ id: string; lead_id: string }> },
): Promise<NextResponse> {
  const { id, lead_id } = await ctx.params;

  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_mandataire_id" }, { status: 400 });
  }
  if (!UUID_RE.test(lead_id)) {
    return NextResponse.json({ error: "invalid_lead_id" }, { status: 400 });
  }

  const supabase = getSupabase();

  // ---- 1. Charger mandataire + vérifier contrat signé ----
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

  // ---- 2. Charger lead + vérifier attribution ----
  const { data: lead, error: lErr } = await supabase
    .from("dim_cabinet_leads")
    .select("id, cabinet_slug, mandataire_id, visitor_name")
    .eq("id", lead_id)
    .maybeSingle();

  if (lErr || !lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }
  if (lead.mandataire_id !== id) {
    return NextResponse.json(
      { error: "lead_not_assigned_to_you" },
      { status: 403 },
    );
  }

  // ---- 3. Body params ----
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // body optionnel
  }

  // ---- 4. Génération ----
  try {
    const result = await generateMandatHoguet({
      supabase,
      leadId: lead_id,
      cabinetSlug: lead.cabinet_slug,
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
      prixNetVendeur: body.prix_net_vendeur as number | undefined,
      prixMax: body.prix_max as number | undefined,
    });

    // ---- 5. Log RGPD (acteur = mandataire) ----
    const reqCtx = extractRequestContext(req);
    await logPIIAccess({
      supabase,
      cabinetSlug: lead.cabinet_slug,
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
        action_type: "generate_mandat_hoguet",
        mandataire_id: id,
        mandataire_name: `${mandataire.first_name} ${mandataire.last_name}`,
        template: result.template_used,
        numero_registre: result.numero_registre,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[mandataire/generate-mandat-hoguet] error:", msg);
    return NextResponse.json(
      { error: "generation_failed", message: msg },
      { status: 500 },
    );
  }
}
