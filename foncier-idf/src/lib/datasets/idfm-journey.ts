/**
 * DATAMERRY — Calcul d'itinéraire porte-à-porte vers Paris via IDF Mobilités PRIM.
 *
 * Source : https://prim.iledefrance-mobilites.fr/marketplace/navitia/journeys
 *   Moteur Navitia (Kisio / groupe Keolis-SNCF).
 *   Couverture : 100% IDF (RER, Transilien, Métro, Tram, Bus, Vélib, marche).
 *   Quota gratuit : 1 million de requêtes / mois.
 *
 * Auth : header `apikey: <IDFM_PRIM_API_KEY>` (lowercase, cf. swagger officiel).
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

// URL base extraite du contrat OpenAPI officiel IDF Mobilités (swagger.json,
// host: prim.iledefrance-mobilites.fr, basePath: /marketplace/v2/navitia).
// L'endpoint /journeys est documenté sous path GET /journeys.
const PRIM_BASE =
  "https://prim.iledefrance-mobilites.fr/marketplace/v2/navitia/journeys";

/**
 * Liste des hubs Paris testés en parallèle pour trouver le trajet optimal.
 *
 * Pourquoi ces 6 ?
 *   - Toutes sont des gares Paris terminus / gares centrales
 *   - Ensemble elles couvrent toutes les directions cardinales depuis IDF
 *   - Un trajet "vers Paris" depuis n'importe quelle banlieue passe par
 *     l'une d'elles ou Châtelet (hub interne)
 *
 * Pour chaque adresse, on teste les 6, on garde la plus rapide → le PDF
 * affiche "Cet appartement est à X min de Paris (Gare la plus proche
 * en temps)".
 */
const PARIS_HUBS = [
  { id: "chatelet", label: "Châtelet-Les-Halles", lat: 48.8606, lon: 2.3479 },
  { id: "gare_du_nord", label: "Gare du Nord", lat: 48.8809, lon: 2.3553 },
  { id: "gare_de_lest", label: "Gare de l'Est", lat: 48.8770, lon: 2.3593 },
  { id: "saint_lazare", label: "Saint-Lazare", lat: 48.8758, lon: 2.3252 },
  { id: "gare_de_lyon", label: "Gare de Lyon", lat: 48.8443, lon: 2.3733 },
  { id: "montparnasse", label: "Montparnasse", lat: 48.8409, lon: 2.3210 },
] as const;

const TTL_DAYS = 30;
const TIMEOUT_MS = 6000;
/** Combien d'alternatives demander à Navitia pour le hub gagnant. */
const ALTERNATIVES_COUNT = 3;

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
  /** Adresse de destination (gare Paris choisie automatiquement). */
  destination: string;
  destination_id: string;
  /** Durée totale porte-à-porte en secondes. */
  total_duration_sec: number;
  total_duration_min: number;
  /** Temps de marche cumulé (premier + dernier km à pied + correspondances). */
  walking_duration_sec: number;
  walking_duration_min: number;
  walking_distance_m: number;
  /** Nombre de correspondances en transit (0 = direct). */
  nb_transfers: number;
  /** Détail des sections du trajet (best = premier de l'alternative la plus rapide). */
  sections: JourneySection[];
  /**
   * Lignes principales du trajet le plus rapide (déduplique, ordre rencontre).
   * Ex: ["RER E", "Métro 4"] pour un Pantin → Saint-Michel
   */
  primary_lines: string[];
  /**
   * Alternatives de trajet vers la même destination, classées par durée
   * croissante. La 1ère = la plus rapide (même que sections ci-dessus).
   * Chaque alternative a sa propre "primary_lines" pour comparaison.
   */
  alternatives: Array<{
    duration_min: number;
    walking_min: number;
    nb_transfers: number;
    primary_lines: string[];
  }>;
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

type NavitiaJourney = {
  duration?: number;
  nb_transfers?: number;
  sections?: NavitiaSection[];
};

/** Extrait les lignes principales d'un trajet (sections transit dédupliquées). */
function extractPrimaryLines(sections: NavitiaSection[]): string[] {
  const lines: string[] = [];
  for (const sec of sections) {
    if (sec.type !== "public_transport") continue;
    const di = sec.display_informations;
    const cm = di?.commercial_mode?.trim();
    const label = di?.label?.trim() || di?.name?.trim() || "";
    if (!label) continue;
    // Si commercial_mode existe et n'est pas redondant avec le label, on préfixe
    // (ex: "Métro 5", "RER E", "Transilien K", "Bus 247")
    let formatted = label;
    if (cm && !label.toLowerCase().includes(cm.toLowerCase())) {
      formatted = `${cm} ${label}`;
    }
    if (!lines.includes(formatted)) lines.push(formatted);
  }
  return lines;
}

