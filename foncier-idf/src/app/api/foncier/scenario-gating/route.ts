import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Wrapper mince sur check_scenario_gating() (sql/74) -- info de
 * faisabilite reglementaire d'un scenario de redeveloppement pour une
 * parcelle. Route PUBLIQUE (pas de paywall), coherente avec le reste de
 * /api/foncier/* : c'est une info reglementaire, pas une donnee de
 * simulation chiffree (le paywall porte sur la sauvegarde des scenarios
 * chiffres, cf. /api/cabinets/[slug]/foncier/scenarios, Phase 2c).
 */

const SCENARIO_TYPES = [
  "demolition_reconstruction",
  "surelevation",
  "construction_neuve_meme_parcelle",
  "changement_usage",
  "strategie_mixte",
] as const;

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const parcelId = sp.get("parcel_id");
    const scenarioType = sp.get("scenario_type");

    if (!parcelId) {
      return NextResponse.json(
        { error: "parcel_id_required", message: "Parametre 'parcel_id' requis." },
        { status: 400 }
      );
    }
    if (!scenarioType || !SCENARIO_TYPES.includes(scenarioType as (typeof SCENARIO_TYPES)[number])) {
      return NextResponse.json(
        {
          error: "scenario_type_invalide",
          message: `Parametre 'scenario_type' requis, une valeur parmi : ${SCENARIO_TYPES.join(", ")}.`,
        },
        { status: 400 }
      );
    }

    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("check_scenario_gating", {
      p_parcel_id: parcelId,
      p_scenario_type: scenarioType,
    });

    if (error) {
      console.error("API /foncier/scenario-gating error:", error);
      return NextResponse.json(
        { error: "query_failed", detail: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("Unexpected /foncier/scenario-gating error:", e);
    return NextResponse.json(
      { error: "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}
