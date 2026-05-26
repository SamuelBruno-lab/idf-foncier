/**
 * DATAMERRY — Distance et temps de trajet vers Paris depuis un bien.
 *
 * Pour les pages cabinet et rapports lead, on enrichit les biens situés en
 * Île-de-France avec :
 *   - distance vol d'oiseau à Notre-Dame (centre Paris)
 *   - première gare SNCF / RER à proximité (issue du dataset transports OSM)
 *   - estimation grossière du temps de trajet en transport jusqu'au centre
 *
 * v1 (ici) : estimation simpliste basée sur dept INSEE + distance vol d'oiseau.
 * v2 (TODO) : brancher API RATP-Île-de-France Mobilités ou SNCF pour des
 * temps de trajet réels (changements inclus).
 */

import type { TransportStop } from "./datasets/transports";
import { findNearestGare } from "./datasets/gares";
import { computeJourneyToParis, type IdfmJourneyResult } from "./datasets/idfm-journey";

// Centre de Paris : Notre-Dame (origine officielle du km 0 français)
const PARIS_CENTER_LAT = 48.853;
const PARIS_CENTER_LON = 2.3499;

// Départements Île-de-France
const IDF_DEPTS = new Set(["75", "77", "78", "91", "92", "93", "94", "95"]);

export type ParisDistanceResult = {
  /** Adresse située dans Paris intra-muros (dept 75) */
  is_paris: boolean;
  /** Adresse située en Île-de-France (Paris ou petite/grande couronne) */
  is_ile_de_france: boolean;
  /** Distance vol d'oiseau jusqu'à Notre-Dame (km, arrondi 0.1) */
  crow_distance_km: number;
  /**
   * Temps de trajet estimé en transports en commun jusqu'au centre Paris (min).
   * Issu de IDFM PRIM Navitia si la clé IDFM_PRIM_API_KEY est configurée
   * (précision ~98%), sinon estimation heuristique (3-4 min/km couronne).
   * null hors IDF.
   */
  estimated_minutes_to_paris: number | null;
  /** Vrai si la valeur ci-dessus vient de l'API officielle Navitia (et non d'une estimation). */
  minutes_to_paris_from_official_api: boolean;
  /** Itinéraire détaillé porte-à-porte si dispo (clé PRIM configurée). */
  journey_to_paris: IdfmJourneyResult | null;
  /** Première gare SNCF/RER/train à proximité (issue du dataset transports), ou null */
  nearest_major_station: {
    nom: string;
    type: "train" | "rer" | "metro";
    distance_m: number;
    walk_minutes: number;
    reseau: string | null;
    ligne: string | null;
  } | null;
};

/** Haversine distance entre 2 points GPS en kilomètres */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // rayon Terre km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Identifie la première gare SNCF/RER/métro parmi une liste de stops.
 * Priorité : RER > train > métro (plus utile pour aller à Paris).
 */
function pickNearestMajorStation(
  stops: TransportStop[] | undefined,
): ParisDistanceResult["nearest_major_station"] {
  if (!stops || stops.length === 0) return null;

  // Filtre les types majeurs (transport vers Paris)
  const major = stops.filter((s) => ["rer", "train", "metro"].includes(s.type));
  if (major.length === 0) return null;

  // Trie par priorité puis distance
  const priority: Record<string, number> = { rer: 0, train: 1, metro: 2 };
  major.sort((a, b) => {
    const pa = priority[a.type] ?? 9;
    const pb = priority[b.type] ?? 9;
    if (pa !== pb) return pa - pb;
    return a.distance_m - b.distance_m;
  });

  const best = major[0];
  return {
    nom: best.nom,
    type: best.type as "train" | "rer" | "metro",
    distance_m: best.distance_m,
    walk_minutes: best.walk_minutes,
    reseau: best.reseau,
    ligne: best.ligne,
  };
}

/**
 * Estime le temps de trajet en transport en commun de l'adresse au centre Paris.
 *
 * Heuristique v1 (sera remplacée par appel API IDF Mobilités) :
 *   - Paris intra-muros : 15 min de base + 3 min/km (centre Paris à pied/métro)
 *   - Petite couronne (92, 93, 94) : 20 min de base + 3 min/km (RER + correspondance)
 *   - Grande couronne (77, 78, 91, 95) : 30 min de base + 4 min/km
 *   - Hors IDF : null (pas pertinent, sortie de la zone Transilien)
 */
