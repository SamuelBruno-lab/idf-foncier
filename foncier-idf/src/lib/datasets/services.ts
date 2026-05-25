/**
 * DATAMERRY — Services de proximité (commerces, santé, éducation hors écoles).
 *
 * Source : Overpass API (OpenStreetMap)
 *
 * Catégories renvoyées (alignées sur ce qu'un agent immo met en argumentaire) :
 *   - commerces      : boulangerie, supermarché, café, restaurant
 *   - sante          : médecin généraliste, pharmacie, hôpital
 *   - sport_loisirs  : salle de sport, parc, piscine
 *   - culture        : bibliothèque, cinéma, musée
 *   - quotidien      : poste, banque, distributeur
 *
 * TTL cache : 14 jours (commerces ouvrent/ferment plus vite que les écoles).
 * Coût : 0 € (Overpass public).
 */

import { addressHash, fetchWithCache, haversineMeters } from "./_cache";

const DEFAULT_RADIUS_M = 500; // 500m = pied immédiat
const DEFAULT_LIMIT = 100;
const TTL_DAYS = 14;
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

type ServiceCategory =
  | "commerces"
  | "sante"
  | "sport_loisirs"
  | "culture"
  | "quotidien";

export type Service = {
  osm_id: number;
  nom: string;
  categorie: ServiceCategory;
  sous_type: string;
  lat: number;
  lon: number;
  distance_m: number;
  walk_minutes: number;
};

