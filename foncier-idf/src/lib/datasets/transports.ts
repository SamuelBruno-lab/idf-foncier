/**
 * DATAMERRY — Transports en commun à proximité.
 *
 * Source : Overpass API (OpenStreetMap)
 *   - public_transport=stop_position (bus, tram, métro, train, RER)
 *   - railway=station, railway=halt (gares SNCF/RER)
 *   - tags `train=yes`, `subway=yes`, `tram=yes`, `bus=yes` pour le type
 *
 * Pourquoi pas transport.data.gouv.fr ?
 *   - leur API renvoie des GTFS bruts (timetables, pas géo direct)
 *   - pour "arrêts proches d'un point", OSM est plus simple et tout aussi à jour
 *
 * TTL cache : 30 jours (mouvement d'arrêts très lent).
 * Coût : 0 € (Overpass public).
 */

import { addressHash, fetchWithCache, haversineMeters } from "./_cache";

const DEFAULT_RADIUS_M = 800; // 800m = 10 min à pied
const DEFAULT_LIMIT = 50;
const TTL_DAYS = 30;
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

export type TransportStop = {
  osm_id: number;
  nom: string;
  type: "bus" | "tram" | "metro" | "train" | "rer" | "ferry" | "stop" | "autre";
  reseau: string | null;
  ligne: string | null;
  lat: number;
  lon: number;
  distance_m: number;
  walk_minutes: number;
};

export type TransportsResult = {
  available: boolean;
  count: number;
  radius_m: number;
  par_type: Record<string, number>;
  stops: TransportStop[];
  score_accessibilite: number; // 0-100 — heuristique simple
  source: string;
  fetched_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function pickType(tags: Record<string, string>): TransportStop["type"] {
  if (tags.train === "yes" || tags.railway === "station" || tags.railway === "halt") {
    // Distinction RER en IDF : ligne RER A/B/C/D/E
    if (tags.network && /RER/i.test(tags.network)) return "rer";
    return "train";
  }
  if (tags.subway === "yes" || tags.station === "subway") return "metro";
  if (tags.tram === "yes" || tags.railway === "tram_stop") return "tram";
  if (tags.bus === "yes" || tags.highway === "bus_stop") return "bus";
  if (tags.ferry === "yes") return "ferry";
  return "stop";
}

function walkMinutes(distanceM: number): number {
  return Math.round(distanceM / 80);
}

/**
 * Score d'accessibilité 0-100 (très simple, à raffiner Phase 11) :
 *   - train/RER < 500m → +40
 *   - métro     < 500m → +30
 *   - tram      < 500m → +20
 *   - bus       < 300m → +10
 *   - bonus diversité : nombre de modes différents × 5
 * Cap à 100.
 */
function computeScore(stops: TransportStop[]): number {
  let score = 0;
  const modes = new Set<string>();
  for (const s of stops) {
    modes.add(s.type);
    if ((s.type === "train" || s.type === "rer") && s.distance_m < 500) score += 40;
    else if (s.type === "metro" && s.distance_m < 500) score += 30;
    else if (s.type === "tram" && s.distance_m < 500) score += 20;
    else if (s.type === "bus" && s.distance_m < 300) score += 10;
  }
  score += modes.size * 5;
  return Math.min(100, score);
}

// ──────────────────────────────────────────────────────────────────────────────
// Fetcher
// ──────────────────────────────────────────────────────────────────────────────

async function fetchTransportsFromOverpass(
  lat: number,
  lon: number,
  radiusM: number,
  limit: number,
): Promise<TransportsResult> {
  // Overpass QL : on cherche tous les arrêts/gares dans le rayon.
  const query = `
[out:json][timeout:8];
(
  node["public_transport"="stop_position"](around:${radiusM},${lat},${lon});
  node["highway"="bus_stop"](around:${radiusM},${lat},${lon});
  node["railway"~"station|halt|tram_stop|subway_entrance"](around:${radiusM},${lat},${lon});
);
out body ${limit};
`;

  let res: Response;
  try {
    res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(10_000), // Overpass peut être lent
    });
  } catch (err) {
    console.warn("[transports] Overpass timeout/network:", err);
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

  const stops: TransportStop[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== "node") continue;
    const tags = el.tags ?? {};
    const d = haversineMeters(lat, lon, el.lat, el.lon);
    stops.push({
      osm_id: el.id,
      nom: tags.name ?? tags.ref ?? "(sans nom)",
      type: pickType(tags),
      reseau: tags.network ?? tags.operator ?? null,
      ligne: tags.route_ref ?? tags.ref ?? null,
      lat: el.lat,
      lon: el.lon,
      distance_m: Math.round(d),
      walk_minutes: walkMinutes(d),
    });
  }
  stops.sort((a, b) => a.distance_m - b.distance_m);

  // Déduplication grossière : même nom + même type → un seul (Overpass renvoie
  // souvent les 2 sens d'un arrêt bus séparément).
  const seen = new Set<string>();
  const dedup: TransportStop[] = [];
  for (const s of stops) {
    const key = `${s.type}|${s.nom.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(s);
  }

  const par_type: Record<string, number> = {};
  for (const s of dedup) par_type[s.type] = (par_type[s.type] ?? 0) + 1;

  return {
    available: dedup.length > 0,
    count: dedup.length,
    radius_m: radiusM,
    par_type,
    stops: dedup,
    score_accessibilite: computeScore(dedup),
    source: "OpenStreetMap (Overpass API)",
    fetched_at: new Date().toISOString(),
  };
}

function emptyResult(radiusM: number): TransportsResult {
  return {
    available: false,
    count: 0,
    radius_m: radiusM,
    par_type: {},
    stops: [],
    score_accessibilite: 0,
    source: "OpenStreetMap (Overpass API)",
    fetched_at: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────────────────────

export type GetTransportsOptions = {
  radiusM?: number;
  limit?: number;
};

export async function getTransports(
  lat: number,
  lon: number,
  opts: GetTransportsOptions = {},
): Promise<TransportsResult & { cached: boolean }> {
  const radiusM = opts.radiusM ?? DEFAULT_RADIUS_M;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const hash = addressHash(lat, lon);

  const { data, cached } = await fetchWithCache<TransportsResult>(
    hash,
    { lat, lon },
    "transports",
    TTL_DAYS,
    () => fetchTransportsFromOverpass(lat, lon, radiusM, limit),
    0,
    // Ne pas cacher un résultat vide : c'est probablement un timeout
    // Overpass qui empoisonnerait sinon le cache 30 jours.
    (result) => result.count > 0,
  );

  return { ...data, cached };
}
