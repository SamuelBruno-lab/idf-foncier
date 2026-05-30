/**
 * DATAMERRY — Évolution du prix au m² au niveau du MICRO-MARCHÉ
 * (cluster HDBSCAN), pas de la commune entière.
 *
 * Différence avec getPriceEvolution() commune-level :
 *   - Commune (75104 Paris 4e) = ~600 ventes appartement / an, médiane large
 *   - Cluster HDBSCAN dans le 4e (ex: Marais nord) = ~80 ventes / an, médiane
 *     resserrée sur 200-400 m de rayon
 *   → précision µ-marché significativement meilleure, c'est ce que Samuel
 *     vend en argument expert vs Immo Data (commune-level uniquement).
 *
 * Méthode :
 *   1. Trouve le cluster HDBSCAN matchant l'adresse (pointInPolygon sur
 *      hull_coords, fallback centroïde le plus proche).
 *   2. Calcule la bounding box du hull du cluster.
 *   3. Récupère tous les points DVF dans cette bbox (filtre SQL rapide
 *      grâce aux index lat/lon + code_commune).
 *   4. Post-filtre en JS avec pointInPolygon sur les coords exactes du hull.
 *   5. Agrège par année : médiane + p25 + p75 + nb ventes.
 *
 * Coût performance : ~80-200 points DVF retournés par la bbox (Paris dense,
 * cluster 200-400 m), pointInPolygon en JS O(n×k) reste < 50ms.
 *
 * Cache 7 jours via property_report_cache (clé hash sur lat+lon+type+years).
 */

import { addressHash, fetchWithCache } from "./_cache";
import { getSupabaseServerClient } from "../supabase-server";
import { pointInPolygon } from "../geo";

const TTL_DAYS = 7;
const DEFAULT_YEARS_BACK = 8;
// Seuil minimal de ventes par an pour qu'une année soit retenue dans
// la courbe cluster. Compromis statistique :
//   - 5 = bonne confiance mais souvent exclut des communes denses dont
//         le cluster est étroit
//   - 2 = très permissif, garde quasi toujours les années où il y a eu
//         AU MOINS une transaction notariée. Pour la commune entière le
//         capping P95 et le garde-fou 1,5× médiane restent en place donc
//         pas de risque de surévaluation par 1-2 outliers.
// 1 vente/an = ultra permissif. La courbe peut bruiter sur les petits
// clusters mais le garde-fou 1,5× médiane et le capping P95 commune
// neutralisent les outliers en aval. Mieux vaut afficher une courbe
// micro-marché « best effort » que basculer 100% commune.
const MIN_VENTES_PAR_AN = 1;

export type ClusterPriceYear = {
  annee: number;
  prix_m2_median: number;
  prix_m2_p25: number;
  prix_m2_p75: number;
  nb_ventes: number;
};

