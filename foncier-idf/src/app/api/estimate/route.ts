/**
 * GET /api/estimate?address=...&type=Appartement&surface=62
 *
 * Pipeline :
 *   1. Géocode adresse (cache → BAN → rerank LLM)
 *   2. Identifie le cluster HDBSCAN qui contient le point (commune × type)
 *   3. Si cluster.count ≥ 30 → réponse cluster (confidence high/medium)
 *   4. Sinon → fallback commune (weighted average sur tous les clusters du
 *      commune × type), confidence low
 *   5. Si surface fournie → renvoie prix absolus en plus du prix_m2
 *
 * Pas d'auth (MVP Collabimo).
 */

import { NextRequest, NextResponse } from "next/server";

import { geocodeAddress } from "@/lib/geocode";
import { pointInPolygon } from "@/lib/geo";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const CLUSTER_HIGH_CONFIDENCE_N = 50;
const CLUSTER_MIN_N = 30;

// Mapping types entrée → valeur exacte dans la table dvf_hdbscan_zones
const TYPE_ALIASES: Record<string, string> = {
  appartement: "Appartement",
  appart: "Appartement",
  appt: "Appartement",
  maison: "Maison",
  commerce: "Local industriel. commercial ou assimilé",
  "local commercial": "Local industriel. commercial ou assimilé",
};

function resolveTypeLocal(input: string | null): string {
  if (!input) return "Appartement";
  const key = input.toLowerCase().trim();
  return TYPE_ALIASES[key] ?? "Appartement";
}

type ZoneRow = {
  id: string;
  code_commune: string;
  type_local: string;
  count: number;
  hull_coords: number[][] | null;
  centroid_lat: number | null;
  centroid_lon: number | null;
  prix_m2_median: number | null;
  prix_m2_p10: number | null;
  prix_m2_p90: number | null;
  window_annee_min: number | null;
  window_annee_max: number | null;
  duree_detention_median_mois: number | null;
  n_reventes_observees: number | null;
  prix_m2_yoy_pct: number | null;
  prix_m2_volatility: number | null;
  prix_m2_history: { annee: number; median: number; n: number }[] | null;
  surface_median: number | null;
  surface_p25: number | null;
  surface_p75: number | null;
  surface_n: number | null;
};

const ZONE_COLUMNS = `
  id, code_commune, type_local, count, hull_coords,
  centroid_lat, centroid_lon,
  prix_m2_median, prix_m2_p10, prix_m2_p90,
  window_annee_min, window_annee_max,
  duree_detention_median_mois, n_reventes_observees,
  prix_m2_yoy_pct, prix_m2_volatility, prix_m2_history,
  surface_median, surface_p25, surface_p75, surface_n
`;

/**
 * Renvoie un avertissement à destination du LLM/front quand la surface
 * demandée s'éloigne fortement de la médiane du cluster (les grandes
 * surfaces se vendent moins cher au m², les studios plus cher).
 */
function buildSurfaceContext(
  surface: number | null,
  zone: { surface_median: number | null; surface_p25: number | null; surface_p75: number | null; surface_n: number | null },
) {
  if (!zone.surface_median || !zone.surface_n) return null;
  const ratio = surface ? surface / zone.surface_median : null;
  let warning: string | null = null;
  let suggested_correction_pct: number | null = null;
  if (ratio !== null) {
    if (ratio > 1.8) {
      // 250m² vs médiane 100m² → typiquement -15 à -25% sur le €/m²
      const excess = ratio - 1.0;
      suggested_correction_pct = Math.round(-Math.min(25, 10 + excess * 8));
      warning = `Surface demandée (${surface}m²) >>>> médiane du quartier (${zone.surface_median}m²). Les grandes surfaces se vendent généralement ${Math.abs(suggested_correction_pct!)}% moins cher au m². Décote à appliquer.`;
    } else if (ratio < 0.6) {
      // Studio dans un quartier de T3 → prime
      suggested_correction_pct = Math.round(Math.min(15, (0.6 / Math.max(ratio, 0.1)) * 5));
      warning = `Surface demandée (${surface}m²) << médiane du quartier (${zone.surface_median}m²). Les petites surfaces se vendent généralement +${suggested_correction_pct}% au m².`;
    }
  }
  return {
    surface_median_zone: zone.surface_median,
    surface_p25_zone: zone.surface_p25,
    surface_p75_zone: zone.surface_p75,
    n_transactions_avec_surface: zone.surface_n,
    surface_demandee: surface,
    ratio_surface: ratio ? Math.round(ratio * 100) / 100 : null,
    suggested_correction_pct,
    warning,
  };
}

