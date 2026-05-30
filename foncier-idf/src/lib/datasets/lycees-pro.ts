/**
 * DATAMERRY — Taux de réussite au baccalauréat PROFESSIONNEL par lycée.
 *
 * Source : data.education.gouv.fr — dataset officiel IVAL pro
 *   « Indicateurs de résultat des lycées d'enseignement professionnel »
 *   API ODS v2.1, gratuite, illimitée.
 *
 * Complément du helper lycees-bac.ts (qui ne couvre que GT). Le vendeur
 * d'un bien en banlieue / zone industrielle a souvent un lycée pro comme
 * établissement de secteur, et la mention "85 % de réussite Bac pro" est
 * un argument de vente concret (familles + investisseurs locatifs étudiants).
 *
 * Cache 365 jours (mise à jour annuelle DEPP après chaque session).
 */

import { addressHash, fetchWithCache } from "./_cache";

const ODS_BASE =
  "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/" +
  "fr-en-indicateurs-de-resultat-des-lycees-denseignement-professionnel/records";

const DEFAULT_RADIUS_M = 5000;
const TTL_DAYS = 365;
const TIMEOUT_MS = 5000;

export type LyceeProResult = {
  uai: string;
  nom: string;
  statut: "public" | "prive" | "inconnu";
  commune: string;
  dept: string | null;
  /** Taux de réussite au bac professionnel toutes spécialités (%) */
  taux_reussite_pro: number | null;
  /** Taux de mention bac pro (%) — souvent moins fourni que GT */
  taux_mention_pro: number | null;
  distance_m: number;
  annee_session: number | null;
  lat: number;
  lon: number;
};

export type LyceesProResult = {
  available: boolean;
  count: number;
  top: LyceeProResult[];
  source: string;
  fetched_at: string;
};

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseStatut(raw: string | undefined): LyceeProResult["statut"] {
  if (!raw) return "inconnu";
  const r = raw.toLowerCase();
  if (r.includes("public")) return "public";
  if (r.includes("priv")) return "prive";
  return "inconnu";
}

type OdsRecord = {
  uai?: string;
  nom_de_l_etablissement?: string;
  appellation_officielle?: string;
  ville?: string;
  commune?: string;
  code_departement?: string;
  departement?: string;
  dep?: string;
  code_insee?: string;
  code_insee_de_l_etablissement?: string;
  secteur?: string;
  etablissement_public_ou_priv?: string;
  // Champs taux de réussite bac pro
  taux_brut_de_reussite_total_series?: number | null;
  taux_brut_de_reussite_total?: number | null;
  taux_reussite_pro?: number | null;
  taux_mention_brut_pro?: number | null;
  taux_mention_brut_total?: number | null;
  annee?: number;
  session?: number;
  geo_point_2d?: { lat?: number; lon?: number } | { type?: string; coordinates?: number[] };
};

function pickDept(rec: OdsRecord): string | null {
  const candidates = [rec.code_departement, rec.departement, rec.dep];
  for (const c of candidates) {
    if (c && typeof c === "string") {
      const cleaned = c.trim();
      if (cleaned.length === 2 || cleaned.length === 3) return cleaned;
    }
  }
  const insee = rec.code_insee || rec.code_insee_de_l_etablissement;
  if (insee && typeof insee === "string") {
    const s = insee.trim();
    if (s.startsWith("97") && s.length >= 3) return s.slice(0, 3);
    if (s.length >= 2) return s.slice(0, 2);
  }
  return null;
}

function pickCoords(
  geo: OdsRecord["geo_point_2d"] | undefined,
): { lat: number; lon: number } | null {
  if (!geo) return null;
  if (typeof geo === "object" && "lat" in geo && "lon" in geo && geo.lat != null && geo.lon != null) {
    return { lat: Number(geo.lat), lon: Number(geo.lon) };
  }
  if (
    typeof geo === "object" &&
    "coordinates" in geo &&
    Array.isArray((geo as { coordinates: number[] }).coordinates)
  ) {
    const arr = (geo as { coordinates: number[] }).coordinates;
    if (arr.length >= 2) return { lat: Number(arr[1]), lon: Number(arr[0]) };
  }
  return null;
}

async function fetchLyceesProFromOds(
  lat: number,
  lon: number,
  radius_m: number,
): Promise<LyceesProResult> {
  const where = `within_distance(geo_point_2d, geom'POINT(${lon} ${lat})', ${radius_m}m)`;
  const order = `distance(geo_point_2d, geom'POINT(${lon} ${lat})')`;
  const params = new URLSearchParams({
    where,
    order_by: order,
    limit: "10",
  });

  const now = new Date().toISOString();

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
        source: `data.education.gouv.fr lycées pro (HTTP ${res.status})`,
        fetched_at: now,
      };
    }
    const json = (await res.json()) as { results?: OdsRecord[] };
    const records = json.results ?? [];

    // Dédoublonnage par UAI : garde session la plus récente
    const byUai = new Map<string, OdsRecord>();
    for (const r of records) {
      const uai = (r.uai ?? "").trim();
      if (!uai) continue;
      const annee = Number(r.annee ?? r.session ?? 0);
      const existing = byUai.get(uai);
      if (!existing || annee > Number(existing.annee ?? existing.session ?? 0)) {
        byUai.set(uai, r);
      }
    }

    const lycees: LyceeProResult[] = [];
    for (const rec of byUai.values()) {
      const coords = pickCoords(rec.geo_point_2d);
      if (!coords) continue;
      const distance_m = Math.round(haversineM(lat, lon, coords.lat, coords.lon));
      // Plusieurs noms possibles selon versions du dataset
      const tauxReussite =
        rec.taux_brut_de_reussite_total_series ??
        rec.taux_brut_de_reussite_total ??
        rec.taux_reussite_pro ??
        null;
      const tauxMention = rec.taux_mention_brut_pro ?? rec.taux_mention_brut_total ?? null;
      lycees.push({
        uai: rec.uai ?? "",
        nom:
          rec.appellation_officielle ??
          rec.nom_de_l_etablissement ??
          "Lycée pro non identifié",
        statut: parseStatut(rec.secteur ?? rec.etablissement_public_ou_priv),
        commune: rec.commune ?? rec.ville ?? "",
        dept: pickDept(rec),
        taux_reussite_pro: tauxReussite,
        taux_mention_pro: tauxMention,
        distance_m,
        annee_session: Number(rec.annee ?? rec.session ?? 0) || null,
        lat: coords.lat,
        lon: coords.lon,
      });
    }

    lycees.sort((a, b) => a.distance_m - b.distance_m);
    const top = lycees.slice(0, 3);

    return {
      available: top.length > 0,
      count: lycees.length,
      top,
      source: "data.education.gouv.fr (lycées pro)",
      fetched_at: now,
    };
  } catch (err) {
    return {
      available: false,
      count: 0,
      top: [],
      source: `data.education.gouv.fr lycées pro (error: ${err instanceof Error ? err.message : "unknown"})`,
      fetched_at: now,
    };
  }
}

export async function getLyceesPro(
  lat: number,
  lon: number,
  radius_m: number = DEFAULT_RADIUS_M,
): Promise<LyceesProResult & { cached: boolean }> {
  const hash = addressHash(lat, lon);

  const { data, cached } = await fetchWithCache<LyceesProResult>(
    hash,
    { lat, lon },
    "lycees_pro_5km",
    TTL_DAYS,
    () => fetchLyceesProFromOds(lat, lon, radius_m),
    0,
    // Ne pas cacher les résultats vides (API timeouts → pollue 365j sinon)
    (r) => r.available && r.count > 0,
  );

  return { ...data, cached };
}
