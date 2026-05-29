/**
 * DATAMERRY — Plafond de prix RÉALISTE par commune et bucket de surface.
 *
 * Sert à capper les estimations P90 trop optimistes qui donnent
 * des faux espoirs aux vendeurs.
 *
 * Exemple concret du problème (test Drancy 62m²) :
 *   - prix_m2_p90 (cluster) = 6 920 €/m²  →  prix_total_p90 = 429 040 €
 *   - Or aucun 62m² ne s'est vendu au-dessus de ~285 k€ à Drancy sur 5 ans
 *   - Si on affiche 429 k€, on perd le vendeur (faux espoir → braquage à la 1ère visite)
 *
 * Solution : on récupère le P95 absolu observé sur la commune entière,
 * segmenté par bucket de surface, et on cape le P90 de l'estimation
 * à ce plafond marché. La crédibilité du rapport remonte d'un coup.
 *
 * Logique des buckets de surface :
 *   T1   : < 30 m²
 *   T2   : 30-49 m²
 *   T3   : 50-69 m²
 *   T4   : 70-89 m²
 *   T5+  : ≥ 90 m²
 *
 * Pourquoi P95 et pas max absolu :
 *   - Le max est sensible aux outliers (saisie erronée, bien d'exception)
 *   - P95 = "il existe ces ventes, mais c'est le sommet du marché"
 *   - Au-delà : moins de 5 % des transactions = mise en vente très risquée
 *
 * Cache 7 jours (les ventes DVF arrivent par lots, pas la peine de recalculer
 * tous les jours).
 */

import { addressHash, fetchWithCache } from "./_cache";
import { getSupabaseServerClient } from "../supabase-server";

const TTL_DAYS = 7;
const DEFAULT_YEARS_BACK = 5;
const MIN_VENTES_BUCKET = 5;       // mini pour calculer un P95 fiable
const MIN_VENTES_BUCKET_LARGE = 20; // mini idéal

export type SurfaceBucket = "T1" | "T2" | "T3" | "T4" | "T5+";

export type CommunePriceCeilingResult = {
  available: boolean;
  reason?: string;
  code_commune: string;
  type_local: string;
  surface_m2: number;
  bucket: SurfaceBucket;
  /** P95 du prix au m² observé sur la commune dans ce bucket (5 ans) */
  prix_m2_p95: number | null;
  /** Maximum absolu observé (pour info, sensible aux outliers) */
  prix_m2_max_observe: number | null;
  /** P95 du prix TOTAL (€) observé sur la commune dans ce bucket */
  prix_total_p95: number | null;
  prix_total_max_observe: number | null;
  /** Nb de ventes utilisées pour calculer le P95 */
  nb_ventes_bucket: number;
  /** Confiance dans la valeur : "high" >= 20 ventes, "medium" 5-19, "low" < 5 */
  confiance: "high" | "medium" | "low" | "none";
  source: string;
  fetched_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

/** Bucket d'une surface donnée. T3 = 50-69m², T4 = 70-89m², etc. */
export function getBucketFromSurface(surface_m2: number): SurfaceBucket {
  if (surface_m2 < 30) return "T1";
  if (surface_m2 < 50) return "T2";
  if (surface_m2 < 70) return "T3";
  if (surface_m2 < 90) return "T4";
  return "T5+";
}

/** Bornes d'un bucket pour requête SQL (inclusive min, exclusive max). */
function getBucketRange(bucket: SurfaceBucket): { min: number; max: number } {
  switch (bucket) {
    case "T1":
      return { min: 5, max: 30 }; // exclut < 5m² (caves, parkings tagués Appartement par erreur)
    case "T2":
      return { min: 30, max: 50 };
    case "T3":
      return { min: 50, max: 70 };
    case "T4":
      return { min: 70, max: 90 };
    case "T5+":
      return { min: 90, max: 500 }; // exclut > 500m² (anomalies DVF)
  }
}

/** Calcul quantile par interpolation linéaire (idem numpy.quantile). */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  if (next !== undefined) {
    return sorted[base] + rest * (next - sorted[base]);
  }
  return sorted[base];
}

