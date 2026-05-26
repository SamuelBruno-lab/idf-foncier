/**
 * DATAMERRY — Évolution du prix au m² par année (commune × type de bien).
 *
 * Appelle la fonction Postgres get_price_evolution() qui agrège DVF par année
 * et renvoie la médiane + percentiles + nb ventes.
 *
 * Affichée dans le PDF lead sous forme de bar chart + variation cumulée
 * (« Pantin Appartement : 5 470 €/m² en 2025 (+12 % vs 2020) »).
 *
 * Cache : 7 jours via property_report_cache. Les DVF entrent au compte-gouttes
 * (T+6 mois pour les actes notariés), donc on n'a pas besoin de rafraîchir
 * plus souvent.
 */

import { addressHash, fetchWithCache } from "./_cache";
import { getSupabaseServerClient } from "../supabase-server";

const TTL_DAYS = 7;
const DEFAULT_YEARS_BACK = 8;

export type PriceYear = {
  annee: number;
  prix_m2_median: number;
  prix_m2_p25: number | null;
  prix_m2_p75: number | null;
  nb_ventes: number;
};

export type PriceEvolutionResult = {
  available: boolean;
  reason?: string;
  code_commune: string;
  type_local: string;
  /** Années renvoyées, ordonnées ascendant. Peut sauter des années si < 5 ventes. */
  years: PriceYear[];
  /** Variation cumulée entre la 1ère et la dernière année dispo (%) */
  variation_pct_total: number | null;
  /** Variation cumulée sur 5 ans (NULL si moins de 5 ans de données) */
  variation_pct_5y: number | null;
  /** Année min / max effectivement présentes */
  annee_min: number | null;
  annee_max: number | null;
  source: string;
  fetched_at: string;
};

async function fetchFromDb(
  code_commune: string,
  type_local: string,
  years_back: number,
): Promise<PriceEvolutionResult> {
  const sb = getSupabaseServerClient();

  const { data, error } = await sb.rpc("get_price_evolution", {
    p_code_commune: code_commune,
    p_type_local: type_local,
    p_years_back: years_back,
  });

  const now = new Date().toISOString();

  if (error) {
    return {
      available: false,
      reason: `rpc_error: ${error.message}`,
      code_commune,
      type_local,
      years: [],
      variation_pct_total: null,
      variation_pct_5y: null,
      annee_min: null,
      annee_max: null,
      source: "dvf",
      fetched_at: now,
    };
  }

  const rows = (data ?? []) as Array<{
    annee: number;
    prix_m2_median: string | number;
    prix_m2_p25: string | number | null;
    prix_m2_p75: string | number | null;
    nb_ventes: number;
  }>;

  if (rows.length === 0) {
    return {
      available: false,
      reason: "no_data",
      code_commune,
      type_local,
      years: [],
      variation_pct_total: null,
      variation_pct_5y: null,
      annee_min: null,
      annee_max: null,
      source: "dvf",
      fetched_at: now,
    };
  }

  const years: PriceYear[] = rows.map((r) => ({
    annee: r.annee,
    prix_m2_median: Math.round(Number(r.prix_m2_median)),
    prix_m2_p25: r.prix_m2_p25 != null ? Math.round(Number(r.prix_m2_p25)) : null,
    prix_m2_p75: r.prix_m2_p75 != null ? Math.round(Number(r.prix_m2_p75)) : null,
    nb_ventes: r.nb_ventes,
  }));

  const first = years[0];
  const last = years[years.length - 1];
  const variation_pct_total =
    first.prix_m2_median > 0
      ? Math.round(((last.prix_m2_median - first.prix_m2_median) / first.prix_m2_median) * 100)
      : null;

  // Variation 5 ans : cherche l'année "last_year - 5"
  const targetBaseYear = last.annee - 5;
  const baseYear = years.find((y) => y.annee === targetBaseYear);
  const variation_pct_5y =
    baseYear && baseYear.prix_m2_median > 0
      ? Math.round(((last.prix_m2_median - baseYear.prix_m2_median) / baseYear.prix_m2_median) * 100)
      : null;

  return {
    available: true,
    code_commune,
    type_local,
    years,
    variation_pct_total,
    variation_pct_5y,
    annee_min: first.annee,
    annee_max: last.annee,
    source: "dvf",
    fetched_at: now,
  };
}

/**
 * Récupère l'évolution prix m² pour une commune × type sur les N dernières années.
 * Cache 7 jours via property_report_cache (clé fictive lat=0/lon=0 + hash maison).
 */
export async function getPriceEvolution(
  code_commune: string,
  type_local: string,
  years_back: number = DEFAULT_YEARS_BACK,
): Promise<PriceEvolutionResult & { cached: boolean }> {
  // Hash custom : on dérive la clé de (commune, type, years) puisque ce dataset
  // n'est pas indexé par lat/lon — on passe des coords factices (0,0) qui ne
  // servent qu'à la traçabilité du cache.
  const { createHash } = await import("crypto");
  const hash = createHash("sha256")
    .update(`price-evolution:${code_commune}:${type_local}:${years_back}`)
    .digest("hex");

  const { data, cached } = await fetchWithCache<PriceEvolutionResult>(
    hash,
    { lat: 0, lon: 0 },
    "price_evolution",
    TTL_DAYS,
    () => fetchFromDb(code_commune, type_local, years_back),
    0,
  );

  return { ...data, cached };
}

// Garde le `addressHash` import utilisé (eslint).
void addressHash;
