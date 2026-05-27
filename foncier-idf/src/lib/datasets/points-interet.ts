/**
 * DATAMERRY — Points d'intérêts notables à proximité.
 *
 * Source : Overpass API (OpenStreetMap)
 *   - tourism=attraction (sites touristiques majeurs)
 *   - historic=monument (monuments historiques)
 *   - historic=memorial
 *   - tourism=museum (musées)
 *   - tourism=viewpoint (panoramas)
 *
 * Filtre clé : on n'accepte QUE les lieux qui ont un tag `wikipedia=*` ou
 * `wikidata=*`. Cela garantit une "notabilité prouvée" (article Wikipédia
 * existant) et évite de citer une vague statue de quartier comme point
 * d'intérêt notable. Le filtre divise le volume par ~100 et garde l'élite.
 *
 * Renvoie le top 2 par distance pour citation dans la phrase argumentaire
 * du PDF lead :
 *   « proche de toutes commodités et de points d'intérêts notables comme la
 *     Place des Vosges et le Centre Pompidou. »
 *
 * Couverture France entière (pas que Paris). Pour une adresse à Lyon Saint-
 * Jean on aurait « Cathédrale Saint-Jean et Place Bellecour ».
 *
 * Cache 30 jours (les monuments bougent peu).
 */

import { addressHash, fetchWithCache, haversineMeters } from "./_cache";

const DEFAULT_RADIUS_M = 1500; // 1.5 km — capture l'essentiel sans noyer
const TTL_DAYS = 30;
const TIMEOUT_MS = 6000;
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type PointInteret = {
  osm_id: number;
  nom: string;
  type: "monument" | "musee" | "attraction" | "memorial" | "viewpoint" | "autre";
  lat: number;
  lon: number;
  distance_m: number;
  /** URL Wikipedia si disponible (fr.wikipedia.org/...) */
  wikipedia_url: string | null;
};

export type PointsInteretResult = {
  available: boolean;
  count: number;
  /** Top 2 pour citation directe dans la phrase */
  top: PointInteret[];
  source: string;
  fetched_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function pickType(tags: Record<string, string>): PointInteret["type"] {
  if (tags.historic === "monument") return "monument";
  if (tags.historic === "memorial") return "memorial";
  if (tags.tourism === "museum") return "musee";
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.tourism === "attraction") return "attraction";
  return "autre";
}

function buildWikipediaUrl(wikipediaTag: string | undefined): string | null {
  if (!wikipediaTag) return null;
  // Format OSM standard : "fr:Tour Eiffel" ou "en:Eiffel Tower"
  const [lang, ...title] = wikipediaTag.split(":");
  if (!lang || title.length === 0) return null;
  const pageTitle = title.join(":");
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, "_"))}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Overpass query
// ──────────────────────────────────────────────────────────────────────────────

async function fetchPointsInteretFromOverpass(
  lat: number,
  lon: number,
  radius_m: number,
): Promise<PointsInteretResult> {
  // Construit une requête Overpass QL qui :
  //  - cherche nodes/ways/relations avec tourism=attraction|museum|viewpoint
  //    OU historic=monument|memorial
  //  - filtre sur la présence d'un tag wikipedia=* OU wikidata=* (notabilité)
  //  - dans un rayon `radius_m` autour de (lat, lon)
  const aroundClause = `around:${radius_m},${lat},${lon}`;
  const query = `
    [out:json][timeout:25];
    (
      node[tourism~"^(attraction|museum|viewpoint)$"][wikipedia](${aroundClause});
      way[tourism~"^(attraction|museum|viewpoint)$"][wikipedia](${aroundClause});
      relation[tourism~"^(attraction|museum|viewpoint)$"][wikipedia](${aroundClause});
      node[historic~"^(monument|memorial)$"][wikipedia](${aroundClause});
      way[historic~"^(monument|memorial)$"][wikipedia](${aroundClause});
      relation[historic~"^(monument|memorial)$"][wikipedia](${aroundClause});
      node[tourism~"^(attraction|museum|viewpoint)$"][wikidata](${aroundClause});
      way[tourism~"^(attraction|museum|viewpoint)$"][wikidata](${aroundClause});
      relation[tourism~"^(attraction|museum|viewpoint)$"][wikidata](${aroundClause});
      node[historic~"^(monument|memorial)$"][wikidata](${aroundClause});
      way[historic~"^(monument|memorial)$"][wikidata](${aroundClause});
      relation[historic~"^(monument|memorial)$"][wikidata](${aroundClause});
    );
    out center tags 30;
  `.trim();

  const now = new Date().toISOString();

  try {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        available: false,
        count: 0,
        top: [],
        source: `overpass (HTTP ${res.status})`,
        fetched_at: now,
      };
    }
    const json = (await res.json()) as {
      elements?: Array<{
        type: "node" | "way" | "relation";
        id: number;
        lat?: number;
        lon?: number;
        center?: { lat: number; lon: number };
        tags?: Record<string, string>;
      }>;
    };

    const elems = json.elements ?? [];
    const pois: PointInteret[] = [];
    const seenNames = new Set<string>();

    for (const e of elems) {
      const tags = e.tags ?? {};
      const nom = tags["name:fr"] || tags.name;
      if (!nom) continue;
      // Dédoublonne par nom (même POI mappé en node + way)
      if (seenNames.has(nom)) continue;
      seenNames.add(nom);

      const coords = e.center ?? { lat: e.lat ?? 0, lon: e.lon ?? 0 };
      if (!coords.lat || !coords.lon) continue;

      const distance_m = Math.round(haversineMeters(lat, lon, coords.lat, coords.lon));

      pois.push({
        osm_id: e.id,
        nom,
        type: pickType(tags),
        lat: coords.lat,
        lon: coords.lon,
        distance_m,
        wikipedia_url: buildWikipediaUrl(tags.wikipedia),
      });
    }

    // Tri par distance + top 2
    pois.sort((a, b) => a.distance_m - b.distance_m);
    const top = pois.slice(0, 2);

    return {
      available: top.length > 0,
      count: pois.length,
      top,
      source: "overpass-api.de + OSM",
      fetched_at: now,
    };
  } catch (err) {
    return {
      available: false,
      count: 0,
      top: [],
      source: `overpass (error: ${err instanceof Error ? err.message : "unknown"})`,
      fetched_at: now,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────────────────────

export async function getPointsInteret(
  lat: number,
  lon: number,
  radius_m: number = DEFAULT_RADIUS_M,
): Promise<PointsInteretResult & { cached: boolean }> {
  const hash = addressHash(lat, lon);
  const { data, cached } = await fetchWithCache<PointsInteretResult>(
    hash,
    { lat, lon },
    "points_interet",
    TTL_DAYS,
    () => fetchPointsInteretFromOverpass(lat, lon, radius_m),
    0,
  );
  return { ...data, cached };
}
