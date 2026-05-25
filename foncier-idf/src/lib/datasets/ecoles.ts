/**
 * DATAMERRY — Écoles à proximité d'une adresse.
 *
 * Source : Annuaire de l'Éducation Nationale (data.education.gouv.fr)
 *   Dataset : fr-en-annuaire-education
 *   API ODS v2.1 — gratuite, illimitée, pas d'auth
 *
 * Renvoie pour chaque école : nom, type (maternelle/élémentaire/collège/lycée),
 * statut (public/privé), distance (Haversine), adresse complète.
 *
 * TTL cache : 30 jours (peu de mouvement d'établissements en cours d'année).
 * Coût : 0 € (API publique).
 */

import { addressHash, fetchWithCache, haversineMeters } from "./_cache";

const DEFAULT_RADIUS_M = 1500; // 1.5 km = à pied / vélo en zone dense
const DEFAULT_LIMIT = 30; // au-delà on commence à saturer le rapport
const TTL_DAYS = 30;

const ODS_BASE =
  "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-annuaire-education/records";

export type Ecole = {
  identifiant: string;
  nom: string;
  type: string;
  nature: string;
  statut: "public" | "prive" | "inconnu";
  adresse: string;
  code_postal: string;
  commune: string;
  lat: number;
  lon: number;
  distance_m: number;
  walk_minutes: number;
};

export type EcolesResult = {
  available: boolean;
  count: number;
  radius_m: number;
  par_type: Record<string, number>;
  par_statut: Record<string, number>;
  ecoles: Ecole[];
  source: string;
  fetched_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function normalizeStatut(raw: string | null): "public" | "prive" | "inconnu" {
  if (!raw) return "inconnu";
  const v = raw.toLowerCase();
  if (v.includes("priv")) return "prive";
  if (v.includes("publ")) return "public";
  return "inconnu";
}

/**
 * Estim. temps de marche moyen = ~80m/min en ville (vitesse marche piéton).
 * Compromis Google Maps-like.
 */
function walkMinutes(distanceM: number): number {
  return Math.round(distanceM / 80);
}

// ──────────────────────────────────────────────────────────────────────────────
// Fetcher (uncached)
// ──────────────────────────────────────────────────────────────────────────────

async function fetchEcolesFromODS(
  lat: number,
  lon: number,
  radiusM: number,
  limit: number,
): Promise<EcolesResult> {
  // ODS v2.1 : where=within_distance(position,geom'POINT(lon lat)',1500m)
  // (la doc préfère within_distance ; geo_point_2d est le champ standard)
  const whereClause = `within_distance(position, GEOM'POINT(${lon} ${lat})', ${radiusM}m)`;
  const params = new URLSearchParams({
    where: whereClause,
    limit: String(limit),
    select: [
      "identifiant_de_l_etablissement",
      "nom_etablissement",
      "type_etablissement",
      "nature_uai",
      "statut_public_prive",
      "adresse_1",
      "code_postal",
      "nom_commune",
      "position",
    ].join(","),
  });

  const url = `${ODS_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) {
    return {
      available: false,
      count: 0,
      radius_m: radiusM,
      par_type: {},
      par_statut: {},
      ecoles: [],
      source: "data.education.gouv.fr",
      fetched_at: new Date().toISOString(),
    };
  }

  const json = (await res.json()) as {
    results: Array<{
      identifiant_de_l_etablissement: string;
      nom_etablissement: string | null;
      type_etablissement: string | null;
      nature_uai: string | null;
      statut_public_prive: string | null;
      adresse_1: string | null;
      code_postal: string | null;
      nom_commune: string | null;
      position: { lat: number; lon: number } | null;
    }>;
  };

  const items: Ecole[] = [];
  for (const r of json.results ?? []) {
    if (!r.position) continue;
    const d = haversineMeters(lat, lon, r.position.lat, r.position.lon);
    items.push({
      identifiant: r.identifiant_de_l_etablissement,
      nom: r.nom_etablissement ?? "",
      type: r.type_etablissement ?? "",
      nature: r.nature_uai ?? "",
      statut: normalizeStatut(r.statut_public_prive),
      adresse: r.adresse_1 ?? "",
      code_postal: r.code_postal ?? "",
      commune: r.nom_commune ?? "",
      lat: r.position.lat,
      lon: r.position.lon,
      distance_m: Math.round(d),
      walk_minutes: walkMinutes(d),
    });
  }

  items.sort((a, b) => a.distance_m - b.distance_m);

  // Agrégations utiles pour le rapport (l'agent veut voir "3 écoles + 1 collège")
  const par_type: Record<string, number> = {};
  const par_statut: Record<string, number> = { public: 0, prive: 0, inconnu: 0 };
  for (const e of items) {
    par_type[e.type] = (par_type[e.type] ?? 0) + 1;
    par_statut[e.statut] = (par_statut[e.statut] ?? 0) + 1;
  }

  return {
    available: items.length > 0,
    count: items.length,
    radius_m: radiusM,
    par_type,
    par_statut,
    ecoles: items,
    source: "data.education.gouv.fr (fr-en-annuaire-education)",
    fetched_at: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique (avec cache)
// ──────────────────────────────────────────────────────────────────────────────

export type GetEcolesOptions = {
  radiusM?: number;
  limit?: number;
  forceRefresh?: boolean;
};

export async function getEcoles(
  lat: number,
  lon: number,
  opts: GetEcolesOptions = {},
): Promise<EcolesResult & { cached: boolean }> {
  const radiusM = opts.radiusM ?? DEFAULT_RADIUS_M;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const hash = addressHash(lat, lon);

  const { data, cached } = await fetchWithCache<EcolesResult>(
    hash,
    { lat, lon },
    "ecoles",
    TTL_DAYS,
    () => fetchEcolesFromODS(lat, lon, radiusM, limit),
    0, // gratuit
  );

  return { ...data, cached };
}
