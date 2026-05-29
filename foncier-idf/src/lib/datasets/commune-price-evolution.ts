/**
 * DATAMERRY — Évolution prix m² au niveau COMMUNE (ou arrondissement à Paris).
 *
 * Sert de référence comparative pour le graphique d'évolution prix :
 *   - Ligne principale : cluster HDBSCAN micro-marché (200-400 m)
 *   - Ligne référence  : commune entière / arrondissement
 *
 * Permet d'argumenter le rapport vendeur de manière sourcée :
 *   « Votre micro-marché sur-performe la moyenne de la commune de +12 pts
 *     sur 5 ans. » (DVF officiel, défendable juridiquement)
 *
 * Différences vs cluster-price-evolution :
 *   - Pas de pointInPolygon (filtre direct code_commune)
 *   - Volumes annuels plus gros (600 ventes/an à Paris 4e vs 80 cluster)
 *   - Médiane plus lisse, moins de bruit sur les petites années
 *   - Sert UNIQUEMENT de référence — pas d'argument propre
 *
 * Cache 7 jours.
 */

import { addressHash, fetchWithCache } from "./_cache";
import { getSupabaseServerClient } from "../supabase-server";

const TTL_DAYS = 7;
const DEFAULT_YEARS_BACK = 8;
const MIN_VENTES_PAR_AN = 10;

export type CommunePriceYear = {
  annee: number;
  prix_m2_median: number;
  nb_ventes: number;
};

export type CommunePriceEvolutionResult = {
  available: boolean;
  reason?: string;
  code_commune: string;
  type_local: string;
  years: CommunePriceYear[];
  variation_pct_total: number | null;
  annee_min: number | null;
  annee_max: number | null;
  nb_total_ventes_commune: number;
  source: string;
  fetched_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

type DvfPoint = {
  prix_m2: number | null;
  annee: number | null;
};

async function computeFromDb(
  code_commune: string,
  type_local: string,
  years_back: number,
): Promise<CommunePriceEvolutionResult> {
  const sb = getSupabaseServerClient();
  const now = new Date().toISOString();
  const yearMin = new Date().getFullYear() - years_back;

  // Pagination Supabase : .limit() max 1000 par défaut. Pour les grosses
  // communes (Paris, Marseille) on peut avoir 5000+ ventes/an × 8 ans = 40k.
  // On agrège côté DB via une fonction RPC pour éviter le transit réseau,
  // mais pour rester simple en V1 on fait via limite haute (Supabase tolère
  // jusqu'à 50000 sur les lectures non-paginées avec le bon header).

  // Récupération brute (filtre code_commune + type + année)
  const { data: dvfRaw, error } = await sb
    .from("dvf_points")
    .select("prix_m2, annee")
    .eq("code_commune", code_commune)
    .eq("type_local", type_local)
    .gte("annee", yearMin)
    .not("prix_m2", "is", null)
    .limit(50000);

  if (error) {
    return {
      available: false,
      reason: `db_error: ${error.message}`,
      code_commune,
      type_local,
      years: [],
      variation_pct_total: null,
      annee_min: null,
      annee_max: null,
      nb_total_ventes_commune: 0,
      source: "dvf_points",
      fetched_at: now,
    };
  }

  const points = (dvfRaw ?? []) as DvfPoint[];
  const filtered = points.filter(
    (p) =>
      p.prix_m2 != null &&
      p.annee != null &&
      p.prix_m2 >= 500 &&
      p.prix_m2 <= 50000,
  );

  if (filtered.length === 0) {
    return {
      available: false,
      reason: "no_dvf_points_in_commune",
      code_commune,
      type_local,
      years: [],
      variation_pct_total: null,
      annee_min: null,
      annee_max: null,
      nb_total_ventes_commune: 0,
      source: "dvf_points",
      fetched_at: now,
    };
  }

  // Agrégation par année
  const byYear = new Map<number, number[]>();
  for (const p of filtered) {
    const y = p.annee as number;
    const arr = byYear.get(y) ?? [];
    arr.push(p.prix_m2 as number);
    byYear.set(y, arr);
  }

  const years: CommunePriceYear[] = [];
  for (const [annee, prices] of byYear.entries()) {
    if (prices.length < MIN_VENTES_PAR_AN) continue;
    const sorted = [...prices].sort((a, b) => a - b);
    years.push({
      annee,
      prix_m2_median: Math.round(median(sorted)),
      nb_ventes: prices.length,
    });
  }
  years.sort((a, b) => a.annee - b.annee);

  if (years.length === 0) {
    return {
      available: false,
      reason: "no_year_with_min_ventes",
      code_commune,
      type_local,
      years: [],
      variation_pct_total: null,
      annee_min: null,
      annee_max: null,
      nb_total_ventes_commune: filtered.length,
      source: "dvf_points",
      fetched_at: now,
    };
  }

  const first = years[0];
  const last = years[years.length - 1];
  const variation_pct_total =
    first.prix_m2_median > 0
      ? Math.round(
          ((last.prix_m2_median - first.prix_m2_median) /
            first.prix_m2_median) *
            100,
        )
      : null;

  return {
    available: years.length >= 2,
    code_commune,
    type_local,
    years,
    variation_pct_total,
    annee_min: first.annee,
    annee_max: last.annee,
    nb_total_ventes_commune: filtered.length,
    source: "dvf_points",
    fetched_at: now,
  };
}

export async function getCommunePriceEvolution(args: {
  lat: number;
  lon: number;
  code_commune: string;
  type_local: string;
  years_back?: number;
}): Promise<CommunePriceEvolutionResult & { cached: boolean }> {
  const { lat, lon, code_commune, type_local } = args;
  const years_back = args.years_back ?? DEFAULT_YEARS_BACK;
  const hash = addressHash(lat, lon);

  // Clé cache différenciée du cluster pour éviter collision
  const cacheHash = `${hash}:commune:${code_commune}:${type_local}:${years_back}`;

  const { data, cached } = await fetchWithCache<CommunePriceEvolutionResult>(
    cacheHash,
    { lat, lon },
    "price_evolution",
    TTL_DAYS,
    () => computeFromDb(code_commune, type_local, years_back),
    0,
  );

  return { ...data, cached };
}