/** Lance UN appel Navitia vers un hub précis. */
async function fetchJourneyToHub(
  fromLat: number,
  fromLon: number,
  hub: (typeof PARIS_HUBS)[number],
  apiKey: string,
  count = 1,
): Promise<{
  hub: typeof hub;
  journeys: NavitiaJourney[];
} | null> {
  const refDate = nextMondayAt8();
  const datetime = formatNavitiaDate(refDate);

  const params = new URLSearchParams({
    from: `${fromLon};${fromLat}`,
    to: `${hub.lon};${hub.lat}`,
    datetime,
    datetime_represents: "departure",
    "first_section_mode[]": "walking",
    "last_section_mode[]": "walking",
    max_duration_to_pt: "1500",
    walking_speed: "1.12",
    count: String(count),
  });

  try {
    const res = await fetch(`${PRIM_BASE}?${params.toString()}`, {
      // Auth officielle PRIM : header `apikey` en lowercase (cf. swagger
      // securityDefinitions.APIKeyHeader.name = "apikey").
      headers: { Accept: "application/json", apikey: apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { journeys?: NavitiaJourney[] };
    const journeys = json.journeys ?? [];
    if (journeys.length === 0) return null;
    return { hub, journeys };
  } catch {
    return null;
  }
}

/**
 * Pipeline complet :
 *   1. Teste les 6 hubs Paris en parallèle (count=1 chacun, juste pour ranger)
 *   2. Identifie le hub avec la durée la plus courte
 *   3. Refait un appel sur ce hub gagnant avec count=3 pour avoir les alternatives
 *   4. Build la réponse avec sections détaillées + primary_lines + alternatives
 */
async function fetchJourneyFromPrim(
  fromLat: number,
  fromLon: number,
  apiKey: string,
): Promise<IdfmJourneyResult> {
  const refDate = nextMondayAt8();

  // Étape 1 : 6 hubs en parallèle (rapide, ~500-1000ms total)
  const hubResults = await Promise.all(
    PARIS_HUBS.map((h) => fetchJourneyToHub(fromLat, fromLon, h, apiKey, 1)),
  );

  const validResults = hubResults.filter(
    (r): r is NonNullable<typeof r> =>
      r !== null && r.journeys.length > 0 && (r.journeys[0].duration ?? 0) > 0,
  );

  if (validResults.length === 0) {
    return {
      available: false,
      reason: "no_journey_to_any_hub",
      destination: "Paris",
      destination_id: "none",
      total_duration_sec: 0,
      total_duration_min: 0,
      walking_duration_sec: 0,
      walking_duration_min: 0,
      walking_distance_m: 0,
      nb_transfers: 0,
      sections: [],
      primary_lines: [],
      alternatives: [],
      reference_datetime: refDate.toISOString(),
      source: "idfm-prim-navitia",
      fetched_at: new Date().toISOString(),
    };
  }

  // Étape 2 : trouve le hub avec durée minimale
  validResults.sort(
    (a, b) => (a.journeys[0].duration ?? Infinity) - (b.journeys[0].duration ?? Infinity),
  );
  const winner = validResults[0];

  // Étape 3 : refait un call sur le hub gagnant avec count=3 pour alternatives
  const fullCall = await fetchJourneyToHub(
    fromLat,
    fromLon,
    winner.hub,
    apiKey,
    ALTERNATIVES_COUNT,
  );
  const journeys = (fullCall?.journeys ?? winner.journeys).slice(0, ALTERNATIVES_COUNT);

  // Étape 4 : transforme le meilleur trajet en sections détaillées
  const best = journeys[0];
  const bestSections = (best.sections ?? []).map(mapSection);
  const walking_duration_sec = bestSections
    .filter((s) => s.type === "walking" || s.type === "transfer")
    .reduce((acc, s) => acc + s.duration_sec, 0);
  const walking_distance_m = bestSections
    .filter((s) => s.type === "walking" || s.type === "transfer")
    .reduce((acc, s) => acc + (s.distance_m ?? 0), 0);

  // Alternatives : chacune avec son nb_transfers + primary_lines
  const alternatives = journeys.map((j) => {
    const secs = j.sections ?? [];
    const walking = secs
      .filter((s) => s.type === "street_network" || s.type === "transfer")
      .reduce((acc, s) => acc + (s.duration ?? 0), 0);
    return {
      duration_min: Math.round((j.duration ?? 0) / 60),
      walking_min: Math.round(walking / 60),
      nb_transfers: j.nb_transfers ?? 0,
      primary_lines: extractPrimaryLines(secs),
    };
  });

  return {
    available: true,
    destination: winner.hub.label,
    destination_id: winner.hub.id,
    total_duration_sec: best.duration ?? 0,
    total_duration_min: Math.round((best.duration ?? 0) / 60),
    walking_duration_sec,
    walking_duration_min: Math.round(walking_duration_sec / 60),
    walking_distance_m,
    nb_transfers: best.nb_transfers ?? 0,
    sections: bestSections,
    primary_lines: extractPrimaryLines(best.sections ?? []),
    alternatives,
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
