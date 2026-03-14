import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { ParcelDetail } from "@/lib/foncier-types";

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from("v_parcel_foncier")
      .select(
        `
        parcel_id,
        insee_code,
        section,
        number,
        area_m2,
        city_name,
        mutability_score,
        best_use,
        land_value_est,
        program_value_est,
        explanation_json,
        dominant_zone_family,
        estimated_gfa,
        residual_potential_est,
        underuse_ratio,
        median_price_m2
        `
      )
      .eq("parcel_id", id)
      .single();

    if (error) {
      console.error("API /foncier/parcelle/[id] error:", error);
      const notFound = error.code === "PGRST205" || error.message?.includes("schema cache");
      return NextResponse.json(
        { error: notFound
            ? "Tables foncières non initialisées. Exécutez le schéma SQL."
            : "Parcelle introuvable." },
        { status: 404 }
      );
    }

    return NextResponse.json(data as ParcelDetail);
  } catch (e) {
    console.error("Unexpected /foncier/parcelle/[id] error:", e);
    return NextResponse.json(
      { error: "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}
