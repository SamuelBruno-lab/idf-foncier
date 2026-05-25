/**
 * DATAMERRY — DPE (Diagnostic de Performance Énergétique) par adresse.
 *
 * Source : ADEME data.gouv.fr (open data, gratuit illimité)
 *   Dataset : dpe-v2-logements-existants (post juillet 2021 — méthode 3CL-2021)
 *   API ODS : https://data.ademe.fr/api/explore/v2.1/catalog/datasets/dpe-v2-logements-existants/records
 *
 * Cache : 90 jours (un DPE est valable 10 ans en théorie, mais la base peut
 * être mise à jour si nouveau diagnostic effectué).
 *
 * Stratégie de recherche :
 *   1. Match exact sur adresse + code postal (le plus précis)
 *   2. Si pas trouvé, recherche par rayon géo 50m via filtres `within_distance`
 *   3. Si plusieurs DPE matchent, on prend le plus récent
 */

import { addressHash, fetchWithCache } from "./_cache";

const ADEME_BASE =
  "https://data.ademe.fr/api/explore/v2.1/catalog/datasets/dpe-v2-logements-existants/records";

const TTL_DAYS = 90;
const SEARCH_RADIUS_M = 50;
const DEFAULT_LIMIT = 5;

export type DpeRecord = {
  available: boolean;
  energy_class: string | null;     // A à G
  ges_class: string | null;        // A à G
  energy_kwh_m2_an: number | null;
  ges_kg_co2_m2_an: number | null;
  surface_habitable: number | null;
  annee_construction: number | null;
  type_batiment: string | null;
  date_etablissement: string | null;
  date_fin_validite: string | null;
  numero_dpe: string | null;
  adresse_match: string | null;
  distance_m: number | null;
  source: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Fetcher
// ──────────────────────────────────────────────────────────────────────────────

async function fetchDpeFromAdeme(
  lat: number,
  lon: number,
  postcode?: string,
): Promise<DpeRecord> {
  // 1) Tentative : within_distance geo
  const whereClause = `within_distance(_geopoint, GEOM'POINT(${lon} ${lat})', ${SEARCH_RADIUS_M}m)${postcode ? ` AND code_postal_ban='${postcode}'` : ""}`;
  const params = new URLSearchParams({
    where: whereClause,
    order_by: "date_etablissement_dpe DESC",
    limit: String(DEFAULT_LIMIT),
    select: [
      "n_dpe",
      "etiquette_dpe",
      "etiquette_ges",
      "conso_5_usages_par_m2_ep",
      "emission_ges_5_usages_par_m2",
      "surface_habitable_logement",
      "annee_construction",
      "type_batiment",
      "date_etablissement_dpe",
      "date_fin_validite_dpe",
      "adresse_ban",
      "_geopoint",
    ].join(","),
  });

  const url = `${ADEME_BASE}?${params.toString()}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    console.warn("[dpe] ADEME timeout:", err);
    return emptyRecord();
  }
  if (!res.ok) return emptyRecord();

  const json = (await res.json()) as {
    total_count?: number;
    results?: Array<{
      n_dpe?: string;
      etiquette_dpe?: string;
      etiquette_ges?: string;
      conso_5_usages_par_m2_ep?: number;
      emission_ges_5_usages_par_m2?: number;
      surface_habitable_logement?: number;
      annee_construction?: number;
      type_batiment?: string;
      date_etablissement_dpe?: string;
      date_fin_validite_dpe?: string;
      adresse_ban?: string;
      _geopoint?: { lat: number; lon: number } | null;
    }>;
  };

  const first = json.results?.[0];
  if (!first) return emptyRecord();

  // Distance Haversine pour info
  let dist: number | null = null;
  if (first._geopoint) {
    const R = 6_371_000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(first._geopoint.lat - lat);
    const dLon = toRad(first._geopoint.lon - lon);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat)) *
        Math.cos(toRad(first._geopoint.lat)) *
        Math.sin(dLon / 2) ** 2;
    dist = Math.round(2 * R * Math.asin(Math.sqrt(a)));
  }

  return {
    available: true,
    energy_class: first.etiquette_dpe ?? null,
    ges_class: first.etiquette_ges ?? null,
    energy_kwh_m2_an: first.conso_5_usages_par_m2_ep ?? null,
    ges_kg_co2_m2_an: first.emission_ges_5_usages_par_m2 ?? null,
    surface_habitable: first.surface_habitable_logement ?? null,
    annee_construction: first.annee_construction ?? null,
    type_batiment: first.type_batiment ?? null,
    date_etablissement: first.date_etablissement_dpe ?? null,
    date_fin_validite: first.date_fin_validite_dpe ?? null,
    numero_dpe: first.n_dpe ?? null,
    adresse_match: first.adresse_ban ?? null,
    distance_m: dist,
    source: "ADEME data.gouv.fr (dpe-v2-logements-existants)",
  };
}

function emptyRecord(): DpeRecord {
  return {
    available: false,
    energy_class: null,
    ges_class: null,
    energy_kwh_m2_an: null,
    ges_kg_co2_m2_an: null,
    surface_habitable: null,
    annee_construction: null,
    type_batiment: null,
    date_etablissement: null,
    date_fin_validite: null,
    numero_dpe: null,
    adresse_match: null,
    distance_m: null,
    source: "ADEME data.gouv.fr (dpe-v2-logements-existants)",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique (avec cache)
// ──────────────────────────────────────────────────────────────────────────────

export async function getDpe(
  lat: number,
  lon: number,
  postcode?: string,
): Promise<DpeRecord & { cached: boolean }> {
  const hash = addressHash(lat, lon);
  const { data, cached } = await fetchWithCache<DpeRecord>(
    hash,
    { lat, lon },
    "dpe",
    TTL_DAYS,
    () => fetchDpeFromAdeme(lat, lon, postcode),
    0,
  );
  return { ...data, cached };
}
