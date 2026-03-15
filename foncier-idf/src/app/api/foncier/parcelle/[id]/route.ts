import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import type { ParcelDetail } from "@/lib/foncier-types";

type Params = {
  params: Promise<{ id: string }>;
};

const FULL_SELECT = `
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
  median_price_m2,
  hdbscan_zone_id,
  coverage_ratio,
  existing_gfa_est,
  built_footprint_m2,
  building_count,
  plu_zone_code,
  zone_vocation,
  ces_applied,
  max_height_est,
  setback_front_m,
  setback_side_m,
  nb_logements_est,
  nb_parking_places,
  parking_cost,
  parking_surface_m2,
  taxe_amenagement,
  taxe_amenagement_taux,
  surface_habitable_reelle,
  surface_hab_source,
  dpe_count,
  surface_dvf,
  surface_estimation
`;

const LEGACY_SELECT = `
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
`;

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = getSupabaseServerClient();

    // Try full select (with new columns)
    let { data, error } = await supabase
      .from("v_parcel_foncier")
      .select(FULL_SELECT)
      .eq("parcel_id", id)
      .single();

    // Fallback if new columns don't exist yet
    if (error && error.message?.includes("column")) {
      const fallback = await supabase
        .from("v_parcel_foncier")
        .select(LEGACY_SELECT)
        .eq("parcel_id", id)
        .single();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data = fallback.data as any;
      error = fallback.error;

      // Extract fields from explanation_json if available
      if (data) {
        const ej = (data as Record<string, unknown>).explanation_json as Record<string, unknown> | null;
        (data as Record<string, unknown>).coverage_ratio = ej?.coverage_ratio ?? null;
        (data as Record<string, unknown>).hdbscan_zone_id = null;
        (data as Record<string, unknown>).existing_gfa_est = ej?.existing_gfa_est ?? null;
        (data as Record<string, unknown>).built_footprint_m2 = ej?.built_footprint_m2 ?? null;
        (data as Record<string, unknown>).building_count = ej?.building_count ?? null;
        (data as Record<string, unknown>).plu_zone_code = ej?.plu_zone_code ?? null;
        (data as Record<string, unknown>).zone_vocation = ej?.zone_vocation ?? null;
        (data as Record<string, unknown>).ces_applied = ej?.ces_applied ?? null;
        (data as Record<string, unknown>).max_height_est = ej?.max_height_est ?? null;
        (data as Record<string, unknown>).setback_front_m = ej?.setback_front_m ?? null;
        (data as Record<string, unknown>).setback_side_m = ej?.setback_side_m ?? null;
      }
    }

    if (error) {
      console.error("API /foncier/parcelle/[id] error:", error);
      const notFound = error.code === "PGRST116" || error.code === "PGRST205" || error.message?.includes("schema cache");
      return NextResponse.json(
        { error: notFound
            ? "Parcelle introuvable."
            : "Tables foncières non initialisées. Exécutez le schéma SQL." },
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