export type ServicesResult = {
  available: boolean;
  count: number;
  radius_m: number;
  par_categorie: Record<ServiceCategory, number>;
  top_par_categorie: Record<ServiceCategory, Service[]>;
  score_quotidien: number; // 0-100 : à quel point on peut vivre sans bagnole
  source: string;
  fetched_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Catégorisation OSM → catégorie DATAMERRY
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Map tag OSM (amenity / shop / healthcare / leisure) → catégorie DATAMERRY.
 * Sous-type = le tag OSM brut (utile pour le rapport : "boulangerie", "supermarché").
 */
function categorize(
  tags: Record<string, string>,
): { categorie: ServiceCategory; sous_type: string } | null {
  // Commerces
  const shop = tags.shop;
  if (shop) {
    if (
      [
        "bakery",
        "supermarket",
        "convenience",
        "butcher",
        "greengrocer",
        "deli",
        "wine",
        "cheese",
      ].includes(shop)
    ) {
      return { categorie: "commerces", sous_type: shop };
    }
    return { categorie: "commerces", sous_type: shop };
  }

  const amenity = tags.amenity;
  if (!amenity) {
    // healthcare hors amenity
    const hc = tags.healthcare;
    if (hc) return { categorie: "sante", sous_type: hc };
    // leisure
    const leisure = tags.leisure;
    if (leisure)
      return { categorie: "sport_loisirs", sous_type: leisure };
    return null;
  }

  // Restauration
  if (["restaurant", "cafe", "bar", "fast_food", "pub"].includes(amenity)) {
    return { categorie: "commerces", sous_type: amenity };
  }
  // Santé
  if (["pharmacy", "doctors", "clinic", "hospital", "dentist"].includes(amenity)) {
    return { categorie: "sante", sous_type: amenity };
  }
  // Quotidien
  if (
    [
      "post_office",
      "post_box",
      "bank",
      "atm",
      "police",
      "fuel",
      "marketplace",
    ].includes(amenity)
  ) {
    return { categorie: "quotidien", sous_type: amenity };
  }
  // Sport/loisirs
  if (
    ["gym", "swimming_pool", "fitness_centre", "fitness_station", "park"].includes(
      amenity,
    )
  ) {
    return { categorie: "sport_loisirs", sous_type: amenity };
  }
  // Culture
  if (
    [
      "library",
      "cinema",
      "theatre",
      "museum",
      "arts_centre",
      "community_centre",
    ].includes(amenity)
  ) {
    return { categorie: "culture", sous_type: amenity };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Score "ville à 15 minutes" — heuristique
// ──────────────────────────────────────────────────────────────────────────────

function computeScore(byCategory: Record<ServiceCategory, Service[]>): number {
  // Idée : pour chaque catégorie, on regarde la distance du plus proche.
  // Catégorie satisfaite < 400m → +20 pts ; < 800m → +10 ; sinon 0.
  const cats: ServiceCategory[] = [
    "commerces",
    "sante",
    "quotidien",
    "sport_loisirs",
    "culture",
  ];
  let score = 0;
  for (const cat of cats) {
    const closest = byCategory[cat]?.[0];
    if (!closest) continue;
    if (closest.distance_m < 400) score += 20;
    else if (closest.distance_m < 800) score += 10;
  }
  return Math.min(100, score);
}

function walkMinutes(distanceM: number): number {
  return Math.round(distanceM / 80);
}

// ──────────────────────────────────────────────────────────────────────────────
// Fetcher
// ──────────────────────────────────────────────────────────────────────────────

async function fetchServicesFromOverpass(
  lat: number,
  lon: number,
  radiusM: number,
  limit: number,
): Promise<ServicesResult> {
  const query = `
[out:json][timeout:8];
(
  node["shop"](around:${radiusM},${lat},${lon});
  node["amenity"](around:${radiusM},${lat},${lon});
  node["healthcare"](around:${radiusM},${lat},${lon});
  node["leisure"](around:${radiusM},${lat},${lon});
);
out body ${limit};
`;

  let res: Response;
  try {
    res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.warn("[services] Overpass timeout/network:", err);
    return emptyResult(radiusM);
  }

  if (!res.ok) return emptyResult(radiusM);

  const json = (await res.json()) as {
    elements: Array<{
      type: string;
      id: number;
      lat: number;
      lon: number;
      tags?: Record<string, string>;
    }>;
  };

  const items: Service[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== "node") continue;
    const tags = el.tags ?? {};
    const cat = categorize(tags);
    if (!cat) continue;
    const d = haversineMeters(lat, lon, el.lat, el.lon);
    items.push({
      osm_id: el.id,
      nom: tags.name ?? tags["brand"] ?? cat.sous_type,
      categorie: cat.categorie,
      sous_type: cat.sous_type,
      lat: el.lat,
      lon: el.lon,
      distance_m: Math.round(d),
      walk_minutes: walkMinutes(d),
    });
  }
  items.sort((a, b) => a.distance_m - b.distance_m);

  // Group by catégorie + on garde le top 5 le plus proche
  const par_categorie: Record<ServiceCategory, number> = {
    commerces: 0,
    sante: 0,
    sport_loisirs: 0,
    culture: 0,
    quotidien: 0,
  };
  const top_par_categorie: Record<ServiceCategory, Service[]> = {
    commerces: [],
    sante: [],
    sport_loisirs: [],
    culture: [],
    quotidien: [],
  };
  for (const s of items) {
    par_categorie[s.categorie] = (par_categorie[s.categorie] ?? 0) + 1;
    if (top_par_categorie[s.categorie].length < 5) {
      top_par_categorie[s.categorie].push(s);
    }
  }

  return {
    available: items.length > 0,
    count: items.length,
    radius_m: radiusM,
    par_categorie,
    top_par_categorie,
    score_quotidien: computeScore(top_par_categorie),
    source: "OpenStreetMap (Overpass API)",
    fetched_at: new Date().toISOString(),
  };
}

function emptyResult(radiusM: number): ServicesResult {
  return {
    available: false,
    count: 0,
    radius_m: radiusM,
    par_categorie: {
      commerces: 0,
      sante: 0,
      sport_loisirs: 0,
      culture: 0,
      quotidien: 0,
    },
    top_par_categorie: {
      commerces: [],
      sante: [],
      sport_loisirs: [],
      culture: [],
      quotidien: [],
    },
    score_quotidien: 0,
    source: "OpenStreetMap (Overpass API)",
    fetched_at: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────────────────────

export type GetServicesOptions = {
  radiusM?: number;
  limit?: number;
};

export async function getServices(
  lat: number,
  lon: number,
  opts: GetServicesOptions = {},
): Promise<ServicesResult & { cached: boolean }> {
  const radiusM = opts.radiusM ?? DEFAULT_RADIUS_M;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const hash = addressHash(lat, lon);

  const { data, cached } = await fetchWithCache<ServicesResult>(
    hash,
    { lat, lon },
    "services_proximite",
    TTL_DAYS,
    () => fetchServicesFromOverpass(lat, lon, radiusM, limit),
    0,
  );

  return { ...data, cached };
}
