/**
 * DATAMERRY — Taux de réussite au baccalauréat par lycée.
 *
 * Source : data.education.gouv.fr — dataset officiel
 *   « Indicateurs de résultat des lycées d'enseignement général et
 *      technologique » (IVAL)
 *   API ODS v2.1, gratuite, illimitée.
 *
 * Renvoie les 3 lycées les plus proches d'une coordonnée avec :
 *   - nom + statut (public / privé sous contrat)
 *   - taux de réussite au bac général
 *   - taux de réussite au bac technologique
 *   - taux de mention
 *   - distance vol d'oiseau
 *
 * Cache 365 jours (mise à jour annuelle des résultats par le ministère
 * après chaque session du bac).
 *
 * Pourquoi c'est l'élément #1 de la page 2 du rapport vendeur :
 *   les parents qui achètent un bien à Paris/banlieue regardent en priorité
 *   la carte scolaire. « Lycée Hélène Boucher · 96 % de réussite » est un
 *   argument de vente sec.
 */

import { addressHash, fetchWithCache } from "./_cache";

const ODS_BASE =
  "https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/" +
  "fr-en-indicateurs-de-resultat-des-lycees-denseignement-general-et-technologique/records";

// On regarde dans un rayon généreux : un visiteur Parisien peut accepter qu'un
// lycée à 1.5 km soit dans son secteur. Limité à 3 résultats pour rester lisible.
const DEFAULT_RADIUS_M = 2000;
const TTL_DAYS = 365;
const TIMEOUT_MS = 5000;

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type LyceeBacResult = {
  uai: string;
  nom: string;
  statut: "public" | "prive" | "inconnu";
  commune: string;
  /** Taux de réussite au bac général (%) — null si non publié */
  taux_reussite_general: number | null;
  /** Taux de réussite au bac technologique (%) */
  taux_reussite_techno: number | null;
  /** Taux moyen de mention bac général (%) — calculé si dispo */
  taux_mention_general: number | null;
  /** Distance vol d'oiseau depuis l'adresse (mètres, arrondi) */
  distance_m: number;
  annee_session: number | null;
  lat: number;
  lon: number;
};

export type LyceesBacResult = {
  available: boolean;
  count: number;
  /** Top 3 lycées par distance croissante */
  top: LyceeBacResult[];
  source: string;
  fetched_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

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

function parseStatut(raw: string | undefined): LyceeBacResult["statut"] {
  if (!raw) return "inconnu";
  const r = raw.toLowerCase();
  if (r.includes("public")) return "public";
  if (r.includes("priv") || r.includes("private")) return "prive";
  return "inconnu";
}

/**
 * Le dataset ODS regroupe parfois plusieurs sessions du bac par lycée
 * (1 ligne par année). On ne garde que la session la plus récente par UAI.
 */
type OdsRecord = {
  uai?: string;
  nom_de_l_etablissement?: string;
  appellation_officielle?: string;
  ville?: string;
  commune?: string;
  secteur?: string;
  etablissement_public_ou_priv?: string;
  taux_reussite_g?: number | null;
  taux_brut_de_reussite_total_series?: number | null;
  taux_brut_de_reussite_serie_generale?: number | null;
  taux_brut_de_reussite_serie_techno?: number | null;
  taux_mention_brut_gnle?: number | null;
  annee?: number;
  session?: number;
  geo_point_2d?: { lat?: number; lon?: number } | { type?: string; coordinates?: number[] };
};

function pickCoords(geo: OdsRecord["geo_point_2d"] | undefined): { lat: number; lon: number } | null {
  if (!geo) return null;
  if (typeof geo === "object" && "lat" in geo && "lon" in geo && geo.lat != null && geo.lon != null) {
    return { lat: Number(geo.lat), lon: Number(geo.lon) };
  }
  // Fallback array form
  if (typeof geo === "object" && "coordinates" in geo && Array.isArray((geo as { coordinates: number[] }).coordinates)) {
    const arr = (geo as { coordinates: number[] }).coordinates;
    if (arr.length >= 2) return { lat: Number(arr[1]), lon: Number(arr[0]) };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Fetch ODS
// ──────────────────────────────────────────────────────────────────────────────

async function fetchLyceesFromOds(
  lat: number,
  lon: number,
  radius_m: number,
): Promise<LyceesBacResult> {
  // ODS supporte les requêtes spatiales via within_distance(geo_point_2d, geom'POINT(lon lat)', Xm)
  const where = `within_distance(geo_point_2d, geom'POINT(${lon} ${lat})', ${radius_m}m)`;
  const order = `distance(geo_point_2d, geom'POINT(${lon} ${lat})')`;
  const params = new URLSearchParams({
    where,
    order_by: order,
    limit: "10", // on dédoublonne par UAI ensuite et garde top 3
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
        source: `data.education.gouv.fr (HTTP ${res.status})`,
        fetched_at: now,
      };
    }
    const json = (await res.json()) as { results?: OdsRecord[] };
    const records = json.results ?? [];

    // Dédoublonnage par UAI : garde la session la plus récente
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

    const lycees: LyceeBacResult[] = [];
    for (const rec of byUai.values()) {
      const coords = pickCoords(rec.geo_point_2d);
      if (!coords) continue;
      const distance_m = Math.round(haversineM(lat, lon, coords.lat, coords.lon));
      lycees.push({
        uai: rec.uai ?? "",
        nom:
          rec.appellation_officielle ??
          rec.nom_de_l_etablissement ??
          "Lycée non identifié",
        statut: parseStatut(rec.secteur ?? rec.etablissement_public_ou_priv),
        commune: rec.commune ?? rec.ville ?? "",
        taux_reussite_general:
          rec.taux_brut_de_reussite_serie_generale ?? rec.taux_reussite_g ?? null,
        taux_reussite_techno: rec.taux_brut_de_reussite_serie_techno ?? null,
        taux_mention_general: rec.taux_mention_brut_gnle ?? null,
        distance_m,
        annee_session: Number(rec.annee ?? rec.session ?? 0) || null,
        lat: coords.lat,
        lon: coords.lon,
      });
    }

    // Tri par distance et top 3
    lycees.sort((a, b) => a.distance_m - b.distance_m);
    const top = lycees.slice(0, 3);

    return {
      available: top.length > 0,
      count: lycees.length,
      top,
      source: "data.education.gouv.fr",
      fetched_at: now,
    };
  } catch (err) {
    return {
      available: false,
      count: 0,
      top: [],
      source: `data.education.gouv.fr (error: ${err instanceof Error ? err.message : "unknown"})`,
      fetched_at: now,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────────────────────

export async function getLyceesBac(
  lat: number,
  lon: number,
  radius_m: number = DEFAULT_RADIUS_M,
): Promise<LyceesBacResult & { cached: boolean }> {
  const hash = addressHash(lat, lon);

  const { data, cached } = await fetchWithCache<LyceesBacResult>(
    hash,
    { lat, lon },
    "lycees_bac",
    TTL_DAYS,
    () => fetchLyceesFromOds(lat, lon, radius_m),
    0,
  );

  return { ...data, cached };
}
