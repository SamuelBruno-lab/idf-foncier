/**
 * DATAMERRY — Ajustement €/m² selon le bucket de surface.
 *
 * PROBLÈME IDENTIFIÉ (test Drancy 62 m²) :
 *   Le cluster HDBSCAN du micro-marché contient principalement des ventes
 *   de T1/T2 (~30 m²) car ce sont les surfaces les plus courantes à Drancy.
 *   Or les petites surfaces ont MÉCANIQUEMENT un €/m² plus élevé que les
 *   grandes (en France, le ratio T1/T4 est typiquement de 1,15 à 1,30).
 *
 *   Sans correction, on hérite d'un €/m² gonflé qui fait surestimer le bien.
 *
 * SOLUTION :
 *   1. Identifier le bucket de surface DOMINANT dans les ventes du voisinage
 *      (rayon 400 m, même type, 5 ans).
 *   2. Identifier le bucket CIBLE (celui du bien à estimer).
 *   3. Si les deux diffèrent, calculer le ratio relatif des €/m² par bucket
 *      au niveau COMMUNE (échantillon beaucoup plus large), et appliquer.
 *
 *   Exemple : à Drancy, le ratio commune T2 → T3 est ~0,88.
 *   Si le voisinage est dominé par T2 (~30-45 m²) à 5 500 €/m² et qu'on
 *   estime un T3 (62 m²), le €/m² ajusté est 5 500 × 0,88 = 4 840 €/m².
 *
 * Cache 30 jours (les ratios par bucket évoluent très lentement).
 */

import { addressHash, fetchWithCache } from "./_cache";
import { getSupabaseServerClient } from "../supabase-server";
import {
  getBucketFromSurface,
  type SurfaceBucket,
} from "./commune-price-ceiling";

const TTL_DAYS = 30;
const DEFAULT_YEARS_BACK = 5;
const VOISINAGE_RADIUS_M = 400;
const MIN_VENTES_BUCKET_PROFILE = 5;
const MIN_VENTES_BUCKET_RATIO = 15;

