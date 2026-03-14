import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseServerClient();
    const { searchParams } = new URL(req.url);

    const insee = searchParams.get("insee");
    const minScore = Number(searchParams.get("minScore") ?? "0");
    const minArea = Number(searchParams.get("minArea") ?? "0");
    const bestUse = searchParams.get("bestUse");
    const limit = Number(searchParams.get("limit") ?? "100");

    let query = supabase
      .from("v_parcel_foncier")
      .select(
        `
        parcel_id,
        insee_code,
        area_m2,
        mutability_score,
        best_use,
        land_value_est,
        estimated_gfa,
        residual_potential_est
        `
      )
      .gte("mutability_score", minScore)
      .gte("area_m2", minArea)
      .order("mutability_score", { ascending: false })
      .limit(limit);

    if (insee) {
      query = query.eq("insee_code", insee);
    }

    if (bestUse) {
      query = query.eq("best_use", bestUse);
    }

    const { data, error } = await query;

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