export type ClusterPriceEvolutionResult = {
  available: boolean;
  reason?: string;
  /** ID du cluster HDBSCAN utilisé pour l'agrégation (UUID). */
  zone_id: string | null;
  /** Nb total de ventes dans le cluster sur la période. */
  nb_total_ventes_cluster: number;
  /** Centre du cluster (informatif). */
  centroid_lat: number | null;
  centroid_lon: number | null;
  /** Type de bien filtré (Appartement / Maison). */
  type_local: string;
  years: ClusterPriceYear[];
  variation_pct_total: number | null;
  variation_pct_5y: number | null;
  annee_min: number | null;
  annee_max: number | null;
  /** Méthode de matching ('hull' = polygon exact, 'centroid' = fallback nearest). */
  match_method: "hull" | "centroid" | "radius_400m" | "none";
  source: string;
  fetched_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers statistiques
// ──────────────────────────────────────────────────────────────────────────────

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// ──────────────────────────────────────────────────────────────────────────────
// Fetch + agrégation
// ──────────────────────────────────────────────────────────────────────────────

type ZoneRow = {
  id: string;
  hull_coords: number[][] | null;
  centroid_lat: number | null;
  centroid_lon: number | null;
  count: number;
};

type DvfPoint = {
  prix_m2: number | null;
  annee: number | null;
  lat: number | null;
  lon: number | null;
};

async function computeFromDb(
  lat: number,
  lon: number,
  code_commune: string,
  type_local: string,
  years_back: number,
): Promise<ClusterPriceEvolutionResult> {
  const sb = getSupabaseServerClient();
  const now = new Date().toISOString();

  // 1. Récupère les clusters de la commune+type
  const { data: zones } = await sb
    .from("dvf_hdbscan_zones")
    .select("id, hull_coords, centroid_lat, centroid_lon, count")
    .eq("code_commune", code_commune)
    .eq("type_local", type_local);

  const rows = (zones ?? []) as ZoneRow[];
  if (rows.length === 0) {
    return {
      available: false,
      reason: "no_cluster_in_commune",
      zone_id: null,
      nb_total_ventes_cluster: 0,
      centroid_lat: null,
      centroid_lon: null,
      type_local,
      years: [],
      variation_pct_total: null,
      variation_pct_5y: null,
      annee_min: null,
      annee_max: null,
      match_method: "none",
      source: "dvf_points + dvf_hdbscan_zones",
      fetched_at: now,
    };
  }

  // 2. Trouve le cluster matchant (pointInPolygon, fallback nearest centroid)
  let match: ZoneRow | undefined;
  let matchMethod: "hull" | "centroid" | "none" = "none";
  const point: [number, number] = [lat, lon];

  match = rows.find((z) => z.hull_coords && pointInPolygon(point, z.hull_coords));
  if (match) {
    matchMethod = "hull";
  } else {
    let best: { row: ZoneRow; d: number } | null = null;
    for (const z of rows) {
      if (z.centroid_lat == null || z.centroid_lon == null) continue;
      const d = (z.centroid_lat - lat) ** 2 + (z.centroid_lon - lon) ** 2;
      if (!best || d < best.d) best = { row: z, d };
    }
    match = best?.row;
    if (match) matchMethod = "centroid";
  }

  if (!match || !match.hull_coords) {
    return {
      available: false,
      reason: "no_match",
      zone_id: null,
      nb_total_ventes_cluster: 0,
      centroid_lat: null,
      centroid_lon: null,
      type_local,
      years: [],
      variation_pct_total: null,
      variation_pct_5y: null,
      annee_min: null,
      annee_max: null,
      match_method: "none",
      source: "dvf_points + dvf_hdbscan_zones",
      fetched_at: now,
    };
  }

  // 3. Bounding box du hull pour pré-filtre SQL rapide
  // ÉTENDUE D'AU MOINS ±450m AUTOUR DE L'ADRESSE pour permettre le
  // fallback rayon 400m si le hull HDBSCAN est trop étroit.
  const lats = match.hull_coords.map((c) => c[0]);
  const lons = match.hull_coords.map((c) => c[1]);
  const RADIUS_FALLBACK_DEG_LAT = 0.0045; // ~500m
  const RADIUS_FALLBACK_DEG_LON = 0.0045 / Math.cos((lat * Math.PI) / 180);
  const minLat = Math.min(Math.min(...lats), lat - RADIUS_FALLBACK_DEG_LAT);
  const maxLat = Math.max(Math.max(...lats), lat + RADIUS_FALLBACK_DEG_LAT);
  const minLon = Math.min(Math.min(...lons), lon - RADIUS_FALLBACK_DEG_LON);
  const maxLon = Math.max(Math.max(...lons), lon + RADIUS_FALLBACK_DEG_LON);

  // 4. Query DVF dans la bbox + plage d'années + type
  const yearMin = new Date().getFullYear() - years_back;
  const { data: dvfRaw } = await sb
    .from("dvf_points")
    .select("prix_m2, annee, lat, lon")
    .eq("code_commune", code_commune)
    .eq("type_local", type_local)
    .gte("annee", yearMin)
    .not("prix_m2", "is", null)
    .gte("lat", minLat)
    .lte("lat", maxLat)
    .gte("lon", minLon)
    .lte("lon", maxLon)
    .limit(20000); // safety cap (en pratique < 1000 pour un cluster)

  const dvfPoints = (dvfRaw ?? []) as DvfPoint[];

  // 5. Post-filtre pointInPolygon + filtre prix outliers
  let inCluster = dvfPoints.filter((p) => {
    if (p.lat == null || p.lon == null || p.prix_m2 == null || p.annee == null) return false;
    if (p.prix_m2 < 500 || p.prix_m2 > 50000) return false;
    return pointInPolygon([p.lat, p.lon], match!.hull_coords!);
  });

  // 5bis. FALLBACK RAYON 400m AUTOUR DE L'ADRESSE
  // Si le polygon HDBSCAN strict est trop étroit (cluster mal calibré,
  // adresse en bordure de hull) → on bascule sur un rayon 400m autour
  // de l'adresse — c'est ce que l'utilisateur perçoit comme « son
  // micro-marché » de toute façon (1 quartier piéton).
  // Activé si < 5 ventes dans le polygon strict.
  let matchScope: "hull" | "radius_400m" = "hull";
  if (inCluster.length < 5) {
    const haversineM = (la1: number, lo1: number, la2: number, lo2: number) => {
      const R = 6371000;
      const toRad = (d: number) => (d * Math.PI) / 180;
      const dLat = toRad(la2 - la1);
      const dLon = toRad(lo2 - lo1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    const radiusFiltered = dvfPoints.filter((p) => {
      if (p.lat == null || p.lon == null || p.prix_m2 == null || p.annee == null)
        return false;
      if (p.prix_m2 < 500 || p.prix_m2 > 50000) return false;
      return haversineM(lat, lon, p.lat, p.lon) <= 400;
    });
    if (radiusFiltered.length > inCluster.length) {
      inCluster = radiusFiltered;
      matchScope = "radius_400m";
    }
  }

  if (inCluster.length === 0) {
    return {
      available: false,
      reason: "no_points_in_cluster",
      zone_id: match.id,
      nb_total_ventes_cluster: 0,
      centroid_lat: match.centroid_lat,
      centroid_lon: match.centroid_lon,
      type_local,
      years: [],
      variation_pct_total: null,
      variation_pct_5y: null,
      annee_min: null,
      annee_max: null,
      match_method: matchMethod,
      source: "dvf_points + dvf_hdbscan_zones",
      fetched_at: now,
    };
  }

  // 6. Groupage par année + médianes
  const byYear = new Map<number, number[]>();
  for (const p of inCluster) {
    const y = p.annee as number;
    const arr = byYear.get(y) ?? [];
    arr.push(p.prix_m2 as number);
    byYear.set(y, arr);
  }

  const years: ClusterPriceYear[] = [];
  for (const [annee, prices] of byYear.entries()) {
    if (prices.length < MIN_VENTES_PAR_AN) continue;
    const sorted = [...prices].sort((a, b) => a - b);
    years.push({
      annee,
      prix_m2_median: Math.round(median(sorted)),
      prix_m2_p25: Math.round(percentile(sorted, 0.25)),
      prix_m2_p75: Math.round(percentile(sorted, 0.75)),
      nb_ventes: prices.length,
    });
  }
  years.sort((a, b) => a.annee - b.annee);

  if (years.length === 0) {
    return {
      available: false,
      reason: "no_year_with_min_ventes",
      zone_id: match.id,
      nb_total_ventes_cluster: inCluster.length,
      centroid_lat: match.centroid_lat,
      centroid_lon: match.centroid_lon,
      type_local,
      years: [],
      variation_pct_total: null,
      variation_pct_5y: null,
      annee_min: null,
      annee_max: null,
      match_method: matchMethod,
      source: "dvf_points + dvf_hdbscan_zones",
      fetched_at: now,
    };
  }

  // 7. Variations cumulées
  const first = years[0];
  const last = years[years.length - 1];
  const variation_pct_total =
    first.prix_m2_median > 0
      ? Math.round(((last.prix_m2_median - first.prix_m2_median) / first.prix_m2_median) * 100)
      : null;

  const targetBaseYear = last.annee - 5;
  const baseYear = years.find((y) => y.annee === targetBaseYear);
  const variation_pct_5y =
    baseYear && baseYear.prix_m2_median > 0
      ? Math.round(
          ((last.prix_m2_median - baseYear.prix_m2_median) / baseYear.prix_m2_median) * 100,
        )
      : null;

  return {
    available: years.length >= 2,
    zone_id: match.id,
    nb_total_ventes_cluster: inCluster.length,
    centroid_lat: match.centroid_lat,
    centroid_lon: match.centroid_lon,
    type_local,
    years,
    variation_pct_total,
    variation_pct_5y,
    annee_min: first.annee,
    annee_max: last.annee,
    match_method: matchScope === "radius_400m" ? "radius_400m" : matchMethod,
    source: "dvf_points + dvf_hdbscan_zones",
    fetched_at: now,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique avec cache
// ──────────────────────────────────────────────────────────────────────────────

export async function getClusterPriceEvolution(args: {
  lat: number;
  lon: number;
  code_commune: string;
  type_local: string;
  years_back?: number;
}): Promise<ClusterPriceEvolutionResult & { cached: boolean }> {
  const { lat, lon, code_commune, type_local } = args;
  const years_back = args.years_back ?? DEFAULT_YEARS_BACK;

  const hash = addressHash(lat, lon);

  // On utilise la clé "price_evolution" existante (DatasetKey union) avec
  // un suffixe dans le hash pour différencier commune vs cluster. Évite
  // d'élargir DatasetKey.
  const cacheHash = `${hash}:cluster:${type_local}:${years_back}`;

  const { data, cached } = await fetchWithCache<ClusterPriceEvolutionResult>(
    cacheHash,
    { lat, lon },
    "price_evolution_v2",
    TTL_DAYS,
    () => computeFromDb(lat, lon, code_commune, type_local, years_back),
    0,
  );

  return { ...data, cached };
}
