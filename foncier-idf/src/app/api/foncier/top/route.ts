import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { ParcelTopItem } from "@/lib/foncier-types";

export async function GET(req: NextRequest) {
  try {
    const supabase = getSupabaseServerClient();
    const { searchParams } = new URL(req.url);

    const insee = searchParams.get("insee");
    const limit = Number(searchParams.get("limit") ?? "20");
    const minScore = Number(searchParams.get("minScore") ?? "6");

    if (!insee) {
      return NextResponse.json(
        { error: "Paramètre 'insee' requis." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("v_parcel_foncier")
      .select(
        "parcel_id,insee_code,area_m2,mutability_score,best_use,land_value_est,estimated_gfa,residual_potential_est"
      )
      .eq("insee_code", insee)
      .gte("mutability_score", minScore)
      .order("mutability_score", { ascending: false })
      .order("land_value_est", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("API /foncier/top error:", error);
      return NextResponse.json(
        { error: "Erreur lors de la récupération des parcelles." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      items: (data ?? []) as ParcelTopItem[],
      count: data?.length ?? 0,
    });
  } catch (e) {
    console.error("Unexpected /foncier/top error:", e);
    return NextResponse.json(
      { error: "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}
