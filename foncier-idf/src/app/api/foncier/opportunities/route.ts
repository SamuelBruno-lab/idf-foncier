import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseServerClient();
    const { searchParams } = new URL(req.url);

    const profile = searchParams.get("profile") ?? "promoteur";
    const limit = Number(searchParams.get("limit") ?? "50");
    const insee = searchParams.get("insee");

    let minScore = 7;
    let minArea = 300;
    let minLandValue = 250000;
    let bestUseList = [
      "densification_residentielle",
      "division_parcellaire",
      "dent_creuse",
    ];

    if (profile === "marchand") {
      minScore = 6;
      minArea = 150;
      minLandValue = 100000;
      bestUseList = [
        "division_parcellaire",
        "dent_creuse",
        "analyse_complementaire",
      ];
    }

    let query = supabase
      .from("v_parcel_foncier")
      .select(
        `
        parcel_id,
        insee_code,
        city_name,
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
      .gte("land_value_est", minLandValue)
      .in("best_use", bestUseList)
      .order("mutability_score", { ascending: false })
      .order("land_value_est", { ascending: false })
      .limit(limit);

    if (insee) {
      query = query.eq("insee_code", insee);
    }

    const { data, error } = await query;

    if (error) {
      console.error("API /foncier/opportunities error:", error);
      const notFound = error.code === "PGRST205" || error.message?.includes("schema cache");
      return NextResponse.json(
        { error: notFound
            ? "Tables foncières non initialisées. Exécutez le schéma SQL."
            : "Erreur lors du chargement des opportunités.",
          items: [], count: 0 },
        { status: notFound ? 200 : 500 }
      );
    }

    return NextResponse.json({
      profile,
      count: data?.length ?? 0,
      items: data ?? [],
    });
  } catch (e) {
    console.error("Unexpected /foncier/opportunities error:", e);
    return NextResponse.json(
      { error: "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}
