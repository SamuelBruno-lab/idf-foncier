/**
 * DATAMERRY — Équipements locaux à proximité (sport + scolaire).
 *
 * Complète les POI notables (filtrés Wikipedia=*) avec les équipements
 * LOCAUX qui n'ont pas la notoriété nationale mais qui pèsent dans la
 * décision d'un acheteur famille au quotidien.
 *
 * Cas d'usage qui a déclenché ce dataset (test Drancy 62 m²) :
 *   - 3 stades à < 500 m : Stade Dewerpe, Stade Charles Sage, Stade Nautique
 *   - École maternelle adjacente à la copro (< 100 m)
 *   - Lycée du secteur à proximité
 *   Aucun de ces équipements n'a un sitelinks Wikipedia suffisant pour
 *   apparaître dans le dataset POI notables. Pourtant, c'est exactement
 *   ce qui rassure un acheteur famille.
 *
 * Source : Overpass API (OpenStreetMap)
 *   Sport / loisirs :
 *     - leisure=stadium       (stades de toute taille)
 *     - leisure=sports_centre (complexes sportifs)
 *     - leisure=swimming_pool (piscines/stades nautiques)
 *     - leisure=pitch         (terrains — uniquement si nom = "stade X")
 *     - leisure=track         (pistes d'athlétisme)
 *     - leisure=fitness_centre (salles de remise en forme)
 *   Scolaire (hors lycée — déjà couvert par dataset lycees-bac) :
 *     - amenity=kindergarten  (maternelles)
 *     - amenity=school        (élémentaires + collèges)
 *     - amenity=college       (établissements supérieurs)
 *
 * On NE filtre PAS sur wikipedia=* — c'est de l'équipement local, par
 * nature peu wikipédié.
 *
 * Rayons :
 *   - Adjacent : < 300 m
 *   - À pied :   < 800 m
 *   - Quartier : < 1200 m
 *
 * Cache 30 jours (les équipements OSM bougent peu).
 */

import { addressHash, fetchWithCache } from "./_cache";
import { getSupabaseServerClient } from "../supabase-server";

const DEFAULT_RADIUS_M = 1200;
const TTL_DAYS = 30;
// Overpass main est parfois lent (10-15s sur queries multi-tags).
// 20s est défensif : si ça timeout vraiment, c'est qu'Overpass est down.
const TIMEOUT_MS = 20000;
// Plusieurs miroirs Overpass — on essaie successivement si le premier
// timeout. Le main est le plus à jour mais aussi le plus chargé.
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.openstreetmap.fr/api/interpreter",
];

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type EquipementType =
  | "stade"
  | "complexe_sportif"
  | "piscine"
  | "terrain"
  | "fitness"
  | "maternelle"
  | "ecole"
  | "college";

export type EquipementLocal = {
  osm_id: number;
  nom: string;
  type: EquipementType;
  lat: number;
  lon: number;
  distance_m: number;
  /** "adjacent" < 300 m, "a_pied" 300-800 m, "quartier" 800-1200 m */
  proximite: "adjacent" | "a_pied" | "quartier";
};

