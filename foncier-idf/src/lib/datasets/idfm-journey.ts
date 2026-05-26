/**
 * DATAMERRY — Calcul d'itinéraire porte-à-porte vers Paris via IDF Mobilités PRIM.
 *
 * Source : https://prim.iledefrance-mobilites.fr/marketplace/navitia/journeys
 *   Moteur Navitia (Kisio / groupe Keolis-SNCF).
 *   Couverture : 100% IDF (RER, Transilien, Métro, Tram, Bus, Vélib, marche).
 *   Quota gratuit : 1 million de requêtes / mois.
 *
 * Auth : header `apiKey: <IDFM_PRIM_API_KEY>`.
 *
 * Destination par défaut : Châtelet-Les-Halles (hub central Paris),
 * le station la plus connectée de France (RER A/B/D + Métro 1/4/7/11/14).
 * Permet de servir un "temps réaliste pour atteindre Paris" sans biaiser
 * vers une ligne spécifique.
 *
 * Reference time : prochain lundi 8h00 (heure de pointe matin classique).
 * Évite la variabilité entre jours/heures et donne le pire cas réaliste.
 *
 * TTL cache : 30 jours (horaires bougent rarement, et la précision attendue
 * d'un PDF lead n'exige pas du temps réel).
 */

import { addressHash, fetchWithCache } from "./_cache";

const PRIM_BASE =
  "https://prim.iledefrance-mobilites.fr/marketplace/navitia/journeys";

// Châtelet-Les-Halles — centre névralgique du réseau IDF
const CHATELET_LON = 2.3479;
const CHATELET_LAT = 48.8606;
const CHATELET_LABEL = "Châtelet-Les-Halles";

const TTL_DAYS = 30;
const TIMEOUT_MS = 6000;

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type JourneySection = {
  type: "walking" | "transit" | "transfer" | "wait" | "other";
  duration_sec: number;
  duration_min: number;
  /** Pour walking : distance en mètres. Pour transit : null. */
  distance_m: number | null;
  /** Pour transit : ex. "RER E", "Métro 4". Sinon null. */
  line: string | null;
  /** Couleur officielle de la ligne (hex), pour rendu graphique. */
  line_color: string | null;
  /** Lieu de départ de la section (gare, adresse). */
  from: string | null;
  /** Lieu d'arrivée de la section. */
  to: string | null;
};

