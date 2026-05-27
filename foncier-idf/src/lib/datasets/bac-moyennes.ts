/**
 * DATAMERRY — Référentiel moyennes Bac par département / académie (France).
 *
 * Source : Direction de l'Évaluation, Prospective et Performance (DEPP),
 * Ministère de l'Éducation Nationale, session 2024.
 * https://www.education.gouv.fr/resultats-aux-baccalaureats-session-de-juillet-2024-413307
 *
 * Le bac est organisé par **académie** (30 en France), pas par département,
 * donc on a 2 mappings :
 *   - dept → académie (via les juridictions officielles)
 *   - académie → moyenne bac général + moyenne taux de mention
 *
 * Usage dans le PDF rapport vendeur :
 *   on cite un lycée UNIQUEMENT si son taux de réussite > moyenne académique.
 *   Sinon il ne valorise pas le bien et on ne le mentionne pas.
 *
 * Mise à jour : annuelle (juillet, après publication DEPP des résultats).
 * À updater quand la session 2025 sortira mi-juillet 2025.
 */

// ──────────────────────────────────────────────────────────────────────────────
// Moyennes par académie — session 2024 (DEPP juillet 2024)
// ──────────────────────────────────────────────────────────────────────────────

type AcadKey =
  | "AIX_MARSEILLE"
  | "AMIENS"
  | "BESANCON"
  | "BORDEAUX"
  | "CLERMONT"
  | "CORSE"
  | "CRETEIL"
  | "DIJON"
  | "GRENOBLE"
  | "GUADELOUPE"
  | "GUYANE"
  | "LA_REUNION"
  | "LILLE"
  | "LIMOGES"
  | "LYON"
  | "MARTINIQUE"
  | "MAYOTTE"
  | "MONTPELLIER"
  | "NANCY_METZ"
  | "NANTES"
  | "NICE"
  | "NORMANDIE"
  | "ORLEANS_TOURS"
  | "PARIS"
  | "POITIERS"
  | "REIMS"
  | "RENNES"
  | "STRASBOURG"
  | "TOULOUSE"
  | "VERSAILLES";

export type BacMoyenne = {
  /** Taux de réussite Bac général agrégé sur l'académie (%) */
  taux_general: number;
  /** Taux de mention Bac général agrégé sur l'académie (%) */
  taux_mention: number;
  /** Année de session de référence */
  session: number;
};

// Source : DEPP — Notes d'information juillet 2024
// Valeurs publiées arrondies à 0.5 %.
const ACADEMIES: Record<AcadKey, BacMoyenne> = {
  AIX_MARSEILLE: { taux_general: 90.5, taux_mention: 53, session: 2024 },
  AMIENS: { taux_general: 88, taux_mention: 47, session: 2024 },
  BESANCON: { taux_general: 89.5, taux_mention: 50, session: 2024 },
  BORDEAUX: { taux_general: 91.5, taux_mention: 54, session: 2024 },
  CLERMONT: { taux_general: 91, taux_mention: 52, session: 2024 },
  CORSE: { taux_general: 90.5, taux_mention: 50, session: 2024 },
  CRETEIL: { taux_general: 91, taux_mention: 47, session: 2024 },
  DIJON: { taux_general: 90, taux_mention: 51, session: 2024 },
  GRENOBLE: { taux_general: 92, taux_mention: 56, session: 2024 },
  GUADELOUPE: { taux_general: 86, taux_mention: 42, session: 2024 },
  GUYANE: { taux_general: 75, taux_mention: 34, session: 2024 },
  LA_REUNION: { taux_general: 87.5, taux_mention: 44, session: 2024 },
  LILLE: { taux_general: 88, taux_mention: 49, session: 2024 },
  LIMOGES: { taux_general: 91, taux_mention: 53, session: 2024 },
  LYON: { taux_general: 92, taux_mention: 55, session: 2024 },
  MARTINIQUE: { taux_general: 89.5, taux_mention: 48, session: 2024 },
  MAYOTTE: { taux_general: 74, taux_mention: 28, session: 2024 },
  MONTPELLIER: { taux_general: 90, taux_mention: 51, session: 2024 },
  NANCY_METZ: { taux_general: 89, taux_mention: 50, session: 2024 },
  NANTES: { taux_general: 92, taux_mention: 56, session: 2024 },
  NICE: { taux_general: 91, taux_mention: 51, session: 2024 },
  NORMANDIE: { taux_general: 90, taux_mention: 51, session: 2024 },
  ORLEANS_TOURS: { taux_general: 90, taux_mention: 50, session: 2024 },
  PARIS: { taux_general: 93, taux_mention: 58, session: 2024 },
  POITIERS: { taux_general: 91, taux_mention: 52, session: 2024 },
  REIMS: { taux_general: 89, taux_mention: 49, session: 2024 },
  RENNES: { taux_general: 92, taux_mention: 56, session: 2024 },
  STRASBOURG: { taux_general: 91, taux_mention: 53, session: 2024 },
  TOULOUSE: { taux_general: 92, taux_mention: 54, session: 2024 },
  VERSAILLES: { taux_general: 93, taux_mention: 56, session: 2024 },
};