type DvfPoint = {
  prix_m2: number | null;
  valeur_fonciere: number | null;
  surface_reelle_bati: number | null;
  annee: number | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Computation
// ──────────────────────────────────────────────────────────────────────────────

async function computeFromDb(
  code_commune: string,
  type_local: string,
  surface_m2: number,
  years_back: number,
): Promise<CommunePriceCeilingResult> {
  const sb = getSupabaseServerClient();
  const now = new Date().toISOString();
  const yearMin = new Date().getFullYear() - years_back;

  const bucket = getBucketFromSurface(surface_m2);
  const range = getBucketRange(bucket);

  const empty: CommunePriceCeilingResult = {
    available: false,
    code_commune,
    type_local,
    surface_m2,
    bucket,
    prix_m2_p95: null,
    prix_m2_max_observe: null,
    prix_total_p95: null,
    prix_total_max_observe: null,
    nb_ventes_bucket: 0,
    confiance: "none",
    source: "dvf_points",
    fetched_at: now,
  };

  // Récupération TOUTES SURFACES commune + type. On filtre par bucket
  // ensuite côté JS pour économiser une requête. Le P95 global (toutes
  // surfaces confondues) sert de FILET DE SÉCURITÉ : il est calculé sur
  // beaucoup plus de ventes que le bucket précis et donne un plafond
  // beaucoup plus robuste contre les outliers.
  const { data: dvfRaw, error } = await sb
    .from("dvf_points")
    .select("prix_m2, valeur_fonciere, surface_reelle_bati, annee")
    .eq("code_commune", code_commune)
    .eq("type_local", type_local)
    .gte("annee", yearMin)
    .not("prix_m2", "is", null)
    .not("valeur_fonciere", "is", null)
    .limit(30000);

  if (error) {
    return {
      ...empty,
      reason: `db_error: ${error.message}`,
    };
  }

  const points = (dvfRaw ?? []) as DvfPoint[];
  // Filtrage anti-outliers : exclut prix_m2 < 500 ou > 50 000 (saisies erronées)
  // Et valeur_fonciere < 10 k€ ou > 50 M€ (mutations atypiques)
  const allCommune = points.filter(
    (p) =>
      p.prix_m2 != null &&
      p.valeur_fonciere != null &&
      p.surface_reelle_bati != null &&
      p.prix_m2 >= 500 &&
      p.prix_m2 <= 50000 &&
      p.valeur_fonciere >= 10000 &&
      p.valeur_fonciere <= 50_000_000 &&
      p.surface_reelle_bati >= 5 &&
      p.surface_reelle_bati <= 500,
  );

  if (allCommune.length < 20) {
    return {
      ...empty,
      reason: `commune_insufficient_data (${allCommune.length} ventes)`,
      nb_ventes_bucket: allCommune.length,
    };
  }

  // Filtre du bucket cible (filet précis)
  const bucketSales = allCommune.filter((p) => {
    const s = p.surface_reelle_bati as number;
    return s >= range.min && s < range.max;
  });

  // P95 GLOBAL — toutes surfaces commune (filet large, robuste)
  const prix_m2_all_sorted = allCommune
    .map((p) => p.prix_m2 as number)
    .sort((a, b) => a - b);
  const prix_m2_p95_global = quantile(prix_m2_all_sorted, 0.95);

  // P95 BUCKET — surface cible (filet précis, mais sensible aux outliers
  // sur petits échantillons)
  let prix_m2_p95_bucket: number | null = null;
  let prix_m2_max_bucket = 0;
  if (bucketSales.length >= MIN_VENTES_BUCKET) {
    const bucketSorted = bucketSales
      .map((p) => p.prix_m2 as number)
      .sort((a, b) => a - b);
    prix_m2_p95_bucket = quantile(bucketSorted, 0.95);
    prix_m2_max_bucket = bucketSorted[bucketSorted.length - 1];
  }

  // PLAFOND EFFECTIF — minimum des deux filets, plus une petite tolérance
  // sur le filet global pour ne pas être trop agressif (10 % au-dessus du
  // P95 global est encore réaliste).
  const prix_m2_p95_effectif = Math.round(
    prix_m2_p95_bucket != null
      ? Math.min(prix_m2_p95_bucket, prix_m2_p95_global * 1.1)
      : prix_m2_p95_global * 1.1,
  );

  const prix_m2_p95 = prix_m2_p95_effectif;
  const prix_m2_max_observe = Math.round(
    Math.max(prix_m2_max_bucket, prix_m2_all_sorted[prix_m2_all_sorted.length - 1]),
  );
  // Pour le prix TOTAL on applique le P95 €/m² au surface_m2 du bien
  // estimé (cohérent et défendable, plutôt que de mixer les surfaces
  // brutes du bucket qui n'ont pas la même taille que le bien).
  const prix_total_p95 = Math.round(prix_m2_p95 * surface_m2);
  const prix_total_max_observe = Math.round(prix_m2_max_observe * surface_m2);

  const nb_ventes_bucket = bucketSales.length;
  const confiance =
    nb_ventes_bucket >= MIN_VENTES_BUCKET_LARGE
      ? "high"
      : nb_ventes_bucket >= MIN_VENTES_BUCKET
        ? "medium"
        : "low"; // low : on a quand même un plafond GLOBAL fiable

  return {
    available: true,
    code_commune,
    type_local,
    surface_m2,
    bucket,
    prix_m2_p95,
    prix_m2_max_observe,
    prix_total_p95,
    prix_total_max_observe,
    nb_ventes_bucket: filtered.length,
    confiance,
    source: "dvf_points",
    fetched_at: now,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────────────────────

export async function getCommunePriceCeiling(args: {
  lat: number;
  lon: number;
  code_commune: string;
  type_local: string;
  surface_m2: number;
  years_back?: number;
}): Promise<CommunePriceCeilingResult & { cached: boolean }> {
  const { lat, lon, code_commune, type_local, surface_m2 } = args;
  const years_back = args.years_back ?? DEFAULT_YEARS_BACK;
  const hash = addressHash(lat, lon);
  const bucket = getBucketFromSurface(surface_m2);

  // Clé cache différenciée par bucket + commune + type + years
  // pas par surface exacte (sinon trop peu de hits cache)
  const cacheHash = `${hash}:ceiling:${code_commune}:${type_local}:${bucket}:${years_back}`;

  const { data, cached } = await fetchWithCache<CommunePriceCeilingResult>(
    cacheHash,
    { lat, lon },
    "price_ceiling_v2",
    TTL_DAYS,
    () => computeFromDb(code_commune, type_local, surface_m2, years_back),
    0,
  );

  return { ...data, cached };
}

// ──────────────────────────────────────────────────────────────────────────────
// Application : capping des estimations
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Applique le capping aux estimations P10/P50/P90 issues du cluster HDBSCAN.
 *
 * Logique :
 *   - Si pas de plafond disponible (confiance "none" ou "low" + < 5 ventes)
 *     → on ne touche à rien (mieux vaut un P90 cluster qu'aucun plafond fiable)
 *   - Si P90_cluster <= P95_commune → pas de capping nécessaire (le cluster
 *     est cohérent avec le marché communal)
 *   - Si P90_cluster > P95_commune → on cape le P90 au P95 commune
 *   - On ne touche jamais à P10 ni P50 (médiane) — ce sont des estimations
 *     basses qui n'inflament pas le vendeur
 *
 * Renvoie aussi un drapeau `capped` pour que le PDF puisse signaler le
 * réajustement au lecteur (transparence).
 */
export function capEstimationsByCommuneCeiling(args: {
  prix_m2_p10: number | null;
  prix_m2_median: number | null;
  prix_m2_p90: number | null;
  surface_m2: number;
  ceiling: CommunePriceCeilingResult | null;
}): {
  prix_m2_p10: number | null;
  prix_m2_median: number | null;
  prix_m2_p90: number | null;
  prix_total_median: number | null;
  prix_total_p10: number | null;
  prix_total_p90: number | null;
  capped: boolean;
  cap_source: "commune_p95" | null;
} {
  const { prix_m2_p10, prix_m2_median, prix_m2_p90, surface_m2, ceiling } =
    args;

  // On cape dès qu'on a un P95 calculé. La confiance "low" reste valide
  // car même un plafond global commune (toutes surfaces) basé sur ≥ 20
  // ventes est plus fiable qu'un P90 cluster qui hérite des petites
  // surfaces. Mieux vaut un plafond honnête qu'une estim irréaliste.
  const canCap =
    ceiling != null && ceiling.available && ceiling.prix_m2_p95 != null;

  let final_p90 = prix_m2_p90;
  let capped = false;
  let cap_source: "commune_p95" | null = null;

  if (
    canCap &&
    prix_m2_p90 != null &&
    ceiling!.prix_m2_p95 != null &&
    prix_m2_p90 > ceiling!.prix_m2_p95
  ) {
    final_p90 = ceiling!.prix_m2_p95;
    capped = true;
    cap_source = "commune_p95";
  }

  // S'assurer que median <= P90 après capping (au cas où le cluster
  // avait une médiane déjà supérieure au P95 commune — improbable mais possible)
  let final_median = prix_m2_median;
  if (
    canCap &&
    prix_m2_median != null &&
    final_p90 != null &&
    prix_m2_median > final_p90
  ) {
    final_median = final_p90;
  }

  const prix_total_median =
    final_median != null && surface_m2 > 0
      ? Math.round(final_median * surface_m2)
      : null;
  const prix_total_p10 =
    prix_m2_p10 != null && surface_m2 > 0
      ? Math.round(prix_m2_p10 * surface_m2)
      : null;
  const prix_total_p90 =
    final_p90 != null && surface_m2 > 0 ? Math.round(final_p90 * surface_m2) : null;

  return {
    prix_m2_p10,
    prix_m2_median: final_median,
    prix_m2_p90: final_p90,
    prix_total_median,
    prix_total_p10,
    prix_total_p90,
    capped,
    cap_source,
  };
}
