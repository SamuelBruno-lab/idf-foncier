/**
 * DATAMERRY — Grands projets d'infrastructure à proximité (anticipation prix).
 *
 * KILLER FEATURE forward-looking vs PriceHubble/Immo Data (backward-looking).
 *
 * Source : table dim_grands_projets (Grand Paris Express, LGV, canaux,
 * ZAC majeures, gigafactories). Alimentée par pipeline_grands_projets.py.
 *
 * Logique : pour un bien à l'adresse (lat, lon), on identifie les grands
 * projets en cours / à venir qui impactent sa valeur (+5 à +30% anticipation).
 *
 * Effet éditorial : génère des phrases vendeur fortes du type
 * "À 600m de la future gare Saint-Denis Pleyel (Grand Paris Express,
 *  livraison fin 2025) — anticipation +8 à +18% sur 2 ans".
 */

import { createClient } from "@supabase/supabase-js";

export type GrandProjetRow = {
  id: string;
  nom: string;
  type:
    | "gare_futur" | "ligne_metro" | "tramway"
    | "gare_tgv" | "lgv" | "rer_extension"
    | "canal_futur" | "canal_existant" | "voie_navigable_modernisee"
    | "zac" | "oin" | "gigafactory"
    | "aeroport_extension" | "port_extension"
    | "autre";
  importance: "nationale" | "regionale" | "metropolitaine" | "communale";
  etat:
    | "concertation" | "dup" | "financement_acquis"
    | "travaux_en_cours" | "livre_partiel" | "livre_total" | "annule";
  date_livraison_estimee: string | null; // ISO date
  impact_prix_pct_min: number | null;
  impact_prix_pct_max: number | null;
  description: string | null;
  url_officiel: string | null;
  distance_m: number;
};

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Renvoie les grands projets impactant un point GPS, triés par
 * importance (nationale > régionale > métropolitaine > communale)
 * puis par proximité.
 *
 * Filtre côté SQL : seulement les projets ACTIFS (concertation → travaux),
 * exclut les projets livrés totalement (effet anticipation épuisé) et les
 * projets annulés.
 *
 * Le rayon est défini par PROJET (gare 800m, ZAC 2000m, gigafactory 5000m)
 * via la colonne rayon_impact_m, donc on peut passer un max global large
 * (3000-5000m) sans craindre de fausses détections.
 *
 * @param lat - Latitude WGS84 du bien
 * @param lon - Longitude WGS84 du bien
 * @param max_distance_m - Distance max globale en mètres (défaut 5 km)
 * @param limit - Nb de projets max retournés (défaut 5)
 */