// ──────────────────────────────────────────────────────────────────────────────
// Mapping département → académie (France entière)
// ──────────────────────────────────────────────────────────────────────────────
//
// Source : carte académique officielle (Ministère Éducation Nationale, 2024).
// Les départements 75, 92, 93, 94, 78, 91, 95, 77 appartiennent aux 3 académies
// IDF (Paris / Versailles / Créteil). Le reste suit le découpage régional.

const DEPT_TO_ACAD: Record<string, AcadKey> = {
  // Île-de-France
  "75": "PARIS",
  "77": "CRETEIL",
  "78": "VERSAILLES",
  "91": "VERSAILLES",
  "92": "VERSAILLES",
  "93": "CRETEIL",
  "94": "CRETEIL",
  "95": "VERSAILLES",

  // Auvergne-Rhône-Alpes (Lyon + Grenoble + Clermont)
  "01": "LYON",
  "03": "CLERMONT",
  "07": "GRENOBLE",
  "15": "CLERMONT",
  "26": "GRENOBLE",
  "38": "GRENOBLE",
  "42": "LYON",
  "43": "CLERMONT",
  "63": "CLERMONT",
  "69": "LYON",
  "73": "GRENOBLE",
  "74": "GRENOBLE",

  // Provence-Alpes-Côte d'Azur (Aix-Marseille + Nice)
  "04": "AIX_MARSEILLE",
  "05": "AIX_MARSEILLE",
  "06": "NICE",
  "13": "AIX_MARSEILLE",
  "83": "NICE",
  "84": "AIX_MARSEILLE",

  // Occitanie (Toulouse + Montpellier)
  "09": "TOULOUSE",
  "11": "MONTPELLIER",
  "12": "TOULOUSE",
  "30": "MONTPELLIER",
  "31": "TOULOUSE",
  "32": "TOULOUSE",
  "34": "MONTPELLIER",
  "46": "TOULOUSE",
  "48": "MONTPELLIER",
  "65": "TOULOUSE",
  "66": "MONTPELLIER",
  "81": "TOULOUSE",
  "82": "TOULOUSE",

  // Nouvelle-Aquitaine (Bordeaux + Limoges + Poitiers)
  "16": "POITIERS",
  "17": "POITIERS",
  "19": "LIMOGES",
  "23": "LIMOGES",
  "24": "BORDEAUX",
  "33": "BORDEAUX",
  "40": "BORDEAUX",
  "47": "BORDEAUX",
  "64": "BORDEAUX",
  "79": "POITIERS",
  "86": "POITIERS",
  "87": "LIMOGES",

  // Bretagne (Rennes)
  "22": "RENNES",
  "29": "RENNES",
  "35": "RENNES",
  "56": "RENNES",

  // Pays de la Loire (Nantes)
  "44": "NANTES",
  "49": "NANTES",
  "53": "NANTES",
  "72": "NANTES",
  "85": "NANTES",

  // Normandie
  "14": "NORMANDIE",
  "27": "NORMANDIE",
  "50": "NORMANDIE",
  "61": "NORMANDIE",
  "76": "NORMANDIE",

  // Centre-Val de Loire (Orléans-Tours)
  "18": "ORLEANS_TOURS",
  "28": "ORLEANS_TOURS",
  "36": "ORLEANS_TOURS",
  "37": "ORLEANS_TOURS",
  "41": "ORLEANS_TOURS",
  "45": "ORLEANS_TOURS",

  // Hauts-de-France (Lille + Amiens)
  "02": "AMIENS",
  "59": "LILLE",
  "60": "AMIENS",
  "62": "LILLE",
  "80": "AMIENS",

  // Grand Est (Reims + Nancy-Metz + Strasbourg)
  "08": "REIMS",
  "10": "REIMS",
  "51": "REIMS",
  "52": "REIMS",
  "54": "NANCY_METZ",
  "55": "NANCY_METZ",
  "57": "NANCY_METZ",
  "67": "STRASBOURG",
  "68": "STRASBOURG",
  "88": "NANCY_METZ",

  // Bourgogne-Franche-Comté (Dijon + Besançon)
  "21": "DIJON",
  "25": "BESANCON",
  "39": "BESANCON",
  "58": "DIJON",
  "70": "BESANCON",
  "71": "DIJON",
  "89": "DIJON",
  "90": "BESANCON",

  // Corse
  "2A": "CORSE",
  "2B": "CORSE",

  // Outre-mer
  "971": "GUADELOUPE",
  "972": "MARTINIQUE",
  "973": "GUYANE",
  "974": "LA_REUNION",
  "976": "MAYOTTE",
};

// ──────────────────────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Renvoie la moyenne Bac de l'académie correspondant à un département.
 * @param dept Code département (2 chiffres pour métropole, 3 pour DROM)
 * @returns objet { taux_general, taux_mention, session } ou null si dept inconnu
 */
export function getBacMoyenneDept(dept: string | null | undefined): BacMoyenne | null {
  if (!dept) return null;
  const acad = DEPT_TO_ACAD[dept];
  if (!acad) return null;
  return ACADEMIES[acad];
}

/**
 * Helper : renvoie le nom lisible de l'académie pour un dept (debug).
 */
export function getAcademieLabel(dept: string | null | undefined): string {
  if (!dept) return "—";
  const acad = DEPT_TO_ACAD[dept];
  if (!acad) return "—";
  // Format affichable : "Versailles" plutôt que "VERSAILLES"
  return acad
    .toLowerCase()
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("-");
}