export type IdfmJourneyResult = {
  available: boolean;
  reason?: string;
  /** Adresse de destination (Châtelet par défaut). */
  destination: string;
  /** Durée totale porte-à-porte en secondes. */
  total_duration_sec: number;
  total_duration_min: number;
  /** Temps de marche cumulé (premier + dernier km à pied + correspondances). */
  walking_duration_sec: number;
  walking_duration_min: number;
  walking_distance_m: number;
  /** Nombre de correspondances en transit (0 = direct). */
  nb_transfers: number;
  /** Détail des sections du trajet. */
  sections: JourneySection[];
  /** Horaire de référence utilisé pour le calcul. */
  reference_datetime: string;
  source: string;
  fetched_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Reference datetime : prochain lundi 8h00 Europe/Paris
// ──────────────────────────────────────────────────────────────────────────────

function nextMondayAt8(): Date {
  const now = new Date();
  const d = new Date(now);
  // Day of week : 0 = Sunday, 1 = Monday, ...
  const day = d.getDay();
  // Jours jusqu'à lundi inclusif (si on est dimanche → 1 jour, lundi → 7 jours, etc.)
  const daysUntilMonday = (8 - day) % 7 || 7;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(8, 0, 0, 0);
  return d;
}

/** Format Navitia : YYYYMMDDTHHMMSS, en heure locale. */
function formatNavitiaDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}T${hh}${mi}00`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Parsing Navitia → JourneySection[]
// ──────────────────────────────────────────────────────────────────────────────

type NavitiaSection = {
  type?: string;
  mode?: string;
  duration?: number;
  geojson?: { properties?: Array<{ length?: number }> };
  from?: { name?: string };
  to?: { name?: string };
  display_informations?: {
    label?: string;
    name?: string;
    commercial_mode?: string;
    color?: string;
    network?: string;
  };
};

function mapSection(sec: NavitiaSection): JourneySection {
  const dur = sec.duration ?? 0;
  // Type mapping :
  //   "street_network" + mode "walking" → walking
  //   "public_transport" → transit
  //   "transfer" → transfer (marche entre quais)
  //   "waiting" → wait
  let type: JourneySection["type"] = "other";
  if (sec.type === "street_network" && sec.mode === "walking") type = "walking";
  else if (sec.type === "public_transport") type = "transit";
  else if (sec.type === "transfer") type = "transfer";
  else if (sec.type === "waiting") type = "wait";

  // Distance marche (uniquement pour walking/transfer)
  let distance_m: number | null = null;
  if (type === "walking" || type === "transfer") {
    const props = sec.geojson?.properties;
    if (Array.isArray(props) && props.length > 0) {
      distance_m = props[0]?.length ?? null;
    }
  }

  // Ligne (uniquement pour transit)
  const di = sec.display_informations;
  const line = type === "transit"
    ? `${di?.commercial_mode ?? ""} ${di?.label ?? di?.name ?? ""}`.trim() || null
    : null;
  const line_color = di?.color ? `#${di.color}` : null;

  return {
    type,
    duration_sec: dur,
    duration_min: Math.round(dur / 60),
    distance_m,
    line,
    line_color,
    from: sec.from?.name ?? null,
    to: sec.to?.name ?? null,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Fetch IDFM PRIM
// ──────────────────────────────────────────────────────────────────────────────

async function fetchJourneyFromPrim(
  fromLat: number,
  fromLon: number,
  apiKey: string,
): Promise<IdfmJourneyResult> {
  const refDate = nextMondayAt8();
  const datetime = formatNavitiaDate(refDate);

  // Navitia attend lon;lat (norme inverse de WGS84 usuel)
  const params = new URLSearchParams({
    from: `${fromLon};${fromLat}`,
    to: `${CHATELET_LON};${CHATELET_LAT}`,
    datetime,
    datetime_represents: "departure",
    "first_section_mode[]": "walking",
    "last_section_mode[]": "walking",
    max_duration_to_pt: "1500", // 25 min de marche max pour atteindre les TP
    walking_speed: "1.12", // 4 km/h, vitesse marche standard adulte
  });

  const url = `${PRIM_BASE}?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      apiKey,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    return {
      available: false,
      reason: `prim_http_${res.status}`,
      destination: CHATELET_LABEL,
      total_duration_sec: 0,
      total_duration_min: 0,
      walking_duration_sec: 0,
      walking_duration_min: 0,
      walking_distance_m: 0,
      nb_transfers: 0,
      sections: [],
      reference_datetime: refDate.toISOString(),
      source: "idfm-prim-navitia",
      fetched_at: new Date().toISOString(),
    };
  }

  const json = (await res.json()) as {
    journeys?: Array<{
      duration?: number;
      nb_transfers?: number;
      sections?: NavitiaSection[];
    }>;
  };

  // Sélectionne le meilleur trajet (le plus rapide, qui est usuellement le 1er)
  const best = (json.journeys ?? [])[0];
  if (!best) {
    return {
      available: false,
      reason: "no_journey_found",
      destination: CHATELET_LABEL,
      total_duration_sec: 0,
      total_duration_min: 0,
      walking_duration_sec: 0,
      walking_duration_min: 0,
      walking_distance_m: 0,
      nb_transfers: 0,
      sections: [],
      reference_datetime: refDate.toISOString(),
      source: "idfm-prim-navitia",
      fetched_at: new Date().toISOString(),
    };
  }

  const sections = (best.sections ?? []).map(mapSection);
  const walking_duration_sec = sections
    .filter((s) => s.type === "walking" || s.type === "transfer")
    .reduce((acc, s) => acc + s.duration_sec, 0);
  const walking_distance_m = sections
    .filter((s) => s.type === "walking" || s.type === "transfer")
    .reduce((acc, s) => acc + (s.distance_m ?? 0), 0);

  return {
    available: true,
    destination: CHATELET_LABEL,
    total_duration_sec: best.duration ?? 0,
    total_duration_min: Math.round((best.duration ?? 0) / 60),
    walking_duration_sec,
    walking_duration_min: Math.round(walking_duration_sec / 60),
    walking_distance_m,
    nb_transfers: best.nb_transfers ?? 0,
    sections,
    reference_datetime: refDate.toISOString(),
    source: "idfm-prim-navitia",
    fetched_at: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Calcule l'itinéraire porte-à-porte depuis (lat, lon) vers Châtelet-Les-Halles
 * (centre Paris) à l'heure de pointe matin (prochain lundi 8h00).
 *
 * Renvoie null si la clé IDFM_PRIM_API_KEY n'est pas configurée — l'appelant
 * doit alors retomber sur une estimation heuristique.
 */
export async function computeJourneyToParis(
  lat: number,
  lon: number,
): Promise<(IdfmJourneyResult & { cached: boolean }) | null> {
  const apiKey = process.env.IDFM_PRIM_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const hash = addressHash(lat, lon);
  const { data, cached } = await fetchWithCache<IdfmJourneyResult>(
    hash,
    { lat, lon },
    "idfm_journey",
    TTL_DAYS,
    () => fetchJourneyFromPrim(lat, lon, apiKey),
    0,
  );

  return { ...data, cached };
}