function estimateMinutesToParis(
  crowKm: number,
  dept: string,
): number | null {
  if (!IDF_DEPTS.has(dept)) return null;

  if (dept === "75") {
    // Paris intra : très bref si déjà central
    return Math.max(10, Math.round(15 + crowKm * 3));
  }
  if (["92", "93", "94"].includes(dept)) {
    // Petite couronne
    return Math.round(20 + crowKm * 3);
  }
  // Grande couronne (77, 78, 91, 95)
  return Math.round(30 + crowKm * 4);
}

/**
 * Calcule l'enrichissement "proximité Paris" pour un bien géolocalisé.
 *
 * Stratégie pour la première gare :
 *   1. Essaie la table dim_gares (référentiel officiel SNCF + IDFM) via la
 *      fonction Postgres find_nearest_gare (déterministe, sub-5ms).
 *   2. Fallback OSM stops si la DB n'a pas encore été peuplée par le pipeline
 *      pipeline_gares_idf.py (ex: en dev local sans run du pipeline).
 *
 * @param lat - Latitude WGS84 du bien
 * @param lon - Longitude WGS84 du bien
 * @param codeInsee - Code INSEE de la commune (5 caractères)
 * @param transportStops - Liste des arrêts (issue de getTransports), pour fallback
 * @returns Objet ParisDistanceResult, jamais null
 */
export async function computeParisDistance(
  lat: number,
  lon: number,
  codeInsee: string,
  transportStops?: TransportStop[],
): Promise<ParisDistanceResult> {
  const dept = (codeInsee ?? "").slice(0, 2);
  const is_paris = dept === "75";
  const is_idf = IDF_DEPTS.has(dept);

  const crowKmRaw = haversineKm(lat, lon, PARIS_CENTER_LAT, PARIS_CENTER_LON);
  const crow_distance_km = Math.round(crowKmRaw * 10) / 10;

  // ── Stratégie première gare : DB officielle d'abord, fallback OSM ────────
  let nearest_major_station: ParisDistanceResult["nearest_major_station"] = null;

  const dbGare = await findNearestGare(lat, lon, 20).catch(() => null);
  if (dbGare) {
    const ligneLabel = dbGare.lignes && dbGare.lignes.length > 0
      ? dbGare.lignes.join(" / ")
      : null;
    nearest_major_station = {
      nom: dbGare.nom,
      type: (dbGare.type === "transilien" || dbGare.type === "sncf" || dbGare.type === "tram"
        ? "train"
        : dbGare.type) as "train" | "rer" | "metro",
      distance_m: Math.round(dbGare.distance_km * 1000),
      walk_minutes: dbGare.walk_minutes,
      reseau: dbGare.reseau,
      ligne: ligneLabel,
    };
  } else {
    nearest_major_station = pickNearestMajorStation(transportStops);
  }

  // ── Itinéraire porte-à-porte : Navitia IDFM PRIM (si clé) ────────────────
  // Bascule sur les minutes officielles quand on a un trajet réel, sinon
  // estimation heuristique (3-4 min/km selon couronne).
  let journey_to_paris: IdfmJourneyResult | null = null;
  let estimated_minutes_to_paris: number | null = null;
  let minutes_to_paris_from_official_api = false;

  if (is_idf) {
    const journey = await computeJourneyToParis(lat, lon).catch(() => null);
    if (journey && journey.available && journey.total_duration_min > 0) {
      journey_to_paris = journey;
      estimated_minutes_to_paris = journey.total_duration_min;
      minutes_to_paris_from_official_api = true;
    } else {
      // Fallback heuristique si l'API a échoué ou clé absente
      estimated_minutes_to_paris = estimateMinutesToParis(crowKmRaw, dept);
    }
  }

  return {
    is_paris,
    is_ile_de_france: is_idf,
    crow_distance_km,
    estimated_minutes_to_paris,
    minutes_to_paris_from_official_api,
    journey_to_paris,
    nearest_major_station,
  };
}