export type ProximiteLocaleResult = {
  available: boolean;
  count: number;
  /** Sport et loisirs (max 4) */
  sport: EquipementLocal[];
  /** Établissements scolaires hors lycée (max 4) */
  scolaire: EquipementLocal[];
  source: string;
  fetched_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

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

function proximiteFromDistance(
  distance_m: number,
): "adjacent" | "a_pied" | "quartier" {
  if (distance_m < 300) return "adjacent";
  if (distance_m < 800) return "a_pied";
  return "quartier";
}

/**
 * Détermine le type fonctionnel à partir des tags OSM.
 * Renvoie null si l'élément ne nous intéresse pas (filtre éditorial).
 */
function classifyEquipement(
  tags: Record<string, string> | undefined,
): EquipementType | null {
  if (!tags) return null;
  const leisure = (tags.leisure ?? "").toLowerCase();
  const amenity = (tags.amenity ?? "").toLowerCase();
  const sport = (tags.sport ?? "").toLowerCase();

  // Sport / loisirs
  if (leisure === "stadium") return "stade";
  if (leisure === "sports_centre") return "complexe_sportif";
  if (leisure === "swimming_pool") return "piscine";
  if (leisure === "fitness_centre") return "fitness";
  if (leisure === "track") return "terrain";
  // pitch (terrain) : on n'accepte QUE s'il a un nom propre style "Stade X",
  // sinon trop bruité (terrains de quartier sans nom)
  if (leisure === "pitch") {
    const name = (tags.name ?? "").toLowerCase();
    if (name.startsWith("stade ") || name.includes("complexe sportif"))
      return "terrain";
    return null;
  }

  // Scolaire (hors lycée)
  if (amenity === "kindergarten") return "maternelle";
  if (amenity === "school") {
    // Filtre lycée : déjà couvert par dataset lycees-bac
    const schoolType = (tags["school:FR"] ?? tags.school_type ?? "").toLowerCase();
    if (schoolType.includes("lyc")) return null;
    return "ecole";
  }
  if (amenity === "college") return "college";

  return null;
}

/**
 * Filtre : exclure les éléments sans nom (équipements anonymes peu vendeurs).
 */
function hasUsableName(tags: Record<string, string> | undefined): boolean {
  if (!tags || !tags.name) return false;
  const name = tags.name.trim();
  if (name.length < 3) return false;
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Overpass
// ──────────────────────────────────────────────────────────────────────────────

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

/**
 * Génère un nom de fallback raisonnable quand le tag `name` est absent
 * (cas fréquent pour les maternelles et stades de quartier — OSM mal taggé).
 */
function fallbackName(
  type: EquipementType,
  tags: Record<string, string>,
): string {
  // Cherche un nom alternatif dans les tags
  const alt =
    tags["name:fr"] ??
    tags["short_name"] ??
    tags["official_name"] ??
    tags["operator"] ??
    tags["brand"];
  if (alt && alt.trim().length >= 3) return alt.trim();

  // Fallback générique par type
  const labels: Record<EquipementType, string> = {
    stade: "Stade",
    complexe_sportif: "Complexe sportif",
    piscine: "Piscine",
    terrain: "Terrain de sport",
    fitness: "Salle de sport",
    maternelle: "École maternelle",
    ecole: "École",
    college: "Collège",
  };
  return labels[type];
}

async function tryFetchOverpass(
  url: string,
  query: string,
): Promise<OverpassResponse | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as OverpassResponse;
  } catch {
    return null;
  }
}

