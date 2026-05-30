/**
 * DATAMERRY — PDF rapport "lead" cabinet white-label.
 *
 * Composant React-PDF léger (1 page A4) envoyé par email au visiteur et au
 * cabinet quand un lead est capturé depuis /cabinets/{slug}/estimer.
 *
 * Pourquoi un PDF dédié et pas le PropertyReportPDF complet ?
 *   - Réutilise les données déjà collectées par le wizard (zéro fetch
 *     supplémentaire côté serveur → endpoint /lead rapide < 2s)
 *   - 1 page → ouvre vite dans Gmail/Outlook (vs 3 pages du full report)
 *   - Brandé cabinet (couleur primaire, nom)
 *   - Volontairement "teaser" : donne l'estimation marché + un récap clair,
 *     mais l'expertise détaillée reste la valeur ajoutée du cabinet quand
 *     il rappellera le lead. Évite que le visiteur se "self-serve" et zappe
 *     l'agent immobilier.
 */

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from "@react-pdf/renderer";
import { getBacMoyenneDept } from "../datasets/bac-moyennes";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type CabinetLeadReportData = {
  cabinet_name: string;
  cabinet_legal?: string | null;
  primary_color: string; // hex
  secondary_color?: string | null;

  visitor_name: string;
  visitor_email: string;

  address: string;
  type_bien: string;
  surface: number | null;

  // Estimation (résultat exact de l'endpoint /api/cabinets/[slug]/estimate)
  prix_m2_median: number | null;
  prix_m2_p10: number | null;
  prix_m2_p90: number | null;
  prix_total_median: number | null;
  nb_ventes: number | null;
  /** Fix #2 : true si le P90 a été ramené au plafond commune P95 */
  capped_to_commune_ceiling?: boolean;
  /**
   * Fix #2 — Plafond commune par bucket de surface.
   * Affiché dans le PDF pour transparence et crédibilisation.
   */
  commune_ceiling?: {
    bucket: "T1" | "T2" | "T3" | "T4" | "T5+";
    prix_m2_p95: number | null;
    prix_total_p95: number | null;
    nb_ventes_bucket: number;
    confiance: "high" | "medium" | "low" | "none";
  } | null;
  /**
   * Fix #1 — Ajustement par bucket de surface.
   * Présent uniquement si l'ajustement a été appliqué (sinon null).
   * pct_ajustement : -12 = décote 12 %, +5 = prime 5 %.
   */
  surface_adjustment?: {
    bucket_dominant: "T1" | "T2" | "T3" | "T4" | "T5+";
    bucket_cible: "T1" | "T2" | "T3" | "T4" | "T5+";
    pct_ajustement: number;
    ratio: number;
    nb_ventes_voisinage: number;
    confiance: "high" | "medium" | "low" | "none";
  } | null;

  // Réponses brutes du wizard pour récap (intent, étage, DPE, etc.)
  wizard_answers: Record<string, unknown>;

  generated_at: Date;

  // ─── Données opensource enrichies (page 2 du rapport) ─────────────────────

  /** Distance Notre-Dame + estimation temps trajet + première gare (si IDF) */
  paris_distance?: {
    is_paris: boolean;
    is_ile_de_france: boolean;
    crow_distance_km: number;
    estimated_minutes_to_paris: number | null;
    minutes_to_paris_from_official_api: boolean;
    /** Détail porte-à-porte si IDFM PRIM dispo */
    journey_to_paris: {
      destination: string;
      destination_id: string;
      total_duration_min: number;
      walking_duration_min: number;
      walking_distance_m: number;
      nb_transfers: number;
      primary_lines: string[];
      alternatives: Array<{
        duration_min: number;
        walking_min: number;
        nb_transfers: number;
        primary_lines: string[];
      }>;
      sections: Array<{
        type: "walking" | "transit" | "transfer" | "wait" | "other";
        duration_min: number;
        distance_m: number | null;
        line: string | null;
        line_color: string | null;
        from: string | null;
        to: string | null;
      }>;
    } | null;
    nearest_major_station: {
      nom: string;
      type: "train" | "rer" | "metro";
      distance_m: number;
      walk_minutes: number;
      reseau: string | null;
      ligne: string | null;
    } | null;
  } | null;

  /** Transports à proximité (Overpass / OSM) */
  transports?: {
    score_accessibilite: number;
    count: number;
    par_type: Record<string, number>;
    top_stops: Array<{
      nom: string;
      type: string;
      distance_m: number;
      walk_minutes: number;
      ligne: string | null;
    }>;
    /** Rayon utilisé pour la requête (m) — adapté par zone géographique */
    radius_m?: number;
  } | null;

  /** Écoles à proximité (Annuaire Éducation Nationale) */
  ecoles?: {
    count: number;
    par_type: Record<string, number>;
    /** Top écoles avec leur nom officiel (Annuaire Éducation Nationale) */
    top?: Array<{
      nom: string;
      type: string;
      statut: "public" | "prive" | "inconnu";
      distance_m: number;
      walk_minutes: number;
    }>;
  } | null;

  /** Top 3 lycées avec taux de réussite bac (data.education.gouv.fr) */
  lycees_bac?: {
    count: number;
    top: Array<{
      nom: string;
      statut: "public" | "prive" | "inconnu";
      commune: string;
      dept: string | null;
      taux_reussite_general: number | null;
      taux_reussite_techno: number | null;
      taux_mention_general: number | null;
      distance_m: number;
      annee_session: number | null;
    }>;
  } | null;

  /** Top 3 lycées professionnels avec taux de réussite bac pro */
  lycees_pro?: {
    count: number;
    top: Array<{
      nom: string;
      statut: "public" | "prive" | "inconnu";
      commune: string;
      dept: string | null;
      taux_reussite_pro: number | null;
      taux_mention_pro: number | null;
      distance_m: number;
      annee_session: number | null;
    }>;
  } | null;

  /** Top 3 Centres de Formation d'Apprentis (CAP/BEP, Annuaire EN) */
  cfa?: {
    count: number;
    top: Array<{
      nom: string;
      type: string;
      statut: "public" | "prive" | "inconnu";
      distance_m: number;
      walk_minutes: number;
    }>;
  } | null;

  /** Enseignement supérieur (universités, grandes écoles, IUT, IEP, instituts, écoles de santé) */
  etablissements_sup?: {
    count: number;
    par_categorie: {
      universite: number;
      ecole_ingenieur: number;
      ecole_commerce: number;
      ecole_sante: number;
      iep: number;
      institut: number;
      autre: number;
    };
    top: Array<{
      nom: string;
      categorie:
        | "universite"
        | "ecole_ingenieur"
        | "ecole_commerce"
        | "ecole_sante"
        | "iep"
        | "institut"
        | "autre";
      secteur: "public" | "prive" | "inconnu";
      commune: string;
      distance_m: number;
      prestige: boolean;
    }>;
  } | null;

  /** Écoles paramédicales FINESS (IFSI privés, kiné, ortho, sage-femme…) */
  ecoles_sante?: {
    count: number;
    top: Array<{
      nom: string;
      type: "ifsi" | "ifas_ifap" | "kine_ortho" | "sage_femme" | "autre_sante";
      categorie_finess: string;
      commune: string;
      distance_m: number;
    }>;
  } | null;

  /** Top 2 points d'intérêts notables (OSM + wikipedia filter) */
  points_interet?: {
    count: number;
    top: Array<{
      nom: string;
      type: "monument" | "musee" | "attraction" | "memorial" | "viewpoint" | "autre";
      distance_m: number;
    }>;
  } | null;

  /**
   * Fix #3 — Équipements LOCAUX (sport / scolaire) sans filtre wikipedia.
   * Catch les stades, piscines, écoles maternelles, collèges qui pèsent
   * dans la décision famille même s'ils ne sont pas notoires.
   */
  proximite_locale?: {
    sport: Array<{
      nom: string;
      type: "stade" | "complexe_sportif" | "piscine" | "terrain" | "fitness";
      distance_m: number;
      proximite: "adjacent" | "a_pied" | "quartier";
    }>;
    scolaire: Array<{
      nom: string;
      type: "maternelle" | "ecole" | "college";
      distance_m: number;
      proximite: "adjacent" | "a_pied" | "quartier";
    }>;
  } | null;

  /**
   * Fix bonus — Gares train/RER/métro/tramway < 1500 m.
   * Capture la gare de Drancy à 900 m alors qu'elle est hors rayon 800 m
   * du dataset transports principal.
   */
  gares_proches?: Array<{
    nom: string;
    type: string;
    distance_m: number;
    walk_minutes: number;
    ligne: string | null;
  }>;

  /** Services quotidien à pied (Overpass / OSM) */
  services?: {
    score_quotidien: number;
    count: number;
    par_categorie: Record<string, number>;
  } | null;

  /** Données socio-démo INSEE Filosofi / IRIS */
  insee?: {
    revenu_median_uc_eur: number | null;
    taux_proprietaires_pct: number | null;
    taux_csp_plus_pct: number | null;
    population_municipale: number | null;
  } | null;

  /** Évolution prix m² DVF par année (micro-marché HDBSCAN ou commune). */
  price_evolution?: {
    type_local: string;
    years: Array<{
      annee: number;
      prix_m2_median: number;
      prix_m2_p25?: number | null;
      prix_m2_p75?: number | null;
      nb_ventes: number;
    }>;
    variation_pct_total: number | null;
    variation_pct_5y: number | null;
    annee_min: number | null;
    annee_max: number | null;
    /** "cluster" = micro-marché HDBSCAN, "commune" = commune entière. */
    scope?: "cluster" | "commune";
    /** Nb total de ventes utilisées (cluster scope). */
    nb_total_ventes_cluster?: number;
    /** "hull" = polygon exact, "centroid" = fallback nearest cluster. */
    match_method?: "hull" | "centroid" | "radius_400m" | "none" | null;
    /**
     * Référence comparative commune entière (2e courbe superposée au cluster).
     * Permet de visualiser si le micro-marché sur/sous-performe la commune
     * année après année. Null si seul le scope cluster est dispo.
     */
    commune_years?: Array<{
      annee: number;
      prix_m2_median: number;
      nb_ventes: number;
    }> | null;
    commune_variation_pct_total?: number | null;
    commune_code?: string | null;
  } | null;

  /**
   * Grands projets d'infrastructure à proximité (KILLER FEATURE forward-looking).
   *
   * Inclut : Grand Paris Express (gares futures), LGV (GPSO, LNPCA), canaux
   * (Saint-Martin, Ourcq, Seine-Nord Europe), ZAC majeures (Saclay, Confluence,
   * Euratlantique, Euroméditerranée), gigafactories (ProLogium, Verkor, ACC,
   * STMicro Crolles).
   *
   * Chaque projet a un impact prix anticipé (+5 à +30%) selon proximité et
   * stade d'avancement (concertation → DUP → travaux → livraison).
   *
   * Source : table dim_grands_projets, alimentée par pipeline_grands_projets.py.
   */
  grands_projets?: Array<{
    nom: string;
    type: string;
    importance: "nationale" | "regionale" | "metropolitaine" | "communale";
    etat: string;
    date_livraison_estimee: string | null;
    impact_prix_pct_min: number | null;
    impact_prix_pct_max: number | null;
    description: string | null;
    distance_m: number;
  }> | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Styles (StyleSheet React-PDF — pas du CSS)
// ──────────────────────────────────────────────────────────────────────────────

function buildStyles(primary: string) {
  return StyleSheet.create({
    page: {
      // Marges réduites pour tenir tout le rapport sur 2 pages.
      // Avant : 40px partout → page 3 quasi vide. Maintenant 28-30px.
      paddingTop: 28,
      paddingBottom: 28,
      paddingLeft: 32,
      paddingRight: 32,
      fontSize: 10,
      fontFamily: "Helvetica",
      color: "#0f172a",
      backgroundColor: "#ffffff",
    },
    header: {
      borderBottomColor: primary,
      borderBottomWidth: 2,
      paddingBottom: 12,
      marginBottom: 20,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    headerLeft: {
      flexDirection: "column",
    },
    cabinetName: {
      fontSize: 18,
      fontWeight: 700,
      color: primary,
      letterSpacing: 1,
    },
    headerRight: {
      flexDirection: "column",
      alignItems: "flex-end",
    },
    headerDate: {
      fontSize: 8,
      color: "#64748b",
    },
    title: {
      fontSize: 16,
      fontWeight: 700,
      marginBottom: 4,
      color: "#0f172a",
    },
    subtitle: {
      fontSize: 9,
      color: "#64748b",
      marginBottom: 18,
    },
    estimationCard: {
      backgroundColor: "#f8fafc",
      borderColor: primary,
      borderWidth: 1,
      borderRadius: 6,
      padding: 18,
      marginBottom: 16,
      alignItems: "center",
    },
    estimationLabel: {
      fontSize: 9,
      letterSpacing: 1,
      color: primary,
      fontWeight: 700,
      marginBottom: 6,
      textTransform: "uppercase",
    },
    estimationValue: {
      fontSize: 32,
      fontWeight: 800,
      color: primary,
      marginBottom: 4,
    },
    estimationSub: {
      fontSize: 10,
      color: "#475569",
    },
    rangeRow: {
      flexDirection: "row",
      justifyContent: "space-around",
      marginTop: 14,
      paddingTop: 10,
      borderTopColor: "#e2e8f0",
      borderTopWidth: 1,
      width: "100%",
    },
    rangeStat: {
      alignItems: "center",
    },
    rangeStatLabel: {
      fontSize: 8,
      textTransform: "uppercase",
      color: "#64748b",
      letterSpacing: 1,
    },
    rangeStatValue: {
      fontSize: 11,
      fontWeight: 700,
      color: "#0f172a",
      marginTop: 2,
    },
    sectionTitle: {
      fontSize: 11,
      fontWeight: 700,
      color: primary,
      // Marges compressées pour tenir le rapport sur 2 pages.
      marginTop: 9,
      marginBottom: 4,
    },
    detailGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    detailItem: {
      width: "50%",
      paddingVertical: 4,
    },
    detailLabel: {
      fontSize: 8,
      color: "#64748b",
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    detailValue: {
      fontSize: 10,
      color: "#0f172a",
      fontWeight: 600,
    },
    expertNote: {
      backgroundColor: "#fef9c3",
      borderColor: "#facc15",
      borderWidth: 1,
      borderRadius: 6,
      padding: 12,
      marginTop: 16,
      fontSize: 9,
      color: "#713f12",
      lineHeight: 1.5,
    },
    expertNoteTitle: {
      fontSize: 10,
      fontWeight: 700,
      marginBottom: 4,
      color: "#713f12",
    },
    footer: {
      position: "absolute",
      bottom: 30,
      left: 40,
      right: 40,
      borderTopColor: "#e2e8f0",
      borderTopWidth: 1,
      paddingTop: 10,
      fontSize: 7,
      color: "#94a3b8",
      textAlign: "center",
    },
    footerBold: {
      fontWeight: 700,
      color: "#475569",
    },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

// Formatte un nombre avec espace ASCII normal comme séparateur de milliers.
//
// On NE PEUT PAS utiliser `Intl.NumberFormat("fr-FR")` dans le PDF car le
// séparateur de milliers français est un NARROW NO-BREAK SPACE (U+202F) qui
// n'est PAS dans la police Helvetica embarquée par @react-pdf/renderer →
// le PDF affichait "138/322€" au lieu de "138 322 €". Espace ASCII pour
// tous (compatible toute police Type1).
const fmt = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return "—";
  // Arrondit puis insère un espace ASCII tous les 3 chiffres (regex lookahead)
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};

const fmtDate = (d: Date): string =>
  d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

// Mappings lisibles pour les réponses brutes du wizard
const intentLabel: Record<string, string> = {
  vendeur: "Projet de vente",
  acheteur: "Projet d'achat",
  curieux: "Renseignement",
};

const etatLabel: Record<string, string> = {
  "renove-neuf": "Refait à neuf / Très bon état",
  bon: "Bon état",
  correct: "Correct, quelques travaux",
  renover: "À rénover",
};

const usageLabel: Record<string, string> = {
  "residence-principale": "Résidence principale",
  "investissement-locatif": "Investissement locatif",
  "residence-secondaire": "Résidence secondaire",
  "vente-occupe": "Vente occupée",
};

const usageProLabel: Record<string, string> = {
  "vente-detail": "Commerce de détail",
  restauration: "Restauration / bar",
  bureau: "Bureau / profession libérale",
  medical: "Médical / paramédical",
  "atelier-stockage": "Atelier / stockage",
  autre: "Autre activité",
};

const usageTerrainLabel: Record<string, string> = {
  "maison-individuelle": "Construction maison individuelle",
  collectif: "Construction collectif",
  amenagement: "Aménagement / lotissement",
  agricole: "Usage agricole",
  inconnu: "Indéterminé",
};

function pickUsage(answers: Record<string, unknown>): string {
  const u = answers.usage as string | undefined;
  const up = answers.usage_pro as string | undefined;
  const ut = answers.usage_terrain as string | undefined;
  if (u) return usageLabel[u] ?? u;
  if (up) return usageProLabel[up] ?? up;
  if (ut) return usageTerrainLabel[ut] ?? ut;
  return "—";
}

/**
 * Bar+line chart de l'évolution prix m² par année.
 *
 * Implémenté en React-PDF natif (pas de lib graphique) :
 *   - Barre principale = micro-marché HDBSCAN (cluster) en couleur cabinet
 *   - Repère superposé = moyenne commune entière (référence comparative)
 *     affiché comme un petit trait gris au niveau de la médiane commune
 *     dans la même échelle verticale. Permet au vendeur de voir année par
 *     année si son micro-marché sur-performe ou sous-performe la commune.
 *
 * Si commune_years est null, on affiche un graphique simple (legacy).
 *
 * Affiche : label année + bar cluster + marqueur commune + valeur €/m²
 * + caption avec variation 5y / variation totale + comparaison commune.
 */
function PriceEvolutionChart({
  years,
  variation_pct_total,
  variation_pct_5y,
  type_local,
  scope,
  primaryColor,
  communeYears,
  communeVariationPctTotal,
}: {
  years: Array<{ annee: number; prix_m2_median: number; nb_ventes: number }>;
  variation_pct_total: number | null;
  variation_pct_5y: number | null;
  type_local: string;
  scope: "cluster" | "commune";
  primaryColor: string;
  communeYears?: Array<{ annee: number; prix_m2_median: number; nb_ventes: number }> | null;
  communeVariationPctTotal?: number | null;
}) {
  // Combine min/max de cluster ET commune pour que les 2 séries soient
  // visuellement comparables sur la même échelle Y.
  const clusterPrices = years.map((y) => y.prix_m2_median);
  const communePrices = (communeYears ?? []).map((y) => y.prix_m2_median);
  const allPrices = [...clusterPrices, ...communePrices];
  const maxPrice = Math.max(...allPrices);
  const minPrice = Math.min(...allPrices);
  // Échelle visuelle : on amplifie la différence en partant de minPrice * 0.95
  // (sinon des prix qui varient peu donnent toutes les barres identiques).
  const scaleMin = minPrice * 0.95;
  const scaleMax = maxPrice * 1.02;
  const range = Math.max(scaleMax - scaleMin, 1);
  const chartHeight = 80; // px

  const tag = (pct: number | null): string => {
    if (pct == null) return "—";
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct} %`;
  };

  // Index commune par année pour récup rapide
  const communeByYear = new Map<number, number>();
  for (const cy of communeYears ?? []) {
    communeByYear.set(cy.annee, cy.prix_m2_median);
  }

  const hasCommune = (communeYears ?? []).length >= 2;

  return (
    <View style={{ marginTop: 8 }}>
      {/* Légende */}
      {hasCommune && (
        <View
          style={{
            flexDirection: "row",
            justifyContent: "center",
            gap: 16,
            marginBottom: 6,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View
              style={{
                width: 10,
                height: 6,
                backgroundColor: primaryColor,
                borderRadius: 1,
              }}
            />
            <Text style={{ fontSize: 8, color: "#475569" }}>
              Micro-marché (HDBSCAN)
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View
              style={{
                width: 10,
                height: 2,
                backgroundColor: "#64748b",
              }}
            />
            <Text style={{ fontSize: 8, color: "#475569" }}>
              Commune entière
            </Text>
          </View>
        </View>
      )}

      {/* Bars row */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 6,
          height: chartHeight + 28, // place pour la valeur au-dessus
          paddingBottom: 4,
        }}
      >
        {years.map((y) => {
          const ratio = (y.prix_m2_median - scaleMin) / range;
          const barHeight = Math.max(8, Math.round(ratio * chartHeight));
          const communePrice = communeByYear.get(y.annee);
          const communeRatio =
            communePrice != null ? (communePrice - scaleMin) / range : null;
          const communeOffsetFromBottom =
            communeRatio != null ? Math.round(communeRatio * chartHeight) : null;
          return (
            <View key={y.annee} style={{ flex: 1, alignItems: "center" }}>
              <Text
                style={{
                  fontSize: 8,
                  color: "#0f172a",
                  fontWeight: 700,
                  marginBottom: 3,
                }}
              >
                {Math.round(y.prix_m2_median / 100) / 10}k
              </Text>
              {/* Container empilé : barre cluster + marqueur commune positionné */}
              <View
                style={{
                  width: "70%",
                  height: chartHeight,
                  position: "relative",
                  justifyContent: "flex-end",
                }}
              >
                {/* Barre cluster (micro-marché) */}
                <View
                  style={{
                    width: "100%",
                    height: barHeight,
                    backgroundColor: primaryColor,
                    borderTopLeftRadius: 2,
                    borderTopRightRadius: 2,
                  }}
                />
                {/* Marqueur commune (trait gris transversal) */}
                {communeOffsetFromBottom != null && (
                  <View
                    style={{
                      position: "absolute",
                      left: -3,
                      right: -3,
                      bottom: communeOffsetFromBottom - 1,
                      height: 2,
                      backgroundColor: "#64748b",
                    }}
                  />
                )}
              </View>
            </View>
          );
        })}
      </View>

      {/* Year labels */}
      <View
        style={{
          flexDirection: "row",
          gap: 6,
          borderTopColor: "#cbd5e1",
          borderTopWidth: 1,
          paddingTop: 3,
        }}
      >
        {years.map((y) => (
          <Text
            key={y.annee}
            style={{
              flex: 1,
              fontSize: 8,
              color: "#64748b",
              textAlign: "center",
            }}
          >
            {y.annee}
          </Text>
        ))}
      </View>

      {/* Caption : variation cumulée + comparaison commune si dispo */}
      <View
        style={{
          marginTop: 8,
          padding: 8,
          backgroundColor: "#f1f5f9",
          borderRadius: 4,
        }}
      >
        <Text style={{ fontSize: 9, color: "#0f172a" }}>
          {type_local} {scope === "cluster" ? "dans le micro-marché" : "sur la commune"} :{" "}
          <Text style={{ fontWeight: 700, color: primaryColor }}>
            {fmt(years[years.length - 1].prix_m2_median)} €/m²
          </Text>{" "}
          en {years[years.length - 1].annee}
          {variation_pct_5y != null && (
            <>
              {" "}·{" "}
              <Text
                style={{
                  fontWeight: 700,
                  color: variation_pct_5y >= 0 ? "#15803d" : "#b91c1c",
                }}
              >
                {tag(variation_pct_5y)} sur 5 ans
              </Text>
            </>
          )}
          {variation_pct_total != null && variation_pct_5y !== variation_pct_total && (
            <>
              {" "}·{" "}
              <Text
                style={{
                  fontWeight: 700,
                  color: variation_pct_total >= 0 ? "#15803d" : "#b91c1c",
                }}
              >
                {tag(variation_pct_total)} sur la période complète
              </Text>
            </>
          )}
        </Text>

        {/* Comparaison commune si scope = cluster et commune dispo */}
        {hasCommune && scope === "cluster" && communeVariationPctTotal != null && (
          <Text style={{ fontSize: 9, color: "#475569", marginTop: 4 }}>
            Commune entière sur la même période :{" "}
            <Text style={{ fontWeight: 700, color: "#475569" }}>
              {tag(communeVariationPctTotal)}
            </Text>
            {variation_pct_total != null && (
              <>
                {" "}·{" "}
                {variation_pct_total > communeVariationPctTotal ? (
                  <Text style={{ fontWeight: 700, color: "#15803d" }}>
                    le micro-marché sur-performe la moyenne communale de{" "}
                    {(variation_pct_total - communeVariationPctTotal).toFixed(0)} pts
                  </Text>
                ) : variation_pct_total < communeVariationPctTotal ? (
                  <Text style={{ fontWeight: 700, color: "#475569" }}>
                    le micro-marché sous-performe la moyenne communale de{" "}
                    {(communeVariationPctTotal - variation_pct_total).toFixed(0)} pts
                  </Text>
                ) : (
                  <Text style={{ color: "#475569" }}>
                    aligné sur la moyenne communale
                  </Text>
                )}
              </>
            )}
          </Text>
        )}

        {(() => {
          // Affichage du VRAI nombre de ventes utilisées (somme sur la période)
          // Plutôt que le seuil minimum qui faisait croire à un échantillon
          // ridicule (Drancy = 72 k hab, plusieurs centaines de ventes/an).
          const totalCluster = years.reduce((acc, y) => acc + (y.nb_ventes ?? 0), 0);
          const totalCommune = (communeYears ?? []).reduce(
            (acc, y) => acc + (y.nb_ventes ?? 0),
            0,
          );
          const minSeuil = scope === "cluster" ? 5 : 10;
          return (
            <Text style={{ fontSize: 8, color: "#94a3b8", marginTop: 3 }}>
              Médiane DVF par année · données notariées officielles ·
              {scope === "cluster"
                ? ` ${totalCluster} ventes agrégées dans le micro-marché HDBSCAN`
                : ` ${totalCluster} ventes agrégées sur la commune`}
              {hasCommune && totalCommune > 0
                ? ` · ${totalCommune} ventes référence commune`
                : ""}
              {" · années retenues : au moins "}
              {minSeuil} ventes
            </Text>
          );
        })()}
      </View>
    </View>
  );
}

/**
 * Formatte la citation des points d'intérêts notables pour la phrase
 * argumentaire. Renvoie par exemple :
 *   1 POI : « comme la Place des Vosges »
 *   2 POI : « comme la Place des Vosges et le Centre Pompidou »
 *   0 POI : "" (rien)
 *
 * On garde tel quel le nom OSM (déjà bien capitalisé) et on insère "le/la/l'"
 * intelligemment si on détecte un genre courant. Sinon on cite sans article.
 */
function formatPoisNarrative(
  pois: Array<{ nom: string }> | undefined,
): string {
  if (!pois || pois.length === 0) return "";

  const articulate = (nom: string): string => {
    // Si le nom commence déjà par un article ("La Sorbonne", "Le Louvre"), on garde.
    if (/^(La |Le |L'|Les |Un |Une )/.test(nom)) return nom;
    // Heuristique simple : "Place", "Cathédrale", "Tour", "Île" → féminin
    const fem = ["place", "cathédrale", "cathedrale", "tour", "église", "eglise", "fontaine", "porte", "rue", "avenue", "île", "ile", "basilique", "colonne", "statue"];
    const masc = ["jardin", "parc", "musée", "musee", "pont", "palais", "château", "chateau", "centre", "théâtre", "theatre", "marché", "marche", "monument", "memorial", "obélisque", "obelisque", "panthéon", "pantheon"];
    const firstWord = nom.split(/\s+/)[0]?.toLowerCase() ?? "";
    // Voyelle : élision "l'"
    if (/^[aeiouhéèêâî]/.test(firstWord)) return `l'${nom}`;
    if (fem.includes(firstWord)) return `la ${nom}`;
    if (masc.includes(firstWord)) return `le ${nom}`;
    return nom; // pas d'article si on ne sait pas
  };

  if (pois.length === 1) return ` comme ${articulate(pois[0].nom)}`;
  return ` comme ${articulate(pois[0].nom)} et ${articulate(pois[1].nom)}`;
}

/**
 * Construit la chaîne " via Métro 5 ou RER E" à partir des alternatives Navitia.
 *
 * Stratégie :
 *   - On garde les alternatives dont la durée est ≤ best_duration + 5 min
 *     (sinon une alternative 25% plus lente parasite la phrase)
 *   - Pour chaque alternative, on prend la 1ère ligne de transit (ligne au
 *     départ de l'adresse — la plus signifiante pour le futur acheteur)
 *   - On déduplique et on formate avec virgules + "ou" final
 *   - Si 0 ligne, on ne dit rien (juste la durée)
 */
function formatLinesNarrative(
  alternatives: Array<{ duration_min: number; primary_lines: string[] }>,
  fallback_lines: string[],
): string {
  if (!alternatives || alternatives.length === 0) {
    // Pas d'alternative → on tente quand même les lignes principales
    if (fallback_lines.length === 0) return "";
    return ` via ${fallback_lines[0]}`;
  }

  const best = alternatives[0].duration_min;
  const close = alternatives.filter((a) => a.duration_min <= best + 5);

  // Première ligne de chaque alternative proche, dédupliquée
  const lines: string[] = [];
  for (const alt of close) {
    if (alt.primary_lines.length === 0) continue;
    const first = alt.primary_lines[0];
    if (!lines.includes(first)) lines.push(first);
  }
  if (lines.length === 0) return "";

  if (lines.length === 1) return ` via ${lines[0]}`;
  if (lines.length === 2) return ` via ${lines[0]} ou ${lines[1]}`;
  // 3+ : on liste les 3 premiers avec virgules
  const head = lines.slice(0, lines.length - 1).join(", ");
  const tail = lines[lines.length - 1];
  return ` via ${head} ou ${tail}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// Composant
// ──────────────────────────────────────────────────────────────────────────────

export function CabinetLeadReportPDF({ data }: { data: CabinetLeadReportData }) {
  const styles = buildStyles(data.primary_color);
  const a = data.wizard_answers;

  const surface = data.surface ?? 0;
  const total = data.prix_total_median;
  const m2 = data.prix_m2_median;
  const lo = data.prix_m2_p10 != null && surface > 0 ? Math.round(data.prix_m2_p10 * surface) : null;
  const hi = data.prix_m2_p90 != null && surface > 0 ? Math.round(data.prix_m2_p90 * surface) : null;

  // Catégorisation du contexte pour adapter le rendu et la note d'expert
  const isTerrain = data.type_bien === "Terrain";
  const hasEstimation = total != null && m2 != null;

  return (
    <Document
      title={`Estimation ${data.address} — ${data.cabinet_name}`}
      author={data.cabinet_name}
      subject="Estimation immobilière indicative"
      creator="DATAMERRY"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.cabinetName}>{data.cabinet_name.toUpperCase()}</Text>
            <Text style={{ fontSize: 8, color: "#64748b", marginTop: 2 }}>
              Estimation immobilière indicative
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerDate}>{fmtDate(data.generated_at)}</Text>
            <Text style={{ fontSize: 8, color: "#64748b" }}>Réf. {data.visitor_email.slice(0, 12)}…</Text>
          </View>
        </View>

        {/* Titre */}
        <Text style={styles.title}>
          {hasEstimation
            ? `Estimation pour ${data.address}`
            : isTerrain
              ? `Étude de terrain — ${data.address}`
              : `Demande d'analyse — ${data.address}`}
        </Text>
        <Text style={styles.subtitle}>
          {data.type_bien} {surface ? `· ${fmt(surface)} m²` : ""} · Préparé pour {data.visitor_name}
        </Text>

        {/* Card : estimation chiffrée OU bloc "analyse spécifique requise" */}
        {hasEstimation ? (
          <View style={styles.estimationCard}>
            <Text style={styles.estimationLabel}>Estimation marché</Text>
            <Text style={styles.estimationValue}>{fmt(total)} €</Text>
            <Text style={styles.estimationSub}>
              {fmt(m2)} €/m²
              {data.nb_ventes ? ` · ${data.nb_ventes} ventes notariées DVF dans la zone` : ""}
            </Text>

            {lo !== null && hi !== null && (
              <View style={styles.rangeRow}>
                <View style={styles.rangeStat}>
                  <Text style={styles.rangeStatLabel}>Plancher</Text>
                  <Text style={styles.rangeStatValue}>{fmt(lo)} €</Text>
                </View>
                <View style={styles.rangeStat}>
                  <Text style={styles.rangeStatLabel}>Médiane</Text>
                  <Text style={styles.rangeStatValue}>{fmt(total)} €</Text>
                </View>
                <View style={styles.rangeStat}>
                  <Text style={styles.rangeStatLabel}>Plafond</Text>
                  <Text style={styles.rangeStatValue}>{fmt(hi)} €</Text>
                </View>
              </View>
            )}

            {/* Fix #1 — Mention ajustement bucket de surface.
                Affichée quand le voisinage est dominé par un bucket différent
                du bien estimé. Transparence méthodo + crédibilise. */}
            {Boolean(data.surface_adjustment) && data.surface_adjustment && (
              <Text
                style={{
                  fontSize: 8,
                  color: "#64748b",
                  marginTop: 8,
                  paddingTop: 6,
                  borderTopColor: "#e2e8f0",
                  borderTopWidth: 1,
                  width: "100%",
                  textAlign: "center",
                }}
              >
                Ajustement surface :{" "}
                <Text
                  style={{
                    fontWeight: 700,
                    color:
                      data.surface_adjustment.pct_ajustement >= 0
                        ? "#15803d"
                        : "#b91c1c",
                  }}
                >
                  {data.surface_adjustment.pct_ajustement >= 0 ? "+" : ""}
                  {data.surface_adjustment.pct_ajustement} %
                </Text>{" "}
                (voisinage majoritairement {data.surface_adjustment.bucket_dominant},
                bien estimé {data.surface_adjustment.bucket_cible}) — ratio
                médian commune sur {data.surface_adjustment.nb_ventes_voisinage} ventes 5 ans
              </Text>
            )}

            {/* Fix #2 — Mention plafond marché commune par bucket surface.
                Affichée quand le P90 a été cappé OU quand la donnée commune
                est fiable (sert d'argument vendeur transparent). */}
            {Boolean(data.commune_ceiling) && data.commune_ceiling && data.commune_ceiling.prix_total_p95 != null && (
              <Text
                style={{
                  fontSize: 8,
                  color: "#64748b",
                  marginTop: 8,
                  paddingTop: 6,
                  borderTopColor: "#e2e8f0",
                  borderTopWidth: 1,
                  width: "100%",
                  textAlign: "center",
                }}
              >
                {data.capped_to_commune_ceiling ? "⚠ " : ""}
                Plafond marché {data.commune_ceiling.bucket === "T5+" ? "≥ 90 m²" :
                  data.commune_ceiling.bucket === "T4" ? "70-89 m²" :
                  data.commune_ceiling.bucket === "T3" ? "50-69 m²" :
                  data.commune_ceiling.bucket === "T2" ? "30-49 m²" : "< 30 m²"} :{" "}
                <Text style={{ fontWeight: 700, color: "#475569" }}>
                  {fmt(data.commune_ceiling.prix_total_p95)} €
                </Text>{" "}
                (P95 commune · {data.commune_ceiling.nb_ventes_bucket} ventes 5 ans)
                {data.capped_to_commune_ceiling
                  ? " — le plafond ci-dessus a été réajusté au marché local."
                  : ""}
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.estimationCard}>
            <Text style={styles.estimationLabel}>
              {isTerrain ? "Analyse spécifique requise" : "Estimation à personnaliser"}
            </Text>
            <Text style={{ fontSize: 13, color: "#475569", textAlign: "center", marginTop: 6, lineHeight: 1.5 }}>
              {isTerrain
                ? "Un terrain ne se valorise pas en €/m² des transactions DVF mais via la charge foncière (bilan promoteur). Ce calcul nécessite une étude dédiée."
                : "Ce type de bien et/ou ce micro-marché nécessite une analyse personnalisée par un expert."}
            </Text>
          </View>
        )}

        {/* Récap caractéristiques.
            Note TS : on entoure les checks de unknown par Boolean(...) car
            `{a.xxx && (...)}` retournerait `unknown | JSX` que ReactNode
            refuse en strict mode. Boolean() force la conversion. */}
        <Text style={styles.sectionTitle}>Caractéristiques renseignées</Text>
        <View style={styles.detailGrid}>
          {Boolean(a.intent) && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Projet</Text>
              <Text style={styles.detailValue}>{intentLabel[String(a.intent)] ?? String(a.intent)}</Text>
            </View>
          )}
          <View style={styles.detailItem}>
            <Text style={styles.detailLabel}>Type</Text>
            <Text style={styles.detailValue}>{data.type_bien}</Text>
          </View>
          {Boolean(a.pieces) && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Pièces</Text>
              <Text style={styles.detailValue}>T{String(a.pieces)}</Text>
            </View>
          )}
          {Boolean(a.etage) && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Étage</Text>
              <Text style={styles.detailValue}>{String(a.etage)}</Text>
            </View>
          )}
          {Boolean(a.annee_construction) && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Année</Text>
              <Text style={styles.detailValue}>{String(a.annee_construction)}</Text>
            </View>
          )}
          {Boolean(a.dpe) && a.dpe !== "inconnu" && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>DPE</Text>
              <Text style={styles.detailValue}>Classe {String(a.dpe).toUpperCase()}</Text>
            </View>
          )}
          {Boolean(a.etat) && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>État général</Text>
              <Text style={styles.detailValue}>{etatLabel[String(a.etat)] ?? String(a.etat)}</Text>
            </View>
          )}
          {Boolean(a.usage || a.usage_pro || a.usage_terrain) && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Destination</Text>
              <Text style={styles.detailValue}>{pickUsage(a)}</Text>
            </View>
          )}
          {Array.isArray(a.exterieurs) && a.exterieurs.length > 0 && !a.exterieurs.includes("aucun") && (
            <View style={styles.detailItem}>
              <Text style={styles.detailLabel}>Extérieurs</Text>
              <Text style={styles.detailValue}>{(a.exterieurs as string[]).join(", ")}</Text>
            </View>
          )}
        </View>

        {/* Note expert — adaptée selon le type de bien */}
        <View style={styles.expertNote}>
          <Text style={styles.expertNoteTitle}>
            {isTerrain
              ? "Note importante — méthodologie spécifique au terrain"
              : "Note importante — ce rapport est indicatif"}
          </Text>
          <Text>
            {isTerrain ? (
              <>
                L&apos;estimation d&apos;un terrain ne se réalise pas sur la base des
                transactions DVF (qui concernent du bâti) mais via un{" "}
                <Text style={{ fontWeight: 700 }}>bilan promoteur</Text> /{" "}
                <Text style={{ fontWeight: 700 }}>charge foncière</Text>. Cela implique
                de consulter le PLU/PLUi de la commune (constructibilité, COS/CES,
                servitudes), d&apos;estimer les coûts construction locaux, d&apos;identifier
                les promoteurs potentiels et de modéliser leur marge cible.
                {"\n\n"}
                Cette analyse demande une étude dédiée — un expert {data.cabinet_name}{" "}
                vous recontacte sous 24h ouvrées au {data.visitor_email} pour discuter
                de votre projet et des modalités d&apos;une telle expertise.
              </>
            ) : hasEstimation ? (
              <>
                Cette estimation est calculée automatiquement à partir des ventes notariées
                DVF du micro-marché et n&apos;intègre PAS les spécificités fines de votre
                bien (état réel, étage exact, exposition, vue, charges, copropriété,
                prestations, vétusté…).
                {"\n\n"}
                Pour une estimation précise et exploitable en transaction, un expert{" "}
                {data.cabinet_name} vient visiter votre bien gratuitement et vous remet un
                avis de valeur professionnel. Vous serez recontacté(e) sous 24h ouvrées au{" "}
                {data.visitor_email}.
              </>
            ) : (
              <>
                Ce type de bien ou ce micro-marché ne dispose pas de comparables suffisants
                pour générer une estimation automatique fiable.
                {"\n\n"}
                Un expert {data.cabinet_name} vous recontacte sous 24h ouvrées au{" "}
                {data.visitor_email} pour réaliser une analyse personnalisée tenant compte
                des spécificités de votre bien.
              </>
            )}
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          {Boolean(data.cabinet_legal) && (
            <Text style={{ marginBottom: 3 }}>{data.cabinet_legal}</Text>
          )}
          <Text>
            Estimation propulsée par <Text style={styles.footerBold}>DATAMERRY®</Text>
            {"  ·  "}
            Sources : DVF (notaires), OLAP, ANIL, ADEME, INSEE, OSM
            {"  ·  "}
            Méthodologie : modèle AVM (Charte Expertise 6e éd. 2025, ch. 6)
          </Text>
          <Text style={{ marginTop: 3 }}>
            Ce document a été généré automatiquement. Il ne se substitue pas à un avis d&apos;expert immobilier formel.
          </Text>
        </View>
      </Page>

      {/* ─────────────────────────────────────────────────────────────────
          Page 2 — Contexte localisation (données opensource)
          Affichée seulement si on a au moins un dataset enrichi disponible.
          ───────────────────────────────────────────────────────────────── */}
      {Boolean(data.paris_distance || data.transports || data.ecoles || data.services || data.insee) && (
        <Page size="A4" style={styles.page}>
          {/* Mini header rappel */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.cabinetName}>{data.cabinet_name.toUpperCase()}</Text>
              <Text style={{ fontSize: 8, color: "#64748b", marginTop: 2 }}>
                Contexte localisation
              </Text>
            </View>
            <View style={styles.headerRight}>
              <Text style={styles.headerDate}>{fmtDate(data.generated_at)}</Text>
              <Text style={{ fontSize: 8, color: "#64748b" }}>{data.address}</Text>
            </View>
          </View>

          <Text style={styles.title}>Le quartier en chiffres</Text>
          <Text style={styles.subtitle}>
            Données opensource (DVF notaires, OSM, INSEE Filosofi, Annuaire Éducation Nationale, data.education.gouv.fr)
          </Text>

          {/* ── Section "Quartier" — UNIQUEMENT pour adresses Paris intra-muros ─ */}
          {/* Pour Paris, "Proximité Paris" n'a aucun sens (on y est). On affiche
              à la place une phrase qualitative cabinet "proche toutes commodités" +
              les 1-2 points d'intérêts notables les plus proches (issus OSM avec
              filtre wikipedia=*). Argument vente direct pour Diara. */}
          {Boolean(data.paris_distance?.is_paris) && (
            <View
              style={{
                marginTop: 8,
                marginBottom: 12,
                padding: 12,
                backgroundColor: data.primary_color + "10",
                borderColor: data.primary_color,
                borderWidth: 1,
                borderRadius: 8,
              }}
            >
              <Text style={{ fontSize: 11, color: "#0f172a", lineHeight: 1.5 }}>
                🗼 Adresse{" "}
                <Text style={{ fontWeight: 700, color: data.primary_color }}>
                  Paris intra-muros
                </Text>{" "}
                — quartier dense, proche de toutes commodités
                {data.points_interet && data.points_interet.top.length > 0 ? (
                  <>
                    {" "}et de points d&apos;intérêts notables
                    <Text style={{ fontWeight: 700 }}>
                      {formatPoisNarrative(data.points_interet.top)}
                    </Text>
                  </>
                ) : (
                  <> et points d&apos;intérêts notables</>
                )}
                . Desserte transports en commun excellente par défaut.
              </Text>
            </View>
          )}

          {/* ── Section 1 — Proximité Paris (UNIQUEMENT banlieue / province) ── */}
          {!data.paris_distance?.is_paris && Boolean(data.paris_distance) && data.paris_distance && (
            <>
              <Text style={styles.sectionTitle}>Proximité Paris</Text>
              <View style={styles.detailGrid}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Distance Notre-Dame</Text>
                  <Text style={styles.detailValue}>
                    {fmt(data.paris_distance.crow_distance_km)} km à vol d&apos;oiseau
                  </Text>
                </View>
                {Boolean(data.paris_distance.estimated_minutes_to_paris) && (
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>
                      {data.paris_distance.minutes_to_paris_from_official_api
                        ? "Temps trajet IDFM (heure de pointe)"
                        : "Temps trajet estimé"}
                    </Text>
                    <Text style={styles.detailValue}>
                      {data.paris_distance.minutes_to_paris_from_official_api ? "" : "~ "}
                      {data.paris_distance.estimated_minutes_to_paris} min en transports
                    </Text>
                  </View>
                )}
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Localisation</Text>
                  <Text style={styles.detailValue}>
                    {data.paris_distance.is_paris
                      ? "Paris intra-muros"
                      : data.paris_distance.is_ile_de_france
                        ? "Île-de-France (banlieue)"
                        : "Hors Île-de-France"}
                  </Text>
                </View>
                {Boolean(data.paris_distance.nearest_major_station) && data.paris_distance.nearest_major_station && (
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Première gare</Text>
                    <Text style={styles.detailValue}>
                      {data.paris_distance.nearest_major_station.nom}
                      {data.paris_distance.nearest_major_station.ligne
                        ? ` (${data.paris_distance.nearest_major_station.ligne})`
                        : ""}
                      {" · "}
                      {data.paris_distance.nearest_major_station.walk_minutes} min à pied
                    </Text>
                  </View>
                )}
                {data.points_interet && data.points_interet.top.length > 0 && (
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Points d&apos;intérêts notables</Text>
                    <Text style={styles.detailValue}>
                      {data.points_interet.top
                        .map((p) => `${p.nom} (${p.distance_m < 1000 ? `${p.distance_m} m` : `${(p.distance_m / 1000).toFixed(1)} km`})`)
                        .join(" · ")}
                    </Text>
                  </View>
                )}
              </View>

              {/* Détail itinéraire porte-à-porte (IDFM PRIM Navitia) */}
              {Boolean(data.paris_distance.journey_to_paris) && data.paris_distance.journey_to_paris && (
                <>
                  {/* Phrase naturelle — la pépite Diara peut copier-coller dans son argumentaire */}
                  <View
                    style={{
                      marginTop: 10,
                      padding: 12,
                      backgroundColor: data.primary_color + "10",
                      borderColor: data.primary_color,
                      borderWidth: 1,
                      borderRadius: 8,
                    }}
                  >
                    <Text style={{ fontSize: 11, color: "#0f172a", lineHeight: 1.5 }}>
                      🗼 Cet appartement est à{" "}
                      <Text style={{ fontWeight: 700, color: data.primary_color }}>
                        {data.paris_distance.journey_to_paris.total_duration_min} minutes
                      </Text>{" "}
                      porte-à-porte de <Text style={{ fontWeight: 700 }}>Paris {data.paris_distance.journey_to_paris.destination}</Text>
                      {formatLinesNarrative(
                        data.paris_distance.journey_to_paris.alternatives,
                        data.paris_distance.journey_to_paris.primary_lines,
                      )}
                      .
                    </Text>
                  </View>

                </>
              )}
            </>
          )}

          {/* ── Section 2 — Transports proches ───────────────────────── */}
          {/* En intra-muros Paris (dept 75), un "score accessibilité" est non-
              discriminant (tout le monde a métro à 5 min). On masque le score
              chiffré et on affiche juste la liste des arrêts. En banlieue le
              score garde sa valeur informative. */}
          {Boolean(data.transports) && data.transports && (
            <>
              {(() => {
                // data.transports est garanti non-null ici (condition parente
                // {Boolean(data.transports) && data.transports && ...}) mais
                // l'IIFE casse le narrowing TS, donc on bind localement.
                const tr = data.transports;
                if (!tr) return null;
                const r = tr.radius_m ?? 800;
                const rLabel =
                  r < 1000 ? `${r} m` : `${(r / 1000).toFixed(1)} km`;
                return (
                  <>
                    <Text style={styles.sectionTitle}>
                      {data.paris_distance?.is_paris
                        ? `Métros, RER & tramway à ${rLabel}`
                        : "Transports à proximité"}
                    </Text>
                    {data.paris_distance?.is_paris ? (
                      <Text
                        style={{ fontSize: 10, color: "#475569", marginBottom: 6 }}
                      >
                        {tr.count} arrêts dans un rayon de {rLabel}.
                      </Text>
                    ) : null}
                  </>
                );
              })()}
              {!data.paris_distance?.is_paris && data.transports.score_accessibilite > 0 && (
                <View style={styles.detailGrid}>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Score accessibilité</Text>
                    <Text style={styles.detailValue}>
                      {data.transports.score_accessibilite}/100
                      {" · "}
                      {data.transports.count} arrêts
                      {data.transports.radius_m
                        ? data.transports.radius_m < 1000
                          ? ` dans ${data.transports.radius_m} m`
                          : ` dans ${(data.transports.radius_m / 1000).toFixed(1)} km`
                        : ""}
                    </Text>
                  </View>
                  {Object.entries(data.transports.par_type).slice(0, 3).map(([type, count]) => (
                    <View key={type} style={styles.detailItem}>
                      <Text style={styles.detailLabel}>{type}</Text>
                      <Text style={styles.detailValue}>{count}</Text>
                    </View>
                  ))}
                </View>
              )}
              {data.transports.top_stops.length > 0 && (
                <View style={{ marginTop: 6 }}>
                  <Text style={{ fontSize: 9, color: "#64748b", marginBottom: 4 }}>
                    Les 6 plus proches :
                  </Text>
                  {data.transports.top_stops.map((stop, i) => (
                    <Text key={i} style={{ fontSize: 10, color: "#0f172a", marginBottom: 2 }}>
                      • {stop.nom} ({stop.type}
                      {stop.ligne ? ` · ${stop.ligne}` : ""}) — {stop.walk_minutes} min à pied
                    </Text>
                  ))}
                </View>
              )}
            </>
          )}

          {/* ── Section Gares à proximité (Fix bonus) ─────────────────────
              Affichée si une gare train/RER/métro/tramway est à < 1500 m
              ET qu'elle n'est PAS déjà dans top_stops (sinon redondant).
              Capture le cas Drancy : gare à 900 m hors rayon 800 m std. */}
          {Boolean(data.gares_proches) && data.gares_proches && data.gares_proches.length > 0 && (() => {
            // Filtre les gares qui ne sont PAS déjà dans top_stops
            const topStopNames = new Set(
              (data.transports?.top_stops ?? []).map((s) => s.nom.toLowerCase()),
            );
            const exclusives = data.gares_proches.filter(
              (g) => !topStopNames.has(g.nom.toLowerCase()),
            );
            if (exclusives.length === 0) return null;
            return (
              <>
                <Text style={styles.sectionTitle}>Gares ferrées à proximité</Text>
                <Text style={{ fontSize: 9, color: "#64748b", marginBottom: 4 }}>
                  Train · RER · métro · tramway
                  {(() => {
                    const maxDist = Math.max(...exclusives.map((g) => g.distance_m));
                    if (maxDist < 1000) return " · à pied (≤ 1 km)";
                    if (maxDist < 1500) return " · à pied (≤ 1,5 km)";
                    if (maxDist < 2000) return " · marche modérée (≤ 2 km)";
                    return " · à ≤ 2,5 km";
                  })()}
                </Text>
                <View>
                  {exclusives.map((g, i) => (
                    <Text key={i} style={{ fontSize: 10, color: "#0f172a", marginBottom: 2 }}>
                      • {g.nom} ({g.type}
                      {g.ligne ? ` · ${g.ligne}` : ""}) — {g.distance_m} m
                      {g.walk_minutes ? ` · ${g.walk_minutes} min à pied` : ""}
                    </Text>
                  ))}
                </View>
              </>
            );
          })()}

          {/* ── Section Équipements sportifs (Fix #3, sport seulement) ─────
              Sport / loisirs (stades, piscines, complexes sportifs) via
              Overpass. Le SCOLAIRE est traité dans la section "Écoles" via
              l'Annuaire Éducation Nationale (noms officiels précis).
              Le LYCÉE notable est traité dans sa section dédiée. */}
          {Boolean(data.proximite_locale) &&
            data.proximite_locale &&
            data.proximite_locale.sport.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>
                  Sport &amp; loisirs à proximité
                </Text>
                <View style={{ marginBottom: 4 }}>
                  {data.proximite_locale.sport.map((eq, i) => (
                    <Text key={i} style={{ fontSize: 10, color: "#0f172a", marginBottom: 2 }}>
                      • {eq.nom}
                      {" — "}
                      {eq.distance_m < 1000
                        ? `${eq.distance_m} m`
                        : `${(eq.distance_m / 1000).toFixed(1)} km`}
                    </Text>
                  ))}
                </View>
              </>
            )}

          {/* ── Section Lycées + Taux de réussite Bac ────────────────────
              FILTRE ÉDITORIAL VENDEUR (v3 — calibré métier) :
                - Seuil absolu de respectabilité : taux_reussite_general ≥ 80 %
                  (en-dessous on cache, ça ne valorise pas)
                - Si taux ≥ moyenne académique : on cite avec mention
                  "+X pts vs académie" en vert (argument fort)
                - Si taux ≥ 80 % MAIS < moyenne académique : on cite
                  sans mention "vs académie" (on évite la comparaison
                  qui dévaloriserait, mais on garde le lycée car 80%+
                  reste un argument positif en soi)
                - Tri par taux ABSOLU décroissant (meilleur en haut)
                - Max 2 lycées affichés
                - Section masquée si aucun lycée n'atteint 80 %
              Source : data.education.gouv.fr IVAL + DEPP juillet 2024. */}
          {(() => {
            // Seuil 80 % était trop strict pour les lycées de banlieue (ZEP)
            // → on baisse à 75 % (= moyenne nationale brute, hors mention).
            // Le fallback "Lycées du secteur" reste actif si aucun ne qualifie.
            const SEUIL_ABSOLU_RESPECTABILITE = 75; // %
            const lyceesEnrichis = (data.lycees_bac?.top ?? []).map((l) => {
              const moyAcad = getBacMoyenneDept(l.dept);
              const tauxG = l.taux_reussite_general;
              const tauxMention = l.taux_mention_general;
              const depassement_general =
                tauxG != null && moyAcad ? tauxG - moyAcad.taux_general : null;
              const depassement_mention =
                tauxMention != null && moyAcad ? tauxMention - moyAcad.taux_mention : null;
              return {
                ...l,
                moy_academie_general: moyAcad?.taux_general ?? null,
                moy_academie_mention: moyAcad?.taux_mention ?? null,
                depassement_general,
                depassement_mention,
              };
            });

            const lyceesQualifies = lyceesEnrichis
              .filter(
                (l) =>
                  l.taux_reussite_general != null &&
                  l.taux_reussite_general >= SEUIL_ABSOLU_RESPECTABILITE,
              )
              .sort((a, b) => {
                const ta = a.taux_reussite_general ?? 0;
                const tb = b.taux_reussite_general ?? 0;
                if (tb !== ta) return tb - ta;
                return a.distance_m - b.distance_m;
              })
              .slice(0, 2);

            // Fallback : si aucun lycée ≥ 80 %, on affiche quand même les 2
            // plus proches sans badge premium — juste l'information de l'école
            // du secteur. C'est l'argument de proximité même si la perf
            // académique n'est pas un highlight. Sans ce fallback la section
            // disparaît trop souvent (déontologie ≠ omission d'info utile).
            const showFallback = lyceesQualifies.length === 0 && lyceesEnrichis.length > 0;
            const lyceesFallback = showFallback
              ? [...lyceesEnrichis]
                  .sort((a, b) => a.distance_m - b.distance_m)
                  .slice(0, 2)
              : [];

            const lyceesAAfficher = lyceesQualifies.length > 0 ? lyceesQualifies : lyceesFallback;
            if (lyceesAAfficher.length === 0) return null;

            return (
              <>
                <Text style={styles.sectionTitle}>
                  {showFallback
                    ? "Lycées du secteur"
                    : "Lycées à proximité — taux de réussite Bac"}
                </Text>
                <Text style={{ fontSize: 9, color: "#64748b", marginBottom: 6 }}>
                  {showFallback
                    ? "Établissements de secteur les plus proches. Données IVAL/DEPP — pour information."
                    : "Lycées retenus : ≥ 80 % de réussite (Bac général). Comparaison académique session 2024 (DEPP) affichée si surperformance."}
                </Text>
                {lyceesAAfficher.map((l, i) => {
                  const statutLabel =
                    l.statut === "public"
                      ? "Public"
                      : l.statut === "prive"
                        ? "Privé sous contrat"
                        : "—";
                  // Médailles éditoriales (calibrées métier) :
                  //   OR     = taux_mention_general ≥ 60 %     (élite académique)
                  //               OR dépassement_mention ≥ +10 pts vs académie
                  //   ARGENT = taux_reussite_general ≥ 95 %    (très bon niveau)
                  //               OR dépassement_general ≥ +10 pts vs académie
                  // Cumulables : un lycée peut afficher OR + ARGENT.
                  const hasGold =
                    (l.taux_mention_general != null && l.taux_mention_general >= 60) ||
                    (l.depassement_mention != null && l.depassement_mention >= 10);
                  const hasSilver =
                    (l.taux_reussite_general != null && l.taux_reussite_general >= 95) ||
                    (l.depassement_general != null && l.depassement_general >= 10);
                  return (
                    <View
                      key={i}
                      style={{
                        marginBottom: 8,
                        padding: 8,
                        backgroundColor: "#f8fafc",
                        borderRadius: 6,
                        borderLeftWidth: 3,
                        borderLeftColor: data.primary_color,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                        <Text style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>
                          {l.nom}
                        </Text>
                        {hasGold && (
                          <View
                            style={{
                              paddingHorizontal: 5,
                              paddingVertical: 1,
                              backgroundColor: "#fbbf24",
                              borderRadius: 3,
                            }}
                          >
                            <Text style={{ fontSize: 8, color: "#78350f", fontWeight: 700 }}>
                              OR · MENTIONS
                            </Text>
                          </View>
                        )}
                        {hasSilver && (
                          <View
                            style={{
                              paddingHorizontal: 5,
                              paddingVertical: 1,
                              backgroundColor: "#cbd5e1",
                              borderRadius: 3,
                            }}
                          >
                            <Text style={{ fontSize: 8, color: "#334155", fontWeight: 700 }}>
                              ARGENT · RÉUSSITE
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>
                        {statutLabel} · {l.commune} · {l.distance_m} m à vol d&apos;oiseau
                        {l.annee_session ? ` · Session ${l.annee_session}` : ""}
                      </Text>
                      <View style={{ flexDirection: "row", gap: 16, marginTop: 5, flexWrap: "wrap" }}>
                        {/* Bac général — TOUJOURS affiché (≥ seuil 80% filtre déjà fait).
                            Badge "+X pts vs académie" affiché en vert UNIQUEMENT si positif. */}
                        {l.taux_reussite_general != null && (
                          <Text style={{ fontSize: 10 }}>
                            <Text style={{ color: "#64748b" }}>Bac général : </Text>
                            <Text style={{ fontWeight: 700, color: data.primary_color }}>
                              {l.taux_reussite_general} %
                            </Text>
                            {l.depassement_general != null && l.depassement_general > 0 && (
                              <Text style={{ color: "#15803d", fontSize: 9 }}>
                                {" "}(+{l.depassement_general.toFixed(1)} pts vs académie)
                              </Text>
                            )}
                          </Text>
                        )}
                        {/* Taux de mention — affiché si dispo ; mention "+X pts" si positif */}
                        {l.taux_mention_general != null && (
                          <Text style={{ fontSize: 10 }}>
                            <Text style={{ color: "#64748b" }}>Mention : </Text>
                            <Text style={{ fontWeight: 700, color: data.primary_color }}>
                              {l.taux_mention_general} %
                            </Text>
                            {l.depassement_mention != null && l.depassement_mention > 0 && (
                              <Text style={{ color: "#15803d", fontSize: 9 }}>
                                {" "}(+{l.depassement_mention.toFixed(1)} pts vs académie)
                              </Text>
                            )}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </>
            );
          })()}

          {/* ── Lycées professionnels (bac pro) ─────────────────────────
              Section parallèle au GT. Filtre éditorial : seuil 75% (bac pro
              a une moyenne nationale plus basse que GT, ~85% vs 91%).
              Médailles :
                OR     = taux_mention_pro ≥ 40 % (très bon niveau pour pro)
                ARGENT = taux_reussite_pro ≥ 90 % */}
          {data.lycees_pro && data.lycees_pro.top.length > 0 && (() => {
            const SEUIL = 75;
            const qualifies = data.lycees_pro.top
              .filter((l) => l.taux_reussite_pro != null && l.taux_reussite_pro >= SEUIL)
              .sort((a, b) => {
                const ta = a.taux_reussite_pro ?? 0;
                const tb = b.taux_reussite_pro ?? 0;
                if (tb !== ta) return tb - ta;
                return a.distance_m - b.distance_m;
              })
              .slice(0, 2);
            // Fallback : si aucun ≥ 75 %, on affiche quand même le plus proche
            const fallback = qualifies.length === 0
              ? [...data.lycees_pro.top].sort((a, b) => a.distance_m - b.distance_m).slice(0, 1)
              : [];
            const toShow = qualifies.length > 0 ? qualifies : fallback;
            if (toShow.length === 0) return null;
            return (
              <>
                <Text style={styles.sectionTitle}>
                  {qualifies.length > 0
                    ? "Lycées professionnels — taux de réussite Bac pro"
                    : "Lycée professionnel du secteur"}
                </Text>
                <Text style={{ fontSize: 9, color: "#64748b", marginBottom: 6 }}>
                  Source IVAL DEPP — session la plus récente publiée.
                </Text>
                {toShow.map((l, i) => {
                  const statutLabel =
                    l.statut === "public"
                      ? "Public"
                      : l.statut === "prive"
                        ? "Privé sous contrat"
                        : "—";
                  const hasGold =
                    l.taux_mention_pro != null && l.taux_mention_pro >= 40;
                  const hasSilver =
                    l.taux_reussite_pro != null && l.taux_reussite_pro >= 90;
                  return (
                    <View
                      key={i}
                      style={{
                        marginBottom: 8,
                        padding: 8,
                        backgroundColor: "#f8fafc",
                        borderRadius: 6,
                        borderLeftWidth: 3,
                        borderLeftColor: data.primary_color,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                        <Text style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>
                          {l.nom}
                        </Text>
                        {hasGold && (
                          <View
                            style={{
                              paddingHorizontal: 5,
                              paddingVertical: 1,
                              backgroundColor: "#fbbf24",
                              borderRadius: 3,
                            }}
                          >
                            <Text style={{ fontSize: 8, color: "#78350f", fontWeight: 700 }}>
                              OR · MENTIONS
                            </Text>
                          </View>
                        )}
                        {hasSilver && (
                          <View
                            style={{
                              paddingHorizontal: 5,
                              paddingVertical: 1,
                              backgroundColor: "#cbd5e1",
                              borderRadius: 3,
                            }}
                          >
                            <Text style={{ fontSize: 8, color: "#334155", fontWeight: 700 }}>
                              ARGENT · RÉUSSITE
                            </Text>
                          </View>
                        )}
                      </View>
                      <Text style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>
                        {statutLabel} · {l.commune} · {l.distance_m} m à vol d&apos;oiseau
                        {l.annee_session ? ` · Session ${l.annee_session}` : ""}
                      </Text>
                      <View style={{ flexDirection: "row", gap: 16, marginTop: 5, flexWrap: "wrap" }}>
                        {l.taux_reussite_pro != null && (
                          <Text style={{ fontSize: 10 }}>
                            <Text style={{ color: "#64748b" }}>Bac pro : </Text>
                            <Text style={{ fontWeight: 700, color: data.primary_color }}>
                              {l.taux_reussite_pro} %
                            </Text>
                          </Text>
                        )}
                        {l.taux_mention_pro != null && (
                          <Text style={{ fontSize: 10 }}>
                            <Text style={{ color: "#64748b" }}>Mention : </Text>
                            <Text style={{ fontWeight: 700, color: data.primary_color }}>
                              {l.taux_mention_pro} %
                            </Text>
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </>
            );
          })()}

          {/* ── Enseignement supérieur ───────────────────────────────────
              Universités, grandes écoles, IUT, IEP, instituts.
              Source : data.enseignementsup-recherche.gouv.fr (ESR).
              Badge PRESTIGE pour les noms reconnus (HEC, Polytechnique,
              Sciences Po, Sorbonne, Centrale, etc.).
              Affichage groupé par catégorie pour lisibilité. */}
          {data.etablissements_sup && data.etablissements_sup.top.length > 0 && (() => {
            const CATEGORIE_LABEL: Record<string, string> = {
              universite: "Universités",
              ecole_ingenieur: "Écoles d'ingénieurs",
              ecole_commerce: "Écoles de commerce",
              ecole_sante: "Médecine, pharmacie, santé",
              iep: "Sciences Po / IEP",
              institut: "Instituts",
              autre: "Autres",
            };
            // Groupe par catégorie en respectant l'ordre d'apparition (par
            // distance) — l'ordre d'itération Map préserve l'insertion.
            const groups = new Map<string, typeof data.etablissements_sup.top>();
            for (const e of data.etablissements_sup.top) {
              const arr = groups.get(e.categorie) ?? [];
              arr.push(e);
              groups.set(e.categorie, arr);
            }
            // Ordre éditorial : prestige avant tout, puis universités, ingé, commerce, santé, IEP, instituts
            const ORDER = ["ecole_ingenieur", "ecole_commerce", "ecole_sante", "iep", "universite", "institut", "autre"];
            const ordered = ORDER.filter((c) => groups.has(c));
            return (
              <>
                <Text style={styles.sectionTitle}>Enseignement supérieur à proximité</Text>
                <Text style={{ fontSize: 9, color: "#64748b", marginBottom: 6 }}>
                  Rayon 10 km · Source : Ministère de l&apos;Enseignement supérieur et de la Recherche.
                </Text>
                {ordered.map((cat) => (
                  <View key={cat} style={{ marginBottom: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: 700, color: "#0f172a", marginBottom: 2 }}>
                      {CATEGORIE_LABEL[cat] ?? cat}
                    </Text>
                    {(groups.get(cat) ?? []).map((e, i) => {
                      const statutLabel =
                        e.secteur === "public"
                          ? " (Public)"
                          : e.secteur === "prive"
                            ? " (Privé)"
                            : "";
                      const distLabel =
                        e.distance_m < 1000
                          ? `${e.distance_m} m`
                          : `${(e.distance_m / 1000).toFixed(1)} km`;
                      return (
                        <View
                          key={i}
                          style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 4, marginBottom: 1 }}
                        >
                          <Text style={{ fontSize: 10, color: "#0f172a" }}>
                            • {e.nom}
                            {statutLabel} — {distLabel}
                          </Text>
                          {e.prestige && (
                            <View
                              style={{
                                paddingHorizontal: 4,
                                paddingVertical: 1,
                                backgroundColor: data.primary_color,
                                borderRadius: 3,
                              }}
                            >
                              <Text style={{ fontSize: 7, color: "#ffffff", fontWeight: 700 }}>
                                PRESTIGE
                              </Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </>
            );
          })()}

          {/* ── Écoles paramédicales (FINESS) ────────────────────────────
              IFSI / IFAS / IFAP / kiné / ortho / sage-femme hors universitaire.
              Source : FINESS (data.gouv.fr ministère Santé). Complète l'ESR
              qui ne contient que les facultés rattachées à un CHU. */}
          {data.ecoles_sante && data.ecoles_sante.top.length > 0 && (() => {
            const TYPE_LABEL: Record<string, string> = {
              ifsi: "Instituts de Formation en Soins Infirmiers (IFSI)",
              ifas_ifap: "Aides-soignants / Auxiliaires de puériculture",
              kine_ortho: "Kinésithérapie / Orthophonie / Ergothérapie",
              sage_femme: "Sages-femmes / Maïeutique",
              autre_sante: "Autres écoles paramédicales",
            };
            const groups = new Map<string, typeof data.ecoles_sante.top>();
            for (const e of data.ecoles_sante.top) {
              const arr = groups.get(e.type) ?? [];
              arr.push(e);
              groups.set(e.type, arr);
            }
            const ORDER_TYPES = ["ifsi", "kine_ortho", "sage_femme", "ifas_ifap", "autre_sante"];
            const ordered = ORDER_TYPES.filter((t) => groups.has(t));
            return (
              <>
                <Text style={styles.sectionTitle}>Écoles paramédicales à proximité</Text>
                <Text style={{ fontSize: 9, color: "#64748b", marginBottom: 6 }}>
                  Source : FINESS (ministère de la Santé) — rayon 10 km.
                </Text>
                {ordered.map((t) => (
                  <View key={t} style={{ marginBottom: 4 }}>
                    <Text style={{ fontSize: 10, fontWeight: 700, color: "#0f172a", marginBottom: 2 }}>
                      {TYPE_LABEL[t] ?? t}
                    </Text>
                    {(groups.get(t) ?? []).map((e, i) => {
                      const distLabel =
                        e.distance_m < 1000
                          ? `${e.distance_m} m`
                          : `${(e.distance_m / 1000).toFixed(1)} km`;
                      return (
                        <Text key={i} style={{ fontSize: 10, color: "#0f172a", marginBottom: 1 }}>
                          • {e.nom}
                          {e.commune ? ` (${e.commune})` : ""} — {distLabel}
                        </Text>
                      );
                    })}
                  </View>
                ))}
              </>
            );
          })()}

          {/* ── CFA / Apprentissage (CAP, BEP) ──────────────────────────
              Extraction depuis Annuaire EN filtré sur les centres de formation
              d'apprentis. Argument vendeur pour familles avec adolescents
              orientés voie pro, ou investisseurs cherchant location étudiants. */}
          {data.cfa && data.cfa.top.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>CFA & Apprentissage à proximité</Text>
              <Text style={{ fontSize: 9, color: "#64748b", marginBottom: 6 }}>
                Centres de Formation d&apos;Apprentis (CAP, BEP, Bac pro alternance).
                Source : Annuaire de l&apos;Éducation Nationale.
              </Text>
              {data.cfa.top.map((c, i) => {
                const statutLabel =
                  c.statut === "public"
                    ? " (Public)"
                    : c.statut === "prive"
                      ? " (Privé)"
                      : "";
                const distLabel =
                  c.distance_m < 1000
                    ? `${c.distance_m} m`
                    : `${(c.distance_m / 1000).toFixed(1)} km`;
                return (
                  <Text key={i} style={{ fontSize: 10, color: "#0f172a", marginBottom: 2 }}>
                    • {c.nom}
                    {statutLabel} — {distLabel}
                    {c.walk_minutes ? ` · ${c.walk_minutes} min à pied` : ""}
                  </Text>
                );
              })}
            </>
          )}

          {/* ── Section 3 — Écoles à proximité ──────────────────────────
              Union de 2 sources : Annuaire EN (noms officiels) + dim_poi_local
              (seed manuel par commune, ex. École TIMBAUD-DEWERPE pour Drancy).
              On dédoublonne par nom et on garde max 4 entrées. */}
          {(() => {
            type EcoleEntry = {
              nom: string;
              statut?: "public" | "prive" | "inconnu";
              distance_m: number;
              walk_minutes?: number;
              source: "ode" | "dpl";
            };
            const list: EcoleEntry[] = [];
            if (data.ecoles?.top) {
              for (const e of data.ecoles.top) {
                list.push({
                  nom: e.nom,
                  statut: e.statut,
                  distance_m: e.distance_m,
                  walk_minutes: e.walk_minutes,
                  source: "ode",
                });
              }
            }
            if (data.proximite_locale?.scolaire) {
              for (const e of data.proximite_locale.scolaire) {
                if (
                  list.some(
                    (x) =>
                      x.nom.toLowerCase().replace(/[^a-z0-9]/g, "") ===
                      e.nom.toLowerCase().replace(/[^a-z0-9]/g, ""),
                  )
                )
                  continue;
                list.push({
                  nom: e.nom,
                  distance_m: e.distance_m,
                  source: "dpl",
                });
              }
            }
            if (list.length === 0) return null;
            const top4 = list.sort((a, b) => a.distance_m - b.distance_m).slice(0, 4);
            return (
              <>
                <Text style={styles.sectionTitle}>Écoles à proximité</Text>
                {top4.map((e, i) => {
                  const statutLabel =
                    e.statut === "public"
                      ? " (Public)"
                      : e.statut === "prive"
                        ? " (Privé)"
                        : "";
                  const distLabel =
                    e.distance_m < 100
                      ? "à proximité immédiate"
                      : e.distance_m < 1000
                        ? `${e.distance_m} m`
                        : `${(e.distance_m / 1000).toFixed(1)} km`;
                  return (
                    <Text key={i} style={{ fontSize: 10, color: "#0f172a", marginBottom: 2 }}>
                      • {e.nom}
                      {statutLabel} — {distLabel}
                      {e.walk_minutes ? ` · ${e.walk_minutes} min à pied` : ""}
                    </Text>
                  );
                })}
              </>
            );
          })()}

          {/* ── Section 4 — Services quotidien ───────────────────────── */}
          {/* Idem que Transports : à Paris intra-muros tout est à 200 m à pied,
              le score n'apporte rien. On garde le décompte des catégories qui
              reste utile (savoir combien de boulangeries / pharmacies / etc.). */}
          {Boolean(data.services) && data.services && data.services.count > 0 && (
            <>
              <Text style={styles.sectionTitle}>Services & commerces (500 m)</Text>
              <View style={styles.detailGrid}>
                {!data.paris_distance?.is_paris && (
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Accessibilité à pied</Text>
                    <Text style={styles.detailValue}>{data.services.score_quotidien}/100</Text>
                  </View>
                )}
                {Object.entries(data.services.par_categorie).map(([cat, count]) => (
                  <View key={cat} style={styles.detailItem}>
                    <Text style={styles.detailLabel}>{cat.replace("_", " ")}</Text>
                    <Text style={styles.detailValue}>{count}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

          {/* ── Section 5 — Évolution prix m² 8 ans ─────────────────── */}
          {Boolean(data.price_evolution) && data.price_evolution && data.price_evolution.years.length >= 2 && (
            <>
              <Text style={styles.sectionTitle}>
                {data.price_evolution.scope === "cluster"
                  ? "Évolution prix m² du micro-marché"
                  : "Évolution prix m² de la commune"}
                {" "}({data.price_evolution.annee_min} – {data.price_evolution.annee_max})
              </Text>
              {data.price_evolution.scope === "cluster" && data.price_evolution.nb_total_ventes_cluster != null && (
                <Text style={{ fontSize: 9, color: "#64748b", marginBottom: 6 }}>
                  Agrégation sur {data.price_evolution.nb_total_ventes_cluster} ventes notariées DVF dans le micro-marché
                  ({data.price_evolution.type_local}
                  {data.price_evolution.match_method === "radius_400m"
                    ? ", rayon 400 m autour de l'adresse"
                    : ", polygon HDBSCAN officiel"}
                  ).
                </Text>
              )}
              <PriceEvolutionChart
                years={data.price_evolution.years}
                variation_pct_total={data.price_evolution.variation_pct_total}
                variation_pct_5y={data.price_evolution.variation_pct_5y}
                type_local={data.price_evolution.type_local}
                scope={data.price_evolution.scope ?? "commune"}
                primaryColor={data.primary_color}
                communeYears={data.price_evolution.commune_years ?? null}
                communeVariationPctTotal={data.price_evolution.commune_variation_pct_total ?? null}
              />
            </>
          )}

          {/* ── Section 5b — Dynamique du quartier : grands projets infra
              ────────────────────────────────────────────────────────────
              ⚖️ CONFORMITÉ DÉONTOLOGIE :
              On ne mentionne JAMAIS de chiffre prospectif d'évolution
              de prix (loi Hoguet n°70-9, décret 72-678 art. 4-1, code
              consommation L121-1, Charte Expertise 6e éd. 2025).
              On informe sur l'existence du projet et sa dynamique
              qualitative ("secteur en mutation", "projet structurant"),
              sans engager une promesse de plus-value chiffrée. */}
          {Boolean(data.grands_projets) &&
            data.grands_projets &&
            data.grands_projets.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>
                  Dynamique du quartier — Grands projets à proximité
                </Text>
                <Text style={{ fontSize: 9, color: "#64748b", marginBottom: 6 }}>
                  Projets d&apos;infrastructure en cours ou à venir (transports,
                  voies navigables, opérations d&apos;aménagement,
                  réindustrialisation) susceptibles de transformer
                  l&apos;attractivité du secteur dans les prochaines années.
                </Text>
                <View style={{ marginBottom: 10 }}>
                  {data.grands_projets.slice(0, 4).map((g, idx) => {
                    const dist =
                      g.distance_m < 1000
                        ? `${g.distance_m} m`
                        : `${(g.distance_m / 1000).toFixed(1)} km`;
                    const livraison = g.date_livraison_estimee
                      ? new Date(g.date_livraison_estimee).getFullYear()
                      : null;
                    const livraisonLabel = livraison
                      ? ` · livraison ${livraison}`
                      : "";

                    // Mention qualitative SANS chiffre prospectif (déontologie)
                    const impactMax = g.impact_prix_pct_max ?? 0;
                    const qualitativeLabel =
                      impactMax >= 15
                        ? "Projet structurant majeur"
                        : impactMax >= 8
                        ? "Secteur en mutation urbaine"
                        : impactMax >= 3
                        ? "Quartier dynamique"
                        : "Projet à proximité";

                    return (
                      <View
                        key={idx}
                        style={{
                          flexDirection: "row",
                          marginBottom: 4,
                          paddingLeft: 4,
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 10,
                            color: data.primary_color,
                            marginRight: 6,
                          }}
                        >
                          •
                        </Text>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 10, color: "#0f172a" }}>
                            <Text style={{ fontWeight: 700 }}>{g.nom}</Text>
                            {` — à ${dist}${livraisonLabel}`}
                          </Text>
                          <Text
                            style={{
                              fontSize: 9,
                              color: "#475569",
                              fontStyle: "italic",
                            }}
                          >
                            {qualitativeLabel}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
                <Text
                  style={{
                    fontSize: 7,
                    color: "#94a3b8",
                    marginBottom: 8,
                    fontStyle: "italic",
                  }}
                >
                  Source : programmation officielle des maîtres d&apos;ouvrage
                  (Société des Grands Projets, VNF, SNCF Réseau, opérations
                  d&apos;intérêt national). Les indications de calendrier et
                  de dynamique restent prévisionnelles et susceptibles
                  d&apos;évoluer. Aucune promesse de plus-value ne saurait
                  être déduite du présent document, conformément à la loi
                  Hoguet et au devoir de conseil objectif du mandataire.
                </Text>
              </>
            )}

          {/* ── Section 6 — INSEE socio-démo ─────────────────────────── */}
          {Boolean(data.insee) && data.insee && (
            <>
              <Text style={styles.sectionTitle}>Profil socio-démographique (INSEE Filosofi)</Text>
              <View style={styles.detailGrid}>
                {data.insee.revenu_median_uc_eur != null && (
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Revenu médian / UC</Text>
                    <Text style={styles.detailValue}>{fmt(data.insee.revenu_median_uc_eur)} € / an</Text>
                  </View>
                )}
                {data.insee.taux_proprietaires_pct != null && (
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Propriétaires occupants</Text>
                    <Text style={styles.detailValue}>{data.insee.taux_proprietaires_pct} %</Text>
                  </View>
                )}
                {data.insee.taux_csp_plus_pct != null && (
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>CSP+ (cadres / prof. lib.)</Text>
                    <Text style={styles.detailValue}>{data.insee.taux_csp_plus_pct} %</Text>
                  </View>
                )}
                {data.insee.population_municipale != null && (
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Population commune</Text>
                    <Text style={styles.detailValue}>{fmt(data.insee.population_municipale)} hab.</Text>
                  </View>
                )}
              </View>
            </>
          )}

          {/* Méthodologie compressée pour tenir la page 2 (au lieu de
              déborder sur une page 3 vide). Mention condensée intégrée
              en bas de la page 2 au lieu d'un bloc séparé. */}
          <Text
            style={{
              fontSize: 7,
              color: "#94a3b8",
              marginTop: 8,
              lineHeight: 1.3,
              fontStyle: "italic",
            }}
          >
            Sources : DVF (notaires) · OSM Overpass · Annuaire Éducation Nationale ·
            INSEE Filosofi · IDFM PRIM. Scores accessibilité = heuristiques DATAMERRY®.
            Pour une visite physique gratuite et un avis d&apos;expert affiné, un agent {data.cabinet_name} vous recontacte sous 24h ouvrées.
          </Text>

          {/* Footer page 2 */}
          <View style={styles.footer}>
            {Boolean(data.cabinet_legal) && (
              <Text style={{ marginBottom: 3 }}>{data.cabinet_legal}</Text>
            )}
            <Text>
              Rapport propulsé par <Text style={styles.footerBold}>DATAMERRY®</Text>
              {"  ·  "}
              Page 2 / 2
            </Text>
          </View>
        </Page>
      )}
    </Document>
  );
}