export async function findNearbyGrandsProjets(
  lat: number,
  lon: number,
  max_distance_m = 5000,
  limit = 5,
): Promise<GrandProjetRow[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("find_nearby_grands_projets", {
      p_lat: lat,
      p_lon: lon,
      p_max_distance_m: max_distance_m,
      p_limit: limit,
    });
    if (error) {
      console.warn("[grands-projets] RPC error:", error.message);
      return [];
    }
    if (!data || !Array.isArray(data)) return [];
    return data as GrandProjetRow[];
  } catch (err) {
    console.warn("[grands-projets] exception:", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatage éditorial pour le PDF rapport vendeur
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Génère une phrase narrative éditoriale pour UN grand projet, calibrée
 * pour insertion dans un rapport vendeur (ton informatif, sans promesse
 * chiffrée d'évolution de prix).
 *
 * ⚖️ CONFORMITÉ DÉONTOLOGIQUE :
 *
 * Selon la loi Hoguet (n° 70-9 du 2 janvier 1970), le décret 72-678
 * art. 4-1, le Code de la consommation L121-1, et la Charte de l'Expertise
 * en Évaluation Immobilière 6e édition 2025, le titulaire de la carte T
 * (ici Eurealimmo SARL) ne peut PAS promettre, suggérer ou laisser
 * entendre une plus-value chiffrée sur un bien immobilier. Toute
 * prospective non sourcée méthodologiquement (DCF, CAPM, modèle
 * statistique publié) constitue une pratique commerciale trompeuse.
 *
 * Conséquence : on mentionne le projet et son potentiel d'attractivité
 * QUALITATIVEMENT (ex: "secteur en mutation"), sans jamais énoncer le
 * pourcentage d'anticipation interne. Les valeurs impact_prix_pct_min/max
 * restent en base pour usage interne (chatbot pro, analyses cabinet,
 * dashboard mandataires) mais ne sont JAMAIS exposées dans le rapport
 * vendeur public.
 *
 * Exemples de sortie :
 *   "À 600m de la future gare Saint-Denis Pleyel (Grand Paris Express,
 *    livraison 2025). Secteur en transformation."
 *
 *   "Aux portes du futur Canal Seine-Nord Europe (livraison 2030).
 *    Projet structurant pour l'attractivité de la commune."
 */
export function formatGrandProjetPhrase(p: GrandProjetRow): string {
  const dist = p.distance_m < 100
    ? "à proximité immédiate"
    : p.distance_m < 1000
    ? `à ${p.distance_m} m`
    : `à ${(p.distance_m / 1000).toFixed(1)} km`;

  const livraison = p.date_livraison_estimee
    ? new Date(p.date_livraison_estimee).getFullYear()
    : null;

  // Calibrage par type pour un ton informatif et naturel
  const intro = (() => {
    switch (p.type) {
      case "gare_futur":
        return `${dist} de la future ${p.nom}${livraison ? ` (livraison ${livraison})` : ""}`;
      case "gare_tgv":
        return `${dist} de la future ${p.nom}${livraison ? ` (livraison ${livraison})` : ""}`;
      case "canal_futur":
        return `${dist} du futur ${p.nom}${livraison ? ` (livraison ${livraison})` : ""}`;
      case "canal_existant":
        return `${dist} du ${p.nom}`;
      case "zac":
      case "oin":
        return `${dist} du projet d'aménagement ${p.nom}`;
      case "gigafactory":
        return `${dist} du pôle industriel ${p.nom}`;
      default:
        return `${dist} de ${p.nom}`;
    }
  })();

  // Mention qualitative SANS chiffrage prospectif
  return `${intro}. ${qualifyImpactQualitative(p)}`;
}

/**
 * Génère un titre court (1 ligne) pour le PDF, à afficher comme bullet.
 * Conforme déontologie : aucun chiffrage prospectif.
 *
 * Exemple : "Future gare Saint-Denis Pleyel — 600m, livraison 2025"
 */
export function formatGrandProjetBullet(p: GrandProjetRow): string {
  const dist = p.distance_m < 1000
    ? `${p.distance_m} m`
    : `${(p.distance_m / 1000).toFixed(1)} km`;
  const livraison = p.date_livraison_estimee
    ? `, livraison ${new Date(p.date_livraison_estimee).getFullYear()}`
    : "";
  return `${p.nom} — ${dist}${livraison}`;
}

/**
 * Transforme l'impact prix INTERNE (valeurs % min/max) en mention
 * qualitative CONFORME loi Hoguet et déontologie immobilière.
 *
 * On NE communique JAMAIS le pourcentage chiffré au vendeur final.
 * On utilise une grille qualitative qui informe sans engager.
 *
 * Grille :
 *   Impact internes >= 15%  → "Projet structurant majeur"
 *   Impact internes 8-14%   → "Secteur en transformation"
 *   Impact internes 3-7%    → "Quartier dynamique"
 *   Impact internes < 3%    → "À noter dans l'environnement"
 *   Pas d'info              → "Projet à proximité"
 *
 * Note : ces formules sont des constats neutres (l'arrivée d'une nouvelle
 * gare = fait observable = mutation du quartier = vrai), pas des
 * promesses de plus-value.
 */
export function qualifyImpactQualitative(p: GrandProjetRow): string {
  const impactMax = p.impact_prix_pct_max ?? 0;

  if (impactMax >= 15) {
    return "Projet structurant majeur pour l'attractivité du quartier.";
  }
  if (impactMax >= 8) {
    return "Secteur en pleine transformation urbaine.";
  }
  if (impactMax >= 3) {
    return "Quartier inscrit dans une dynamique d'aménagement.";
  }
  if (impactMax > 0) {
    return "Projet à intégrer à l'environnement local.";
  }
  return "Projet à proximité.";
}

/**
 * Label compact qualitatif pour affichage bullet (1-3 mots).
 *
 * Utilisé sous le bullet pour résumer la dynamique du quartier sans
 * promesse chiffrée :
 *   "Projet structurant" / "Secteur en mutation" / "Quartier dynamique"
 */
export function qualifyImpactBadge(p: GrandProjetRow): string {
  const impactMax = p.impact_prix_pct_max ?? 0;
  if (impactMax >= 15) return "Projet structurant majeur";
  if (impactMax >= 8) return "Secteur en mutation";
  if (impactMax >= 3) return "Quartier dynamique";
  return "Projet à proximité";
}

/**
 * Détermine si un projet mérite d'apparaître en exergue dans le PDF.
 * Critères INTERNES (non affichés) : importance nationale OU impact >= 15%.
 */
export function isStrongImpactProjet(p: GrandProjetRow): boolean {
  if (p.importance === "nationale") return true;
  if ((p.impact_prix_pct_max ?? 0) >= 15) return true;
  return false;
}