async function fetchFromOverpass(
  lat: number,
  lon: number,
  radius_m: number,
): Promise<EquipementLocal[]> {
  const query = `
[out:json][timeout:25];
(
  node["leisure"~"^(stadium|sports_centre|swimming_pool|pitch|track|fitness_centre)$"](around:${radius_m},${lat},${lon});
  way["leisure"~"^(stadium|sports_centre|swimming_pool|pitch|track|fitness_centre)$"](around:${radius_m},${lat},${lon});
  relation["leisure"~"^(stadium|sports_centre|swimming_pool|pitch|track|fitness_centre)$"](around:${radius_m},${lat},${lon});
  node["amenity"~"^(kindergarten|school|college)$"](around:${radius_m},${lat},${lon});
  way["amenity"~"^(kindergarten|school|college)$"](around:${radius_m},${lat},${lon});
);
out center tags;
  `.trim();

  // Cascade sur les 3 miroirs Overpass — résilience aux downtimes
  let json: OverpassResponse | null = null;
  for (const url of OVERPASS_URLS) {
    json = await tryFetchOverpass(url, query);
    if (json) break;
    console.warn(`[proximite-locale] overpass ${url} failed, trying next`);
  }
  if (!json) {
    console.warn("[proximite-locale] all overpass mirrors failed");
    return [];
  }
  const elements = json.elements ?? [];

  const equipements: EquipementLocal[] = [];
  const seen = new Set<number>();

  for (const el of elements) {
    if (seen.has(el.id)) continue;
    const tags = el.tags;
    if (!tags) continue;
    const type = classifyEquipement(tags);
    if (!type) continue;

    const elLat = el.lat ?? el.center?.lat;
    const elLon = el.lon ?? el.center?.lon;
    if (elLat == null || elLon == null) continue;

    const distance_m = Math.round(haversineM(lat, lon, elLat, elLon));
    if (distance_m > radius_m) continue;

    // Nom : si pas de tag `name`, on génère un nom de fallback (École
    // maternelle, Stade, etc.) — sinon on perd l'équipement alors qu'il
    // est utile vendeur ("École maternelle à 80 m" reste informatif).
    const nom =
      tags.name && tags.name.trim().length >= 3
        ? tags.name.trim()
        : fallbackName(type, tags);

    seen.add(el.id);
    equipements.push({
      osm_id: el.id,
      nom,
      type,
      lat: elLat,
      lon: elLon,
      distance_m,
      proximite: proximiteFromDistance(distance_m),
    });
  }

  return equipements;
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Tente d'abord la table Supabase dim_poi_local (ingestion batch fiable),
 * fallback Overpass si DB vide pour la zone.
 */
async function fetchFromDb(
  lat: number,
  lon: number,
  radius_m: number,
): Promise<EquipementLocal[]> {
  try {
    const sb = getSupabaseServerClient();
    const { data, error } = await sb.rpc("find_nearby_poi_local", {
      p_lat: lat,
      p_lon: lon,
      p_max_distance_m: radius_m,
      p_categories: null,
      p_limit: 12,
    });
    if (error) {
      console.warn("[proximite-locale] db rpc error:", error.message);
      return [];
    }
    if (!data || !Array.isArray(data) || data.length === 0) return [];
    return data.map(
      (r: {
        id: number;
        nom: string;
        type_local: string;
        lat: number;
        lon: number;
        distance_m: number;
      }) => ({
        osm_id: r.id,
        nom: r.nom,
        type: r.type_local as EquipementType,
        lat: r.lat,
        lon: r.lon,
        distance_m: r.distance_m,
        proximite: proximiteFromDistance(r.distance_m),
      }),
    );
  } catch (err) {
    console.warn(
      `[proximite-locale] db exception: ${err instanceof Error ? err.message : "unknown"}`,
    );
    return [];
  }
}

async function computeProximiteLocale(
  lat: number,
  lon: number,
  radius_m: number,
): Promise<ProximiteLocaleResult> {
  const now = new Date().toISOString();
  // 1) Essai DB (fiable, rapide ~50ms) — populée par pipeline batch Overpass
  let elements = await fetchFromDb(lat, lon, radius_m);
  // 2) Fallback Overpass live (lent, fragile) si DB vide
  if (elements.length === 0) {
    elements = await fetchFromOverpass(lat, lon, radius_m);
  }

  if (elements.length === 0) {
    return {
      available: false,
      count: 0,
      sport: [],
      scolaire: [],
      source: "overpass",
      fetched_at: now,
    };
  }

  // Séparation sport / scolaire
  const isSport = (t: EquipementType) =>
    ["stade", "complexe_sportif", "piscine", "terrain", "fitness"].includes(t);
  const isScolaire = (t: EquipementType) =>
    ["maternelle", "ecole", "college"].includes(t);

  // Tri par distance ascendante + dédoublonnage par nom proche
  const sortByDistance = (a: EquipementLocal, b: EquipementLocal) =>
    a.distance_m - b.distance_m;

  const sport = elements.filter((e) => isSport(e.type)).sort(sortByDistance);
  const scolaire = elements
    .filter((e) => isScolaire(e.type))
    .sort(sortByDistance);

  // Dédoublonnage par nom (Overpass renvoie parfois node + way pour le même
  // équipement). On garde le plus proche.
  const dedupByName = (list: EquipementLocal[]): EquipementLocal[] => {
    const seen = new Set<string>();
    const out: EquipementLocal[] = [];
    for (const e of list) {
      const key = e.nom.toLowerCase().trim();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out;
  };

  const sportDedup = dedupByName(sport).slice(0, 4);
  const scolaireDedup = dedupByName(scolaire).slice(0, 4);

  return {
    available: sportDedup.length + scolaireDedup.length > 0,
    count: sportDedup.length + scolaireDedup.length,
    sport: sportDedup,
    scolaire: scolaireDedup,
    source: "overpass",
    fetched_at: now,
  };
}

export async function getProximiteLocale(
  lat: number,
  lon: number,
  radius_m: number = DEFAULT_RADIUS_M,
): Promise<ProximiteLocaleResult & { cached: boolean }> {
  const hash = addressHash(lat, lon);
  const cacheHash = `${hash}:prox_locale:${radius_m}`;

  const { data, cached } = await fetchWithCache<ProximiteLocaleResult>(
    cacheHash,
    { lat, lon },
    "proximite_locale_v3",
    TTL_DAYS,
    () => computeProximiteLocale(lat, lon, radius_m),
    0,
    // shouldCache : refuse de cacher les résultats vides — sinon en cas de
    // panne Overpass on s'empoisonne pour 30 jours et on n'essaie plus la DB.
    (result: ProximiteLocaleResult) =>
      result.available && (result.sport.length + result.scolaire.length) > 0,
  );

  return { ...data, cached };
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de formatage pour le PDF
// ──────────────────────────────────────────────────────────────────────────────

const LABEL_TYPE: Record<EquipementType, string> = {
  stade: "Stade",
  complexe_sportif: "Complexe sportif",
  piscine: "Piscine",
  terrain: "Terrain",
  fitness: "Salle de sport",
  maternelle: "École maternelle",
  ecole: "École",
  college: "Collège",
};

export function formatEquipementLabel(eq: EquipementLocal): string {
  return LABEL_TYPE[eq.type] ?? "Équipement";
}

export function formatDistanceLabel(distance_m: number): string {
  if (distance_m < 100) return "à proximité immédiate";
  if (distance_m < 1000) return `à ${distance_m} m`;
  return `à ${(distance_m / 1000).toFixed(1)} km`;
}
