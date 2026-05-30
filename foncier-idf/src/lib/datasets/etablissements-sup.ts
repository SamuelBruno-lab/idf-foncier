/**
 * DATAMERRY — Établissements d'enseignement SUPÉRIEUR à proximité.
 *
 * Source : data.enseignementsup-recherche.gouv.fr (ESR)
 *   Dataset : fr-esr-principaux-etablissements-enseignement-superieur
 *   API ODS v2.1, gratuite, illimitée, pas d'auth.
 *
 * Catégorise les établissements en :
 *   - université (univ, IUT, faculté)
 *   - ecole_ingenieur (Centrale, INSA, ENSAM, Mines, Polytechnique, ENS…)
 *   - ecole_commerce (HEC, ESCP, ESSEC, EM, ESC…)
 *   - iep (Sciences Po, IEP régionaux)
 *   - institut (Pasteur, Curie, INRIA, INED, etc.)
 *   - autre (BTS, classe prépa hors-lycée…)
 *
 * Argument vendeur :
 *   - Familles avec étudiants : "Université Paris-Cité à 12 min en RER"
 *   - Investisseurs locatif étudiant : signal demande forte studio/T1
 *   - Pied-à-terre HNWI : grande école = quartier valorisé
 *
 * Cache 90 jours (peu de mouvement, mise à jour annuelle MESR).
 */

import { addressHash, fetchWithCache, haversineMeters } from "./_cache";

const ODS_BASE =
  "https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/" +
  "fr-esr-principaux-etablissements-enseignement-superieur/records";

// Rayon élargi à 10 km : les universités/grandes écoles sont 5-10× moins
// denses que les lycées, et un étudiant peut accepter 30 min de trajet.
const DEFAULT_RADIUS_M = 10000;
const TTL_DAYS = 90;
const TIMEOUT_MS = 6000;

export type EtablissementSupCategorie =
  | "universite"
  | "ecole_ingenieur"
  | "ecole_commerce"
  | "ecole_sante"
  | "iep"
  | "institut"
  | "autre";

export type EtablissementSup = {
  uai: string;
  nom: string;
  categorie: EtablissementSupCategorie;
  type_brut: string;
  secteur: "public" | "prive" | "inconnu";
  commune: string;
  lat: number;
  lon: number;
  distance_m: number;
  /** Marqueur éditorial : grand nom reconnu (HEC, Polytechnique, etc.) */
  prestige: boolean;
};

