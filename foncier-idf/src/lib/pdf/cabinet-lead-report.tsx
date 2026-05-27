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
  } | null;

  /** Écoles à proximité (Annuaire Éducation Nationale) */
  ecoles?: {
    count: number;
    par_type: Record<string, number>;
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

  /** Top 2 points d'intérêts notables (OSM + wikipedia filter) */
  points_interet?: {
    count: number;
    top: Array<{
      nom: string;
      type: "monument" | "musee" | "attraction" | "memorial" | "viewpoint" | "autre";
      distance_m: number;
    }>;
  } | null;

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
      prix_m2_p25: number | null;
      prix_m2_p75: number | null;
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
    match_method?: "hull" | "centroid" | "none";
  } | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Styles (StyleSheet React-PDF — pas du CSS)
// ──────────────────────────────────────────────────────────────────────────────

function buildStyles(primary: string) {
  return StyleSheet.create({
    page: {
      padding: 40,
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
      marginTop: 14,
      marginBottom: 8,
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
 * Bar chart de l'évolution prix m² par année.
 *
 * Implémenté en React-PDF natif (pas de lib graphique) : chaque année est
 * un <View> avec hauteur proportionnelle au prix. Permet d'embarquer dans
 * un PDF léger sans dépendance.
 *
 * Affiche : label année + bar (hauteur normalisée 0-100) + valeur €/m² au-dessus
 * + caption avec variation 5y / variation totale.
 */
function PriceEvolutionChart({
  years,
  variation_pct_total,
  variation_pct_5y,
  type_local,
  scope,
  primaryColor,
}: {
  years: Array<{ annee: number; prix_m2_median: number; nb_ventes: number }>;
  variation_pct_total: number | null;
  variation_pct_5y: number | null;
  type_local: string;
  scope: "cluster" | "commune";
  primaryColor: string;
}) {
  const maxPrice = Math.max(...years.map((y) => y.prix_m2_median));
  const minPrice = Math.min(...years.map((y) => y.prix_m2_median));
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

  return (
    <View style={{ marginTop: 8 }}>
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
              <View
                style={{
                  width: "70%",
                  height: barHeight,
                  backgroundColor: primaryColor,
                  borderTopLeftRadius: 2,
                  borderTopRightRadius: 2,
                }}
              />
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

      {/* Caption : variation cumulée */}
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
        <Text style={{ fontSize: 8, color: "#94a3b8", marginTop: 3 }}>
          Médiane DVF par année · données notariées officielles · années avec ≥ 5 ventes
          {scope === "cluster" ? " · périmètre = polygon HDBSCAN du micro-marché" : ""}
        </Text>
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

                  {/* Bloc détail technique du meilleur itinéraire */}
                  <View style={{ marginTop: 8, padding: 10, backgroundColor: "#f1f5f9", borderRadius: 6 }}>
                    <Text style={{ fontSize: 9, color: "#475569", marginBottom: 6 }}>
                      Détail itinéraire le plus rapide ({data.paris_distance.journey_to_paris.total_duration_min} min total
                      {" · "}{data.paris_distance.journey_to_paris.walking_duration_min} min marche
                      {" · "}{data.paris_distance.journey_to_paris.nb_transfers} correspondance{data.paris_distance.journey_to_paris.nb_transfers > 1 ? "s" : ""}) :
                    </Text>
                    {data.paris_distance.journey_to_paris.sections
                      .filter((s) => s.type !== "wait")
                      .map((s, i) => (
                        <Text key={i} style={{ fontSize: 9, color: "#0f172a", marginBottom: 2 }}>
                          {s.type === "walking" || s.type === "transfer"
                            ? `🚶 ${s.duration_min} min de marche${s.distance_m ? ` (${s.distance_m} m)` : ""}`
                            : `🚆 ${s.line ?? "Transit"} · ${s.duration_min} min · ${s.from ?? ""} → ${s.to ?? ""}`}
                        </Text>
                      ))}
                    {data.paris_distance.journey_to_paris.alternatives.length > 1 && (
                      <Text style={{ fontSize: 8, color: "#94a3b8", marginTop: 6, fontStyle: "italic" }}>
                        Alternatives : {data.paris_distance.journey_to_paris.alternatives
                          .slice(1)
                          .map((a) => `${a.duration_min} min via ${a.primary_lines.join(" + ") || "marche"}`)
                          .join(" — ")}
                      </Text>
                    )}
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
              <Text style={styles.sectionTitle}>
                {data.paris_distance?.is_paris
                  ? "Métros, RER & tramway à 500 m"
                  : "Transports à proximité"}
              </Text>
              {data.paris_distance?.is_paris ? (
                <Text style={{ fontSize: 10, color: "#475569", marginBottom: 6 }}>
                  {data.transports.count} arrêts dans un rayon de 500 m.
                </Text>
              ) : (
                <View style={styles.detailGrid}>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Score accessibilité</Text>
                    <Text style={styles.detailValue}>
                      {data.transports.score_accessibilite}/100
                      {" · "}
                      {data.transports.count} arrêts dans 800 m
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
            const SEUIL_ABSOLU_RESPECTABILITE = 80; // %
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

            if (lyceesQualifies.length === 0) return null;

            return (
              <>
                <Text style={styles.sectionTitle}>
                  Lycées à proximité — taux de réussite Bac
                </Text>
                <Text style={{ fontSize: 9, color: "#64748b", marginBottom: 6 }}>
                  Lycées retenus : ≥ 80 % de réussite (Bac général). Comparaison
                  académique session 2024 (DEPP) affichée si surperformance.
                </Text>
                {lyceesQualifies.map((l, i) => {
                  const statutLabel =
                    l.statut === "public"
                      ? "Public"
                      : l.statut === "prive"
                        ? "Privé sous contrat"
                        : "—";
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
                      <Text style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>
                        {l.nom}
                      </Text>
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

          {/* ── Section 3 — Écoles (maternelle, élémentaire, collège) ─── */}
          {Boolean(data.ecoles) && data.ecoles && data.ecoles.count > 0 && (
            <>
              <Text style={styles.sectionTitle}>Écoles à proximité</Text>
              <View style={styles.detailGrid}>
                <View style={styles.detailItem}>
                  <Text style={styles.detailLabel}>Total</Text>
                  <Text style={styles.detailValue}>{data.ecoles.count} dans 1,5 km</Text>
                </View>
                {Object.entries(data.ecoles.par_type).map(([type, count]) => (
                  <View key={type} style={styles.detailItem}>
                    <Text style={styles.detailLabel}>{type}</Text>
                    <Text style={styles.detailValue}>{count}</Text>
                  </View>
                ))}
              </View>
            </>
          )}

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
                  ({data.price_evolution.type_local}, polygon HDBSCAN officiel).
                </Text>
              )}
              <PriceEvolutionChart
                years={data.price_evolution.years}
                variation_pct_total={data.price_evolution.variation_pct_total}
                variation_pct_5y={data.price_evolution.variation_pct_5y}
                type_local={data.price_evolution.type_local}
                scope={data.price_evolution.scope ?? "commune"}
                primaryColor={data.primary_color}
              />
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

          {/* Note méthodologie */}
          <View style={[styles.expertNote, { marginTop: 18 }]}>
            <Text style={styles.expertNoteTitle}>Méthodologie</Text>
            <Text>
              Toutes les données ci-dessus sont issues de sources <Text style={{ fontWeight: 700 }}>opensource publiques</Text> :
              transactions notariées DVF (data.gouv.fr), arrêts de transports et services
              quotidiens via OpenStreetMap (Overpass), Annuaire Éducation Nationale
              (data.education.gouv.fr), INSEE Filosofi pour le revenu médian. Les scores
              d&apos;accessibilité aux transports et aux services quotidiens à pied sont des heuristiques DATAMERRY
              basées sur la quantité, le type et la distance des points d&apos;intérêt.
              {"\n\n"}
              Pour une visite physique gratuite et un avis d&apos;expert affiné, un agent
              {" "}{data.cabinet_name} vous recontacte sous 24h ouvrées.
            </Text>
          </View>

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