export type SurfaceBucketAdjustmentResult = {
  available: boolean;
  reason?: string;
  /** Bucket du bien à estimer (déduit de la surface saisie) */
  bucket_cible: SurfaceBucket;
  /** Bucket dominant des ventes du voisinage (rayon 400 m) */
  bucket_dominant: SurfaceBucket | null;
  /** Nb de ventes dans le voisinage qui ont permis de déduire le bucket dominant */
  nb_ventes_voisinage: number;
  /** Médiane €/m² au niveau commune pour le bucket source */
  median_source_eur_m2: number | null;
  /** Médiane €/m² au niveau commune pour le bucket cible */
  median_target_eur_m2: number | null;
  /** Ratio target / source — si > 1, le bien cible vaut plus au m² ; si < 1, moins */
  ratio: number | null;
  /** Pct de décote ou prime appliquée — utile pour affichage PDF */
  pct_ajustement: number | null;
  /** Confiance dans le ratio */
  confiance: "high" | "medium" | "low" | "none";
  source: string;
  fetched_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers internes
// ──────────────────────────────────────────────────────────────────────────────

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function bucketRange(b: SurfaceBucket): { min: number; max: number } {
  switch (b) {
    case "T1":
      return { min: 5, max: 30 };
    case "T2":
      return { min: 30, max: 50 };
    case "T3":
      return { min: 50, max: 70 };
    case "T4":
      return { min: 70, max: 90 };
    case "T5+":
      return { min: 90, max: 500 };
  }
}

const BUCKETS: SurfaceBucket[] = ["T1", "T2", "T3", "T4", "T5+"];

/** Haversine en mètres */
function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type DvfPoint = {
  prix_m2: number | null;
  surface_reelle_bati: number | null;
  lat: number | null;
  lon: number | null;
  annee: number | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Computation
// ──────────────────────────────────────────────────────────────────────────────

async function computeFromDb(
  lat: number,
  lon: number,
  code_commune: string,
  type_local: string,
  surface_m2: number,
  years_back: number,
): Promise<SurfaceBucketAdjustmentResult> {
  const sb = getSupabaseServerClient();
  const now = new Date().toISOString();
  const yearMin = new Date().getFullYear() - years_back;
  const bucket_cible = getBucketFromSurface(surface_m2);

  const empty: SurfaceBucketAdjustmentResult = {
    available: false,
    bucket_cible,
    bucket_dominant: null,
    nb_ventes_voisinage: 0,
    median_source_eur_m2: null,
    median_target_eur_m2: null,
    ratio: null,
    pct_ajustement: null,
    confiance: "none",
    source: "dvf_points",
    fetched_at: now,
  };

  // ────────────────────────────────────────────────────────────────────────
  // Étape 1 — Identifier le bucket dominant des ventes du voisinage
  //
  // Approche pragmatique : on filtre DVF par bounding box élargi (≈ ±400 m
  // en lat/lon), puis on filtre précisément par Haversine, puis on groupe
  // par bucket et on prend celui qui a le plus de ventes.
  //
  // Pourquoi pas pointInPolygon HDBSCAN ? Parce qu'on veut un proxy STABLE
  // du voisinage géographique, indépendamment de la qualité du clustering.
  // Si le cluster HDBSCAN matchant est étroit (rare cluster premium), le
  // bucket dominant peut être trompeur. Un rayon 400 m est plus robuste.
  // ────────────────────────────────────────────────────────────────────────

  // ≈ 0.005° à mi-latitude France = ~400 m
  const dLat = 0.005;
  const dLon = 0.005 / Math.cos((lat * Math.PI) / 180);

  const { data: voisinageRaw, error: voisinageErr } = await sb
    .from("dvf_points")
    .select("prix_m2, surface_reelle_bati, lat, lon, annee")
    .eq("type_local", type_local)
    .gte("annee", yearMin)
    .gte("lat", lat - dLat)
    .lte("lat", lat + dLat)
    .gte("lon", lon - dLon)
    .lte("lon", lon + dLon)
    .not("prix_m2", "is", null)
    .not("surface_reelle_bati", "is", null)
    .limit(5000);

  if (voisinageErr) {
    return { ...empty, reason: `voisinage_error: ${voisinageErr.message}` };
  }

  const voisinagePoints = (voisinageRaw ?? []) as DvfPoint[];
  const voisinageFiltered = voisinagePoints.filter((p) => {
    if (p.lat == null || p.lon == null || p.surface_reelle_bati == null)
      return false;
    if (p.prix_m2 == null || p.prix_m2 < 500 || p.prix_m2 > 50000) return false;
    if (p.surface_reelle_bati < 5 || p.surface_reelle_bati > 500) return false;
    return haversineM(lat, lon, p.lat, p.lon) <= VOISINAGE_RADIUS_M;
  });

  if (voisinageFiltered.length < MIN_VENTES_BUCKET_PROFILE) {
    return {
      ...empty,
      reason: `voisinage_insufficient (${voisinageFiltered.length} ventes)`,
      nb_ventes_voisinage: voisinageFiltered.length,
    };
  }

  // Comptage par bucket
  const countByBucket = new Map<SurfaceBucket, number>();
  for (const b of BUCKETS) countByBucket.set(b, 0);
  for (const p of voisinageFiltered) {
    const b = getBucketFromSurface(p.surface_reelle_bati as number);
    countByBucket.set(b, (countByBucket.get(b) ?? 0) + 1);
  }
  // Bucket dominant = le plus représenté
  let bucket_dominant: SurfaceBucket = "T1";
  let maxCount = -1;
  for (const b of BUCKETS) {
    const c = countByBucket.get(b) ?? 0;
    if (c > maxCount) {
      maxCount = c;
      bucket_dominant = b;
    }
  }

  // Si le bucket dominant = bucket cible, pas d'ajustement nécessaire
  if (bucket_dominant === bucket_cible) {
    return {
      ...empty,
      available: true,
      bucket_dominant,
      nb_ventes_voisinage: voisinageFiltered.length,
      median_source_eur_m2: null,
      median_target_eur_m2: null,
      ratio: 1.0,
      pct_ajustement: 0,
      confiance: "high",
      reason: "no_adjustment_needed (cluster bucket = target bucket)",
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // Étape 2 — Calculer le ratio €/m² entre bucket_dominant et bucket_cible
  // au niveau commune (échantillon beaucoup plus large pour fiabilité).
  // ────────────────────────────────────────────────────────────────────────

  // On récupère TOUTES les ventes commune des 5 dernières années pour ce type,
  // puis on groupe par bucket et on calcule les médianes.
  const { data: communeRaw, error: communeErr } = await sb
    .from("dvf_points")
    .select("prix_m2, surface_reelle_bati, annee")
    .eq("code_commune", code_commune)
    .eq("type_local", type_local)
    .gte("annee", yearMin)
    .not("prix_m2", "is", null)
    .not("surface_reelle_bati", "is", null)
    .limit(30000);

  if (communeErr) {
    return {
      ...empty,
      bucket_dominant,
      nb_ventes_voisinage: voisinageFiltered.length,
      reason: `commune_error: ${communeErr.message}`,
    };
  }

  const communePoints = (communeRaw ?? []) as DvfPoint[];
  const communeFiltered = communePoints.filter(
    (p) =>
      p.prix_m2 != null &&
      p.surface_reelle_bati != null &&
      p.prix_m2 >= 500 &&
      p.prix_m2 <= 50000 &&
      p.surface_reelle_bati >= 5 &&
      p.surface_reelle_bati <= 500,
  );

  // Grouper par bucket
  const priceByBucket = new Map<SurfaceBucket, number[]>();
  for (const b of BUCKETS) priceByBucket.set(b, []);
  for (const p of communeFiltered) {
    const b = getBucketFromSurface(p.surface_reelle_bati as number);
    priceByBucket.get(b)!.push(p.prix_m2 as number);
  }

  const pricesSource = priceByBucket.get(bucket_dominant) ?? [];
  const pricesTarget = priceByBucket.get(bucket_cible) ?? [];

  if (
    pricesSource.length < MIN_VENTES_BUCKET_RATIO ||
    pricesTarget.length < MIN_VENTES_BUCKET_RATIO
  ) {
    return {
      ...empty,
      bucket_dominant,
      nb_ventes_voisinage: voisinageFiltered.length,
      reason: `commune_buckets_insufficient (src=${pricesSource.length}, tgt=${pricesTarget.length})`,
    };
  }

  const median_source = Math.round(
    median([...pricesSource].sort((a, b) => a - b)),
  );
  const median_target = Math.round(
    median([...pricesTarget].sort((a, b) => a - b)),
  );

  if (median_source <= 0) {
    return {
      ...empty,
      bucket_dominant,
      nb_ventes_voisinage: voisinageFiltered.length,
      reason: "median_source_zero",
    };
  }

  const ratio = median_target / median_source;
  const pct_ajustement = Math.round((ratio - 1) * 100);

  // Confiance basée sur le volume dans les 2 buckets
  const minVol = Math.min(pricesSource.length, pricesTarget.length);
  const confiance: "high" | "medium" | "low" =
    minVol >= 100 ? "high" : minVol >= 40 ? "medium" : "low";

  return {
    available: true,
    bucket_cible,
    bucket_dominant,
    nb_ventes_voisinage: voisinageFiltered.length,
    median_source_eur_m2: median_source,
    median_target_eur_m2: median_target,
    ratio,
    pct_ajustement,
    confiance,
    source: "dvf_points",
    fetched_at: now,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────────────────────

export async function getSurfaceBucketAdjustment(args: {
  lat: number;
  lon: number;
  code_commune: string;
  type_local: string;
  surface_m2: number;
  years_back?: number;
}): Promise<SurfaceBucketAdjustmentResult & { cached: boolean }> {
  const { lat, lon, code_commune, type_local, surface_m2 } = args;
  const years_back = args.years_back ?? DEFAULT_YEARS_BACK;
  const hash = addressHash(lat, lon);
  const bucket_cible = getBucketFromSurface(surface_m2);

  const cacheHash = `${hash}:surface_adj:${code_commune}:${type_local}:${bucket_cible}:${years_back}`;

  const { data, cached } =
    await fetchWithCache<SurfaceBucketAdjustmentResult>(
      cacheHash,
      { lat, lon },
      "surface_adjustment",
      TTL_DAYS,
      () =>
        computeFromDb(
          lat,
          lon,
          code_commune,
          type_local,
          surface_m2,
          years_back,
        ),
      0,
    );

  return { ...data, cached };
}

// ──────────────────────────────────────────────────────────────────────────────
// Application : ajuste les prix
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Applique l'ajustement de bucket de surface aux estimations brutes
 * issues du cluster HDBSCAN.
 *
 * Logique :
 *   - Si pas d'ajustement disponible OU confiance faible → on ne touche à rien
 *   - Si ratio = 1 (bucket cluster = bucket cible) → idem
 *   - Sinon, on multiplie P10/Médiane/P90 par le ratio
 *
 * IMPORTANT : on applique l'ajustement AVANT le capping par le plafond
 * commune (capEstimationsByCommuneCeiling), de sorte que :
 *   1. Le €/m² est d'abord recalibré sur le bon bucket
 *   2. Puis le P90 est cappé si encore trop optimiste vs marché commune
 */
export function applySurfaceAdjustment(args: {
  prix_m2_p10: number | null;
  prix_m2_median: number | null;
  prix_m2_p90: number | null;
  adjustment: SurfaceBucketAdjustmentResult | null;
}): {
  prix_m2_p10: number | null;
  prix_m2_median: number | null;
  prix_m2_p90: number | null;
  applied: boolean;
  ratio: number;
  pct: number;
} {
  const { prix_m2_p10, prix_m2_median, prix_m2_p90, adjustment } = args;

  const canApply =
    adjustment != null &&
    adjustment.available &&
    adjustment.ratio != null &&
    adjustment.confiance !== "low" &&
    adjustment.confiance !== "none" &&
    Math.abs(adjustment.ratio - 1) >= 0.03; // ignore les écarts < 3 % (bruit)

  if (!canApply) {
    return {
      prix_m2_p10,
      prix_m2_median,
      prix_m2_p90,
      applied: false,
      ratio: 1,
      pct: 0,
    };
  }

  const r = adjustment!.ratio as number;
  const pct = adjustment!.pct_ajustement ?? Math.round((r - 1) * 100);

  return {
    prix_m2_p10: prix_m2_p10 != null ? Math.round(prix_m2_p10 * r) : null,
    prix_m2_median:
      prix_m2_median != null ? Math.round(prix_m2_median * r) : null,
    prix_m2_p90: prix_m2_p90 != null ? Math.round(prix_m2_p90 * r) : null,
    applied: true,
    ratio: r,
    pct,
  };
}
