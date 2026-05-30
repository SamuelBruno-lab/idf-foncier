/**
 * DATAMERRY — Écoles de santé / paramédicales depuis FINESS.
 *
 * Source : data.gouv.fr — FINESS (Fichier National des Établissements
 *   Sanitaires et Sociaux), maintenu par le ministère de la Santé.
 *   API ODS : etablissements-de-sante / finess-extraction
 *
 * Complète l'ESR (`etablissements-sup.ts`) qui ne contient que les
 * établissements rattachés à un université. FINESS couvre aussi les :
 *   - IFSI privés (cliniques, congrégations)
 *   - IFAS / IFAP (aides-soignants, auxiliaires puériculture)
 *   - écoles de kinésithérapie privées
 *   - écoles d'ostéopathie
 *   - écoles dentaires privées
 *   - écoles vétérinaires
 *   - écoles d'orthophonie / orthoptie / psychomotricité
 *
 * Cache 180 jours (FINESS bouge peu).
 */

import { addressHash, fetchWithCache, haversineMeters } from "./_cache";

// API ODS data.gouv.fr — dataset "finess-extraction-du-fichier-des-etablissements"
const ODS_BASE =
  "https://www.data.gouv.fr/api/explore/v2.1/catalog/datasets/" +
  "finess-extraction-du-fichier-des-etablissements/records";

const DEFAULT_RADIUS_M = 10000;
const TTL_DAYS = 180;
const TIMEOUT_MS = 6000;

/**
 * Codes de catégorie FINESS pertinents pour les écoles de santé /
 * formation paramédicale. Liste calibrée à partir de la nomenclature
 * FINESS publique (chapitre 03/04 — Formations sanitaires & sociales).
 */
const CATEGORIES_SANTE = [
  // Soins infirmiers
  "Institut de Formation en Soins Infirmiers",
  "I.F.S.I.",
  // Aides-soignants / auxiliaires puériculture
  "Institut de Formation d'Aides-Soignants",
  "I.F.A.S.",
  "Institut de Formation d'Auxiliaires de Puériculture",
  "I.F.A.P.",
  // Sage-femme
  "École de Sages-Femmes",
  "Maïeutique",
  // Kiné / réeducation
  "Institut de Formation en Masso-Kinésithérapie",
  "I.F.M.K.",
  "Institut de Formation en Pédicurie-Podologie",
  "Institut de Formation en Ergothérapie",
  "Institut de Formation en Psychomotricité",
  // Ortho
  "Centre de Formation Universitaire en Orthophonie",
  "Centre de Formation d'Orthoptie",
  // Manipulateurs radio
  "Institut de Formation de Manipulateurs",
  "I.F.M.E.M.",
  // Ambulanciers, auxiliaires
  "Institut de Formation d'Ambulanciers",
  // Autres
  "Centre de Formation Sanitaire et Social",
];

export type EcoleSante = {
  finess: string;
  nom: string;
  /** Catégorie FINESS brute (cf. liste CATEGORIES_SANTE). */
  categorie_finess: string;
  /** Catégorie normalisée pour affichage PDF. */
  type: "ifsi" | "ifas_ifap" | "kine_ortho" | "sage_femme" | "autre_sante";
  commune: string;
  lat: number;
  lon: number;
  distance_m: number;
};

export type EcolesSanteResult = {
  available: boolean;
  count: number;
  top: EcoleSante[];
  source: string;
  fetched_at: string;
};

function normalizeType(cat: string): EcoleSante["type"] {
  const c = cat.toLowerCase();
  if (c.includes("soins infirmiers") || c.includes("i.f.s.i")) return "ifsi";
  if (c.includes("aides-soignants") || c.includes("i.f.a.s") || c.includes("auxiliaires de puériculture") || c.includes("i.f.a.p"))
    return "ifas_ifap";
  if (c.includes("masso-kinésithérapie") || c.includes("podologie") || c.includes("ergothérapie") || c.includes("psychomotricité") || c.includes("orthophonie") || c.includes("orthoptie"))
    return "kine_ortho";
  if (c.includes("sages-femmes") || c.includes("maïeutique")) return "sage_femme";
  return "autre_sante";
}

