import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Route PUBLIQUE (pas de paywall, coherente avec le reste de /api/foncier/*) --
 * expose l'enveloppe constructible (compute_buildable_envelope, sql/76) en
 * GeoJSON, en Lambert-93/2154 (PAS reprojete en 4326) -- le calcul du
 * rectangle inscrit optimal (src/lib/foncier/enveloppe-batiment.ts) a
 * besoin de coordonnees metriques exactes, pas de degres. Une reprojection
 * 4326 pour un affichage carte est a ajouter separement si un rendu visuel
 * est construit plus tard (decision V1 : pas de carte pour l'instant).
 */

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = getSupabaseServerClient();

    // maybeSingle() (pas single()) : la fonction SQL peut legitimement ne
    // renvoyer AUCUNE ligne (WHERE env IS NOT NULL, cf. sql/76) -- reculs
    // excessifs par rapport a la taille de la parcelle, ou parcelle
    // introuvable. single() traiterait ce cas comme une erreur PostgREST
    // (PGRST116), masquant un cas metier legitime derriere un 500.
    const { data, error } = await supabase
      .rpc("compute_buildable_envelope_geojson", { p_parcel_id: id })
      .maybeSingle();

    if (error) {
      console.error("API /foncier/enveloppe-constructible/[id] error:", error);
      return NextResponse.json(
        { error: "Calcul de l'enveloppe constructible indisponible." },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: "Enveloppe non calculable pour cette parcelle (reculs excessifs ou parcelle introuvable)." },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (e) {
    console.error("Unexpected /foncier/enveloppe-constructible/[id] error:", e);
    return NextResponse.json(
      { error: "Erreur serveur inattendue." },
      { status: 500 }
    );
  }
}
