import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getAdminSession } from "@/lib/admin-auth";

/**
 * Scenarios de redeveloppement sauvegardes par une parcelle (Phase 2c) --
 * reserve aux cabinets avec un abonnement DATAMERRY Pro actif. MEME gate
 * d'auth exact que /api/cabinets/[slug]/foncier/sous-densite/route.ts.
 */

const ACTIVE_STATUSES = ["active", "trialing", "past_due"];
const SCENARIO_TYPES = [
  "demolition_reconstruction",
  "surelevation",
  "construction_neuve_meme_parcelle",
  "changement_usage",
  "strategie_mixte",
];
const PROFILS = ["promoteur", "investisseur", "mixte"];

async function checkAuthAndSub(req: NextRequest, slug: string) {
  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return { ok: false as const, status: 401, body: { error: "unauthorized" } };
  }

  const sb = getSupabaseServerClient();
  const { data: subData } = await sb
    .from("v_cabinet_billing_status")
    .select("status")
    .eq("cabinet_slug", slug)
    .maybeSingle();

  const hasActiveSub =
    subData && ACTIVE_STATUSES.includes((subData as { status: string }).status);
  if (!hasActiveSub) {
    return {
      ok: false as const,
      status: 403,
      body: {
        error: "subscription_required",
        message: "Fonctionnalite reservee aux abonnes DATAMERRY Pro.",
      },
    };
  }

  return { ok: true as const, sb };
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  const auth = await checkAuthAndSub(req, slug);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  const parcelId = req.nextUrl.searchParams.get("parcel_id");
  if (!parcelId) {
    return NextResponse.json(
      { error: "parcel_id_required", message: "Parametre 'parcel_id' requis." },
      { status: 400 }
    );
  }

  const { data, error } = await auth.sb
    .from("parcel_scenarios")
    .select(
      "id, parcel_id, scenario_type, profil, gating_ok, gating_reasons, hypotheses_json, resultat_json, created_at, updated_at"
    )
    .eq("parcel_id", parcelId)
    .eq("cabinet_slug", slug)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "query_failed", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ count: data?.length ?? 0, items: data ?? [] });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> }
) {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  const auth = await checkAuthAndSub(req, slug);
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status });

  let body: {
    parcel_id?: string;
    scenario_type?: string;
    profil?: string;
    gating_ok?: boolean;
    gating_reasons?: unknown;
    hypotheses_json?: unknown;
    resultat_json?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.parcel_id) {
    return NextResponse.json(
      { error: "parcel_id_required", message: "Champ 'parcel_id' requis." },
      { status: 400 }
    );
  }
  if (!body.scenario_type || !SCENARIO_TYPES.includes(body.scenario_type)) {
    return NextResponse.json(
      {
        error: "scenario_type_invalide",
        message: `Champ 'scenario_type' requis, une valeur parmi : ${SCENARIO_TYPES.join(", ")}.`,
      },
      { status: 400 }
    );
  }
  const profil = body.profil && PROFILS.includes(body.profil) ? body.profil : "promoteur";

  const { data, error } = await auth.sb
    .from("parcel_scenarios")
    .insert({
      parcel_id: body.parcel_id,
      scenario_type: body.scenario_type,
      cabinet_slug: slug,
      profil,
      gating_ok: body.gating_ok ?? false,
      gating_reasons: body.gating_reasons ?? null,
      hypotheses_json: body.hypotheses_json ?? {},
      resultat_json: body.resultat_json ?? null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "insert_failed", detail: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json(data, { status: 201 });
}