export type EtablissementsSupResult = {
  available: boolean;
  count: number;
  /** Top 6 plus proches (toutes catégories confondues, triés distance) */
  top: EtablissementSup[];
  par_categorie: Record<EtablissementSupCategorie, number>;
  source: string;
  fetched_at: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Catégorisation par mots-clés sur type_d_etablissement + nom
// ──────────────────────────────────────────────────────────────────────────────

function categorize(typeStr: string, nom: string): EtablissementSupCategorie {
  const t = (typeStr ?? "").toLowerCase();
  const n = (nom ?? "").toLowerCase();
  const blob = `${t} ${n}`;
  // Ordre : checks les plus spécifiques d'abord. Santé checké AVANT université
  // (sinon "Faculté de médecine de Sorbonne" tombe en "universite").
  if (
    /ifsi\b|ifas\b|ifap\b|ifmem\b|institut de formation en soins infirmiers|institut de formation d'aides?-soignants?|école d'infirmi|école de sages?-femmes?|école de maïeutique|école de kinésithérap|école d'?ostéopathie|école dentaire|école de pharmacie|école vétérinaire|école de santé|faculté de médecine|faculté de pharmacie|faculté d'?odontologie|faculté de chirurgie dentaire|école nationale vétérinaire|école nationale de la santé|ufr (de )?(médecine|pharmacie|odontologie|santé)|institut paramédical/.test(blob)
  )
    return "ecole_sante";
  if (/sciences? po|iep|institut d'?études politiques/.test(blob)) return "iep";
  if (/école d'?ingénieur|insa\b|ensam|école centrale|polytechnique|mines paristech|enac|enpc|ecam|epita|epitech|isep|esme|esilv|école nationale supérieure (?!d'arts|de la magistrature)|ens cachan|ens lyon|ens paris/.test(blob))
    return "ecole_ingenieur";
  if (/école (de |supérieure de )?commerce|école de management|escp|essec|edhec|emlyon|hec|kedge|skema|neoma|inseec|esc(\s|p)|toulouse business|grenoble (em|école de management)/.test(blob))
    return "ecole_commerce";
  if (/^université|universit[ée]\b|faculté|iut\b|institut universitaire de technologie/.test(blob))
    return "universite";
  if (/^institut\b|institut national|institut pasteur|institut curie|inria|inserm|ined/.test(blob))
    return "institut";
  return "autre";
}

// Grands noms reconnus → badge "PRESTIGE". Liste calibrée DATAMERRY.
const PRESTIGE_KEYWORDS = [
  "polytechnique",
  "hec ",
  "essec",
  "escp",
  "edhec",
  "emlyon",
  "centrale",
  "mines paristech",
  "ens paris",
  "ens cachan",
  "ens lyon",
  "ens ulm",
  "sciences po paris",
  "sciences po",
  "dauphine",
  "sorbonne",
  "psl",
  "panthéon",
  "paris-saclay",
  "polytech",
  "institut pasteur",
  "institut curie",
  "ponts paristech",
  "agroparistech",
];

function isPrestige(nom: string): boolean {
  const n = nom.toLowerCase();
  return PRESTIGE_KEYWORDS.some((k) => n.includes(k));
}

function parseSecteur(raw: string | undefined): EtablissementSup["secteur"] {
  if (!raw) return "inconnu";
  const r = raw.toLowerCase();
  if (r.includes("public")) return "public";
  if (r.includes("priv")) return "prive";
  return "inconnu";
}

// ──────────────────────────────────────────────────────────────────────────────
// ODS fetch
// ──────────────────────────────────────────────────────────────────────────────

type OdsRecord = {
  uai?: string;
  uo_lib_officiel?: string;
  uo_lib?: string;
  uo_lib_court?: string;
  type_d_etablissement?: string;
  type_d_etabl?: string;
  type?: string;
  secteur_d_etablissement?: string;
  secteur?: string;
  com_nom?: string;
  com_libelle?: string;
  commune?: string;
  ville?: string;
  coordonnees?: { lat?: number; lon?: number } | { type?: string; coordinates?: number[] };
  geolocalisation?: { lat?: number; lon?: number } | { type?: string; coordinates?: number[] };
};

function pickCoords(rec: OdsRecord): { lat: number; lon: number } | null {
  const candidates = [rec.coordonnees, rec.geolocalisation];
  for (const geo of candidates) {
    if (!geo) continue;
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
  }
  return null;
}

async function fetchEtabSupFromOds(
  lat: number,
  lon: number,
  radius_m: number,
): Promise<EtablissementsSupResult> {
  // Le dataset ESR utilise généralement le champ coordonnees pour la geo
  const where = `within_distance(coordonnees, geom'POINT(${lon} ${lat})', ${radius_m}m)`;
  const order = `distance(coordonnees, geom'POINT(${lon} ${lat})')`;
  const params = new URLSearchParams({
    where,
    order_by: order,
    limit: "30",
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
        par_categorie: {
          universite: 0,
          ecole_ingenieur: 0,
          ecole_commerce: 0,
          iep: 0,
          institut: 0,
          autre: 0,
        },
        source: `data.enseignementsup-recherche.gouv.fr (HTTP ${res.status})`,
        fetched_at: now,
      };
    }
    const json = (await res.json()) as { results?: OdsRecord[] };
    const records = json.results ?? [];

    // Dédoublonnage par UAI (un établissement peut avoir plusieurs implantations)
    const byUai = new Map<string, EtablissementSup>();
    for (const rec of records) {
      const coords = pickCoords(rec);
      if (!coords) continue;
      const uai = (rec.uai ?? "").trim() || `${rec.uo_lib_officiel ?? rec.uo_lib ?? ""}::${coords.lat}::${coords.lon}`;
      const nom = rec.uo_lib_officiel ?? rec.uo_lib ?? rec.uo_lib_court ?? "Établissement non identifié";
      const typeBrut = rec.type_d_etablissement ?? rec.type_d_etabl ?? rec.type ?? "";
      const categorie = categorize(typeBrut, nom);
      const distance_m = Math.round(haversineMeters(lat, lon, coords.lat, coords.lon));
      const existing = byUai.get(uai);
      // Garde la plus proche implantation par UAI
      if (existing && existing.distance_m <= distance_m) continue;
      byUai.set(uai, {
        uai,
        nom,
        categorie,
        type_brut: typeBrut,
        secteur: parseSecteur(rec.secteur_d_etablissement ?? rec.secteur),
        commune: rec.com_nom ?? rec.com_libelle ?? rec.commune ?? rec.ville ?? "",
        lat: coords.lat,
        lon: coords.lon,
        distance_m,
        prestige: isPrestige(nom),
      });
    }

    const items = Array.from(byUai.values()).sort((a, b) => a.distance_m - b.distance_m);

    const par_categorie: Record<EtablissementSupCategorie, number> = {
      universite: 0,
      ecole_ingenieur: 0,
      ecole_commerce: 0,
      ecole_sante: 0,
      iep: 0,
      institut: 0,
      autre: 0,
    };
    for (const it of items) par_categorie[it.categorie]++;

    return {
      available: items.length > 0,
      count: items.length,
      // Top 6 : assez pour montrer la diversité sans saturer le PDF.
      top: items.slice(0, 6),
      par_categorie,
      source: "data.enseignementsup-recherche.gouv.fr (fr-esr-principaux-etablissements)",
      fetched_at: now,
    };
  } catch (err) {
    return {
      available: false,
      count: 0,
      top: [],
      par_categorie: {
        universite: 0,
        ecole_ingenieur: 0,
        ecole_commerce: 0,
        ecole_sante: 0,
        iep: 0,
        institut: 0,
        autre: 0,
      },
      source: `data.enseignementsup-recherche.gouv.fr (error: ${err instanceof Error ? err.message : "unknown"})`,
      fetched_at: now,
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique avec cache
// ──────────────────────────────────────────────────────────────────────────────

export async function getEtablissementsSup(
  lat: number,
  lon: number,
  radius_m: number = DEFAULT_RADIUS_M,
): Promise<EtablissementsSupResult & { cached: boolean }> {
  const hash = addressHash(lat, lon);

  const { data, cached } = await fetchWithCache<EtablissementsSupResult>(
    hash,
    { lat, lon },
    "etablissements_sup_10km_v2",
    TTL_DAYS,
    () => fetchEtabSupFromOds(lat, lon, radius_m),
    0,
    (r) => r.available && r.count > 0,
  );

  return { ...data, cached };
}