function distSq(a: [number, number], b: [number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const address = sp.get("address")?.trim() ?? "";
  const typeLocal = resolveTypeLocal(sp.get("type"));
  const surfaceRaw = sp.get("surface");
  const surface = surfaceRaw ? Number(surfaceRaw) : null;
  // ?precision=deep → utilise le dataset 5-ans (micro-marchés fins) au lieu du
  // dataset adaptive (fraîcheur). Trade-off à choisir côté client.
  const precision = sp.get("precision") === "deep" ? "deep" : "fresh";
  const tableName =
    precision === "deep" ? "dvf_hdbscan_zones_5y" : "dvf_hdbscan_zones";

  if (address.length < 3) {
    return NextResponse.json(
      { error: "Paramètre 'address' requis (min 3 caractères)" },
      { status: 400 },
    );
  }
  if (surface !== null && (!Number.isFinite(surface) || surface <= 0)) {
    return NextResponse.json(
      { error: "Paramètre 'surface' invalide (doit être un nombre > 0)" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();

  // ── 1. Géocodage ───────────────────────────────────────────────────
  let geocode;
  try {
    geocode = await geocodeAddress(address, supabase);
  } catch (err) {
    console.error("[/api/estimate] géocodage échoué:", err);
    return NextResponse.json(
      { error: "Service de géocodage indisponible" },
      { status: 503 },
    );
  }

  const top = geocode.results[0];
  if (!top) {
    return NextResponse.json(
      { error: "Adresse introuvable" },
      { status: 404 },
    );
  }

  // ── 2. Récupération des clusters de la commune × type ──────────────
  const { data: zones, error: zonesErr } = await supabase
    .from(tableName)
    .select(ZONE_COLUMNS)
    .eq("code_commune", top.code_insee)
    .eq("type_local", typeLocal);

  if (zonesErr) {
    console.error("[/api/estimate] supabase error:", zonesErr);
    return NextResponse.json(
      { error: "Erreur de lecture des données" },
      { status: 500 },
    );
  }

  if (!zones || zones.length === 0) {
    return NextResponse.json(
      {
        error: "Aucune donnée disponible pour cette commune et ce type",
        address: addressPayload(top),
      },
      { status: 404 },
    );
  }

  // ── 3. Point-in-polygon : trouver le cluster du point ──────────────
  const point: [number, number] = [top.lat, top.lon];
  const typedZones = zones as ZoneRow[];
  let matchedZone = typedZones.find(
    (z) =>
      z.hull_coords !== null &&
      z.hull_coords.length >= 3 &&
      pointInPolygon(point, z.hull_coords),
  );
  let matchMode: "polygon" | "nearest-centroid" = "polygon";

  // ── 3b. Fallback Voronoi : si l'adresse est hors de tous les convex hulls
  // (par ex. à la lisière d'une zone résidentielle), on snap au cluster
  // dont le CENTROÏDE est le plus proche. L'adresse hérite alors des stats
  // du micro-marché le plus probable.
  if (!matchedZone) {
    const withCentroid = typedZones.filter(
      (z) => z.centroid_lat != null && z.centroid_lon != null,
    );
    if (withCentroid.length > 0) {
      matchedZone = withCentroid.reduce((best, z) => {
        const d = distSq(point, [z.centroid_lat!, z.centroid_lon!]);
        const dBest = distSq(point, [best.centroid_lat!, best.centroid_lon!]);
        return d < dBest ? z : best;
      });
      matchMode = "nearest-centroid";
    }
  }

  // ── 4. Construction de la réponse ──────────────────────────────────
  if (matchedZone && (matchedZone.count ?? 0) >= CLUSTER_MIN_N) {
    return NextResponse.json({
      estimation: buildEstimation(
        matchedZone.prix_m2_median,
        matchedZone.prix_m2_p10,
        matchedZone.prix_m2_p90,
        surface,
      ),
      zone: {
        source: matchMode === "polygon" ? ("cluster" as const) : ("cluster-snap" as const),
        cluster_id: matchedZone.id,
        n_transactions: matchedZone.count,
        window: formatWindow(
          matchedZone.window_annee_min,
          matchedZone.window_annee_max,
        ),
        confidence:
          matchMode === "nearest-centroid"
            ? ("medium" as const)
            : matchedZone.count >= CLUSTER_HIGH_CONFIDENCE_N
              ? ("high" as const)
              : ("medium" as const),
        duree_detention_median_mois:
          matchedZone.duree_detention_median_mois,
        n_reventes_observees: matchedZone.n_reventes_observees,
        prix_m2_yoy_pct: matchedZone.prix_m2_yoy_pct,
        prix_m2_volatility: matchedZone.prix_m2_volatility,
        prix_m2_history: matchedZone.prix_m2_history,
      },
      surface_context: buildSurfaceContext(surface, matchedZone),
      address: addressPayload(top),
      geocode_meta: geocode.meta,
      precision,
      match_mode: matchMode,
    });
  }

  // Fallback commune : moyenne pondérée par count sur tous les clusters
  const fallback = buildCommuneFallback(typedZones);
  return NextResponse.json({
    estimation: buildEstimation(
      fallback.prix_m2_median,
      fallback.prix_m2_p10,
      fallback.prix_m2_p90,
      surface,
    ),
    zone: {
      source: "commune" as const,
      cluster_id: null,
      n_transactions: fallback.n,
      window: fallback.window,
      confidence: "low" as const,
      duree_detention_median_mois: null,
      n_reventes_observees: null,
      prix_m2_yoy_pct: null,
      prix_m2_volatility: null,
      prix_m2_history: null,
    },
    surface_context: null,
    address: addressPayload(top),
    geocode_meta: geocode.meta,
    precision,
    match_mode: "commune-fallback",
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildEstimation(
  prixM2Median: number | null,
  prixM2P10: number | null,
  prixM2P90: number | null,
  surface: number | null,
) {
  const out: Record<string, number | null> = {
    prix_m2_median: prixM2Median,
    prix_m2_min: prixM2P10,
    prix_m2_max: prixM2P90,
  };
  if (surface && prixM2Median != null) {
    out.median = Math.round(prixM2Median * surface);
  }
  if (surface && prixM2P10 != null) {
    out.min = Math.round(prixM2P10 * surface);
  }
  if (surface && prixM2P90 != null) {
    out.max = Math.round(prixM2P90 * surface);
  }
  return out;
}

function buildCommuneFallback(zones: ZoneRow[]) {
  // Filtre les zones avec stats utilisables
  const usable = zones.filter(
    (z) => z.prix_m2_median != null && z.count > 0,
  );
  if (usable.length === 0) {
    return {
      prix_m2_median: null,
      prix_m2_p10: null,
      prix_m2_p90: null,
      n: 0,
      window: null,
    };
  }

  const totalN = usable.reduce((s, z) => s + z.count, 0);
  const weighted = (key: "prix_m2_median" | "prix_m2_p10" | "prix_m2_p90") => {
    let num = 0;
    let den = 0;
    for (const z of usable) {
      const v = z[key];
      if (v != null) {
        num += v * z.count;
        den += z.count;
      }
    }
    return den > 0 ? Math.round(num / den) : null;
  };

  // Fenêtre = min / max sur toutes les fenêtres adaptatives des clusters
  const wmins = usable
    .map((z) => z.window_annee_min)
    .filter((v): v is number => v != null);
  const wmaxs = usable
    .map((z) => z.window_annee_max)
    .filter((v): v is number => v != null);

  return {
    prix_m2_median: weighted("prix_m2_median"),
    prix_m2_p10: weighted("prix_m2_p10"),
    prix_m2_p90: weighted("prix_m2_p90"),
    n: totalN,
    window:
      wmins.length > 0 && wmaxs.length > 0
        ? `${Math.min(...wmins)}-${Math.max(...wmaxs)}`
        : null,
  };
}

function formatWindow(
  min: number | null,
  max: number | null,
): string | null {
  if (min == null || max == null) return null;
  return min === max ? `${min}` : `${min}-${max}`;
}

function addressPayload(top: {
  label: string;
  lat: number;
  lon: number;
  code_insee: string;
  postcode: string;
  city: string;
}) {
  return {
    label: top.label,
    lat: top.lat,
    lon: top.lon,
    code_insee: top.code_insee,
    postcode: top.postcode,
    city: top.city,
  };
}
