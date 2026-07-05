import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getAdminSession } from "@/lib/admin-auth";

/**
 * Sous-densite fonciere (PLU reel + DPE passoire + persona) — reserve aux
 * cabinets avec un abonnement DATAMERRY Pro actif (trialing/active/past_due).
 *
 * Auth en 2 temps, comme partout ailleurs dans /api/cabinets/[slug]/admin/* :
 *   1. session cabinet (cookie dm_admin_session) -> 401 sinon
 *   2. abonnement actif (v_cabinet_billing_status) -> 403 sinon
 * Pattern de check d'abonnement IDENTIQUE a celui deja ecrit dans
 * src/app/cabinets/[slug]/admin/billing/page.tsx (hasActiveSub).
 */

// A synchroniser avec destinations.py (prototype) si la nomenclature evolue.
const PERSONA_DESTINATIONS: Record<string, string[]> = {
  logement: ["logement", "hebergement"],
  commerce: ["commerce_detail", "restauration", "activites_services", "commerce_gros"],
  hotellerie: ["hebergement_hotelier"],
  bureau: ["bureau"],
  logistique: ["entrepot"],
  industrie: ["industrie"],
  sante: ["equipement_sante"],
};

const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  // 1. Auth session (meme pattern que toutes les routes /admin/*)
  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = getSupabaseServerClient();

  // 2. Verification abonnement actif
  const { data: subData } = await sb
    .from("v_cabinet_billing_status")
    .select("status")
    .eq("cabinet_slug", slug)
    .maybeSingle();

  const hasActiveSub =
    subData && ACTIVE_STATUSES.includes((subData as { status: string }).status);
  if (!hasActiveSub) {
    return NextResponse.json(
      {
        error: "subscription_required",
        message: "Fonctionnalite reservee aux abonnes DATAMERRY Pro.",
      },
      { status: 403 }
    );
  }

  // 3. Filtres
  const sp = req.nextUrl.searchParams;
  const insee = sp.get("insee");
  const persona = sp.get("persona"); // logement|commerce|hotellerie|bureau|logistique|industrie|sante
  const dpeFilter = sp.get("dpe"); // "any"|"copro"|"maison"
  const minResidual = Number(sp.get("min_residual") ?? "0");
  const limit = Math.min(Number(sp.get("limit")) || 100, 500);

  if (!insee) {
    return NextResponse.json(
      { error: "insee_required", message: "Parametre 'insee' requis." },
      { status: 400 }
    );
  }

  let query = sb
    .from("v_parcel_sous_densite")
    .select(
      "parcel_id, insee_code, city_name, area_m2, mutability_score, best_use, " +
        "plu_zone_code, ces_applied, ces_source, max_height_est, residual_potential_est, " +
        "estimated_gfa, dpe_passoire_any, dpe_passoire_copro, dpe_passoire_maison, " +
        "nb_groupes_passoire, destinations_autorisees, plu_reel_a_verifier, geom"
    )
    .eq("insee_code", insee)
    .gte("residual_potential_est", minResidual)
    .order("mutability_score", { ascending: false })
    .limit(limit);

  if (dpeFilter === "any") query = query.eq("dpe_passoire_any", true);
  if (dpeFilter === "copro") query = query.eq("dpe_passoire_copro", true);
  if (dpeFilter === "maison") query = query.eq("dpe_passoire_maison", true);
  if (persona && PERSONA_DESTINATIONS[persona]) {
    query = query.overlaps("destinations_autorisees", PERSONA_DESTINATIONS[persona]);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "query_failed", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ count: data?.length ?? 0, items: data ?? [] });
}
