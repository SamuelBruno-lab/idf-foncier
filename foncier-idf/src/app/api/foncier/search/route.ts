import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const FULL_SELECT = `
  parcel_id,
  insee_code,
  city_name,
  area_m2,
  mutability_score,
  best_use,
  estimated_gfa,
  residual_potential_est,
  existing_gfa_est,
  underuse_ratio,
  plu_zone_code
`;

const LEGACY_SELECT = `
  parcel_id,
  insee_code,
  city_name,
  area_m2,
  mutability_score,
  best_use,
  estimated_gfa,
  residual_potential_est,
  underuse_ratio
`;

function buildQuery(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  selectCols: string,
  { insee, minScore, minArea, bestUse, limit }: { insee: string | null; minScore: number; minArea: number; bestUse: string | null; limit: number }
) {
  let query = supabase
    .from("v_parcel_foncier")
    .select(selectCols)
    .gte("mutability_score", minScore)
    .gte("area_m2", minArea)
    .order("mutability_score", { ascending: false })
    .limit(limit);

  if (insee) query = query.eq("insee_code", insee);
  if (bestUse) query = query.eq("best_use", bestUse);
  return query;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseServerClient();
    const { searchParams } = new URL(req.url);

    const params = {
      insee: searchParams.get("insee"),
      minScore: Number(searchParams.get("minScore") ?? "0"),
      minArea: Number(searchParams.get("minArea") ?? "0"),
      bestUse: searchParams.get("bestUse"),
      limit: Number(searchParams.get("limit") ?? "100"),
    };

    let { data, error } = await buildQuery(supabase, FULL_SELECT, params);

    // Fallback if new columns don't exist yet in the view
    if (error && error.message?.includes("column")) {
      const fallback = await buildQuery(supabase, LEGACY_SELECT, params);
      data = (fallback.data ?? []).map((r: Record<string, unknown>) => ({
        ...r,
        existing_gfa_est: 0,
        plu_zone_code: null,
      }));
      error = fallback.error;
    }

    if (error) {
      console.error("API /foncier/search error:", error);
      const notFound = error.code === "PGRST205" || error.message?.includes("schema cache");
      return NextResponse.json(
        { error: notFound
            ? "Tables foncières non initialisées. Exécutez le schéma SQL (sql/08_foncier_schema.sql) dans Supabase."
            : "Erreur lors de la recherche foncière.",
          items: [], count: 0 },
        { status: notFound ? 200 : 500 }
      );
    }

    return NextResponse.json({
      items: data ?? [],
      count: data?.length ?? 0,
    });
  } catch (e) {
    console.error("Unexpected /foncier/search error:", e);
    return NextResponse.json(
      { error: "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}
