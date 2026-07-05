import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Route PUBLIQUE (pas de paywall, coherente avec /api/foncier/parcelle/[id]) --
 * expose uniquement les colonnes AJOUTEES par la Phase 2a (comparatif
 * existant/PLU hauteur + reculs) sans dupliquer tout ParcelDetail. Le
 * simulateur (Phase 2c) combine cette reponse avec le ParcelDetail deja
 * charge par ailleurs (coverage_ratio/ces_applied/max_height_est y sont
 * deja disponibles).
 */

type Params = { params: Promise<{ id: string }> };

const SELECT = `
  parcel_id,
  height_existing_m,
  height_existing_source,
  setback_facade_existing_m,
  setback_lateral_existing_m,
  setback_fond_existing_m,
  nb_facades,
  setback_side_min_m_worst_case,
  setback_side_min_m_range_low,
  setback_side_max_m_range_high,
  setback_rear_min_m_worst_case,
  setback_rear_min_m_range_low,
  setback_rear_max_m_range_high,
  setback_plu_is_range,
  surelevation_possible_hauteur,
  extension_possible_ces
`;

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from("v_parcel_prefaisabilite")
      .select(SELECT)
      .eq("parcel_id", id)
      .maybeSingle();

    if (error) {
      console.error("API /foncier/prefaisabilite/[id] error:", error);
      return NextResponse.json(
        { error: "Donnees de prefaisabilite indisponibles." },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Parcelle introuvable." }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("Unexpected /foncier/prefaisabilite/[id] error:", e);
    return NextResponse.json(
      { error: "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}
