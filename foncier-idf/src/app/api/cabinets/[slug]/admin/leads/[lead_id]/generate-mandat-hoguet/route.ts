/**
 * POST /api/cabinets/{slug}/admin/leads/{lead_id}/generate-mandat-hoguet
 *
 * Génère un mandat Hoguet (vente / recherche / mise en location /
 * recherche bien locatif) à partir des données du lead.
 *
 * Body JSON (optionnel — sinon lu depuis dim_cabinet_leads) :
 *   {
 *     mandat_type:        "vente" | "recherche_acquereur" |
 *                         "mise_en_location" | "recherche_bien_locatif",
 *     mandat_modalite:    "simple" | "exclusif" | "semi_exclusif",
 *     duree_mois:         number (1-36),
 *     commission_pct:     number (0-20),
 *     prix_net_vendeur:   number,
 *     prix_max:           number
 *   }
 *
 * Réponse : { docx_url, filename, hash_sha256, numero_registre,
 *             template_used }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getAdminSession } from "@/lib/admin-auth";
import { generateMandatHoguet } from "@/lib/contracts/generate-mandat-hoguet";
import {
  extractRequestContext,
  logPIIAccess,
} from "@/lib/rgpd/log-pii-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; lead_id: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug, lead_id } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  // ---- Auth ----
  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ---- Body params (optionnels) ----
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // body optionnel
  }

  const supabase = getSupabase();

  try {
    const result = await generateMandatHoguet({
      supabase,
      leadId: lead_id,
      cabinetSlug: slug,
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

    // Log RGPD
    const reqCtx = extractRequestContext(req);
    await logPIIAccess({
      supabase,
      cabinetSlug: slug,
      actorEmail: session.email,
      actorRole: "admin",
      resourceType: "lead",
      resourceId: lead_id,
      action: "UPDATE",
      ip: reqCtx.ip,
      userAgent: reqCtx.userAgent,
      endpoint: reqCtx.endpoint,
      httpMethod: reqCtx.httpMethod,
      metadata: {
        action_type: "generate_mandat_hoguet",
        template: result.template_used,
        numero_registre: result.numero_registre,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown_error";
    console.error("[generate-mandat-hoguet] error:", msg);
    return NextResponse.json(
      { error: "generation_failed", message: msg },
      { status: 500 },
    );
  }
}
