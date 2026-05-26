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

const fmt = (n: number | null | undefined): string =>
  n != null && Number.isFinite(n)
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)
    : "—";

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
          {data.cabinet_legal && (
            <Text style={{ marginBottom: 3 }}>{data.cabinet_legal}</Text>
          )}
          <Text>
            Estimation propulsée par <Text style={styles.footerBold}>DATAMERRY®</Text>
            {"  ·  "}
            Sources : DVF (notaires), OLAP, ANIL, ADEME, INSEE
            {"  ·  "}
            Méthodologie : modèle AVM (Charte Expertise 6e éd. 2025, ch. 6)
          </Text>
          <Text style={{ marginTop: 3 }}>
            Ce document a été généré automatiquement. Il ne se substitue pas à un avis d&apos;expert immobilier formel.
          </Text>
        </View>
      </Page>
    </Document>
  );
}