type OdsRecord = {
  nofinesset?: string;
  nofinessej?: string;
  rs?: string; // raison sociale
  rslongue?: string;
  libcategetab?: string; // libellé catégorie d'établissement
  categetab?: string;
  commune?: string;
  libcommune?: string;
  coordxet?: number | string;
  coordyet?: number | string;
  coordonnees?: { lat?: number; lon?: number } | { type?: string; coordinates?: number[] };
};

function pickCoords(rec: OdsRecord): { lat: number; lon: number } | null {
  if (rec.coordonnees && typeof rec.coordonnees === "object") {
    if ("lat" in rec.coordonnees && "lon" in rec.coordonnees && rec.coordonnees.lat != null && rec.coordonnees.lon != null) {
      return { lat: Number(rec.coordonnees.lat), lon: Number(rec.coordonnees.lon) };
    }
    if (
      "coordinates" in rec.coordonnees &&
      Array.isArray((rec.coordonnees as { coordinates: number[] }).coordinates)
    ) {
      const arr = (rec.coordonnees as { coordinates: number[] }).coordinates;
      if (arr.length >= 2) return { lat: Number(arr[1]), lon: Number(arr[0]) };
    }
  }
  return null;
}

async function fetchFromFiness(
  lat: number,
  lon: number,
  radius_m: number,
): Promise<EcolesSanteResult> {
  const now = new Date().toISOString();

  // Filtre par catégorie d'établissement (OR sur les libellés FINESS)
  // Note : ODS ne supporte pas IN sur texte exact → on combine where=cat:"X" OR cat:"Y"
  // Plus simple : récupère tout puis filtre côté JS.
  // Pour limiter le volume, on filtre par mot-clé "formation" (présent dans toutes les catégories formation).
  const where = `within_distance(coordonnees, geom'POINT(${lon} ${lat})', ${radius_m}m) AND search("formation")`;
  const order = `distance(coordonnees, geom'POINT(${lon} ${lat})')`;
  const params = new URLSearchParams({
    where,
    order_by: order,
    limit: "50",
  });

  try {
    const res = await fetch(`${ODS_BASE}?${params.toString()}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        available: false,
        count: 0,
        top: [],
        source: `FINESS (HTTP ${res.status})`,
        fetched_at: now,
      };
    }
    const json = (await res.json()) as { results?: OdsRecord[] };
    const records = json.results ?? [];

    const byFiness = new Map<string, EcoleSante>();
    for (const rec of records) {
      const cat = rec.libcategetab ?? "";
      // Match si la catégorie FINESS est dans la liste OU contient un mot-clé santé
      const isSante = CATEGORIES_SANTE.some((k) => cat.toLowerCase().includes(k.toLowerCase()));
      if (!isSante) continue;
      const coords = pickCoords(rec);
      if (!coords) continue;
      const finess = (rec.nofinesset ?? rec.nofinessej ?? "").trim();
      if (!finess) continue;
      const nom = rec.rslongue ?? rec.rs ?? "Établissement non identifié";
      const distance_m = Math.round(haversineMeters(lat, lon, coords.lat, coords.lon));
      const existing = byFiness.get(finess);
      if (existing && existing.distance_m <= distance_m) continue;
      byFiness.set(finess, {
        finess,
        nom,
        categorie_finess: cat,
        type: normalizeType(cat),
        commune: rec.libcommune ?? rec.commune ?? "",
        lat: coords.lat,
        lon: coords.lon,
        distance_m,
      });
    }

    const items = Array.from(byFiness.values()).sort((a, b) => a.distance_m - b.distance_m);
    const top = items.slice(0, 5);

    return {
      available: top.length > 0,
      count: items.length,
      top,
      source: "data.gouv.fr (FINESS extraction)",
      fetched_at: now,
    };
  } catch (err) {
    return {
      available: false,
      count: 0,
      top: [],
      source: `FINESS (error: ${err instanceof Error ? err.message : "unknown"})`,
      fetched_at: now,
    };
  }
}

export async function getEcolesSanteFiness(
  lat: number,
  lon: number,
  radius_m: number = DEFAULT_RADIUS_M,
): Promise<EcolesSanteResult & { cached: boolean }> {
  const hash = addressHash(lat, lon);

  const { data, cached } = await fetchWithCache<EcolesSanteResult>(
    hash,
    { lat, lon },
    "ecoles_sante_finess_10km",
    TTL_DAYS,
    () => fetchFromFiness(lat, lon, radius_m),
    0,
    (r) => r.available && r.count > 0,
  );

  return { ...data, cached };
}
