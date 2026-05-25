/**
 * DATAMERRY — Composant PDF du rapport propriété.
 *
 * Utilise @react-pdf/renderer (pas Puppeteer) :
 *   - 100% JS, pas de Chromium → Vercel-friendly
 *   - Composants JSX type-safe
 *   - Streaming PDF natif via renderToStream()
 *
 * Customisation cabinet :
 *   - primaryColor : couleur d'accent (titres, séparateurs)
 *   - cabinetName  : nom affiché en tête
 *   - cabinetLogo  : URL ou null (laissé blanc si null pour la v1)
 *
 * Le PDF est volontairement vertical, A4, en 2-3 pages :
 *   p.1 : adresse + photo streetview + résumé (estim, rendement, plafonds)
 *   p.2 : stratégies locatives + scores quartier (transports, services, écoles)
 *   p.3 : annexes (sources, mentions légales)
 */

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  Font,
} from "@react-pdf/renderer";

// ──────────────────────────────────────────────────────────────────────────────
// Types — alignés avec la réponse JSON de /api/property-report
// ──────────────────────────────────────────────────────────────────────────────

export type PdfReportData = {
  address: {
    label: string;
    lat: number;
    lon: number;
    code_insee: string;
    postcode: string;
    city: string;
  };
  query: {
    type_local: string;
    surface: number | null;
    pieces: number | null;
  };
  estimation: {
    available: boolean;
    cluster_n?: number;
    prix_m2?: {
      median: number | null;
      p10: number | null;
      p90: number | null;
    };
    prix_total?: {
      median: number;
      p10: number | null;
      p90: number | null;
    } | null;
  };
  rendement: {
    available: boolean;
    loyer_source?: string | null;
    loyer_m2_median?: number | null;
    rendement_brut?: number | null;
    rendement_net_est?: number | null;
  };
  plafonds: {
    available: boolean;
    zone_abc?: string | null;
  };
  streetview?: {
    available: boolean;
    image_url: string | null;
    attribution: string;
    source: string;
  } | null;
  ecoles?: {
    count: number;
    par_type: Record<string, number>;
  } | null;
  transports?: {
    score_accessibilite: number;
    count: number;
    par_type: Record<string, number>;
  } | null;
  services_proximite?: {
    score_quotidien: number;
    count: number;
    par_categorie: Record<string, number>;
  } | null;
};

export type PdfBranding = {
  cabinetName: string;
  primaryColor: string;       // ex: "#1f3a8a"
  cabinetLogoUrl: string | null;
  contactInfo?: string;       // ex: "Carte T n° CPI… - Eurealimmo SARL"
};

// ──────────────────────────────────────────────────────────────────────────────
// Helpers de format
// ──────────────────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function eur(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return fmt.format(n) + " €";
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(1).replace(".", ",") + " %";
}

// ──────────────────────────────────────────────────────────────────────────────
// Styles
// ──────────────────────────────────────────────────────────────────────────────

const makeStyles = (primary: string) =>
  StyleSheet.create({
    page: {
      padding: 32,
      fontSize: 10,
      fontFamily: "Helvetica",
      color: "#0f172a",
    },
    // Header
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      borderBottomWidth: 2,
      borderBottomColor: primary,
      paddingBottom: 12,
      marginBottom: 16,
    },
    headerLeft: { flexDirection: "column" },
    cabinetName: { fontSize: 14, fontWeight: "bold", color: primary },
    cabinetContact: { fontSize: 8, color: "#64748b", marginTop: 2 },
    poweredBy: { fontSize: 8, color: "#64748b", textTransform: "uppercase" },
    logo: { width: 60, height: 30, objectFit: "contain" },

    // Address
    addressBlock: { marginBottom: 12 },
    addressLabel: { fontSize: 16, fontWeight: "bold", marginBottom: 2 },
    addressMeta: { fontSize: 10, color: "#64748b" },

    // Streetview
    sv: {
      width: "100%",
      height: 140,
      objectFit: "cover",
      borderRadius: 6,
      marginBottom: 14,
    },
    svPlaceholder: {
      width: "100%",
      height: 60,
      backgroundColor: "#f1f5f9",
      borderRadius: 6,
      marginBottom: 14,
      justifyContent: "center",
      alignItems: "center",
    },
    svPlaceholderText: { fontSize: 9, color: "#94a3b8" },

    // 3-card grid
    cards: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 16,
    },
    card: {
      width: "32%",
      backgroundColor: "#f8fafc",
      borderRadius: 6,
      padding: 10,
    },
    cardTitle: {
      fontSize: 8,
      color: "#64748b",
      textTransform: "uppercase",
      marginBottom: 4,
    },
    cardValue: { fontSize: 18, fontWeight: "bold", color: primary },
    cardSub: { fontSize: 9, color: "#0f172a", marginTop: 2 },
    cardMini: { fontSize: 8, color: "#94a3b8", marginTop: 3 },

    // Section titles
    sectionTitle: {
      fontSize: 11,
      fontWeight: "bold",
      color: primary,
      marginTop: 14,
      marginBottom: 8,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },

    // Scores row
    scoresRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    score: {
      width: "32%",
      backgroundColor: "#fff",
      borderWidth: 1,
      borderColor: "#e2e8f0",
      borderRadius: 6,
      padding: 10,
      alignItems: "center",
    },
    scoreVal: { fontSize: 22, fontWeight: "bold", color: primary },
    scoreMax: { fontSize: 9, color: "#94a3b8" },
    scoreLbl: { fontSize: 8, color: "#64748b", textAlign: "center", marginTop: 4 },

    // Two columns
    twoCols: { flexDirection: "row", justifyContent: "space-between" },
    col: { width: "48%" },

    // Lists
    listItem: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingVertical: 3,
      borderBottomWidth: 0.5,
      borderBottomColor: "#e2e8f0",
    },
    listLabel: { fontSize: 9 },
    listValue: { fontSize: 9, color: primary, fontWeight: "bold" },

    // Footer
    footer: {
      position: "absolute",
      bottom: 20,
      left: 32,
      right: 32,
      borderTopWidth: 0.5,
      borderTopColor: "#e2e8f0",
      paddingTop: 6,
      fontSize: 7,
      color: "#94a3b8",
      textAlign: "center",
    },
  });

// ──────────────────────────────────────────────────────────────────────────────
// Composant principal
// ──────────────────────────────────────────────────────────────────────────────

export function PropertyReportPDF({
  data,
  branding,
}: {
  data: PdfReportData;
  branding: PdfBranding;
}): React.ReactElement {
  const s = makeStyles(branding.primaryColor);
  const today = new Date().toLocaleDateString("fr-FR");

  return (
    <Document
      title={`Rapport DATAMERRY — ${data.address.label}`}
      author={branding.cabinetName}
      creator="DATAMERRY"
    >
      {/* ─────────── Page 1 — Synthèse ─────────── */}
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <View style={s.headerLeft}>
            <Text style={s.cabinetName}>{branding.cabinetName}</Text>
            {branding.contactInfo ? (
              <Text style={s.cabinetContact}>{branding.contactInfo}</Text>
            ) : null}
          </View>
          {branding.cabinetLogoUrl ? (
            <Image src={branding.cabinetLogoUrl} style={s.logo} />
          ) : (
            <Text style={s.poweredBy}>propulsé par DATAMERRY</Text>
          )}
        </View>

        {/* Adresse */}
        <View style={s.addressBlock}>
          <Text style={s.addressLabel}>{data.address.label}</Text>
          <Text style={s.addressMeta}>
            {data.address.postcode} {data.address.city}
            {data.query.surface ? ` · ${data.query.surface} m²` : ""}
            {data.query.pieces ? ` · ${data.query.pieces} pièces` : ""}
            {data.query.type_local ? ` · ${data.query.type_local}` : ""}
          </Text>
        </View>

        {/* Streetview */}
        {data.streetview?.image_url ? (
          <Image src={data.streetview.image_url} style={s.sv} />
        ) : (
          <View style={s.svPlaceholder}>
            <Text style={s.svPlaceholderText}>Vue rue non disponible</Text>
          </View>
        )}

        {/* 3 cards */}
        <View style={s.cards}>
          <View style={s.card}>
            <Text style={s.cardTitle}>Estimation marché</Text>
            {data.estimation.available && data.estimation.prix_total ? (
              <>
                <Text style={s.cardValue}>{eur(data.estimation.prix_total.median)}</Text>
                <Text style={s.cardSub}>
                  {eur(data.estimation.prix_m2?.median)}/m²
                </Text>
                <Text style={s.cardMini}>
                  Fourchette {eur(data.estimation.prix_total.p10)} – {eur(data.estimation.prix_total.p90)}
                </Text>
                <Text style={s.cardMini}>
                  Basé sur {data.estimation.cluster_n} ventes DVF
                </Text>
              </>
            ) : (
              <Text style={s.cardMini}>Données insuffisantes</Text>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Rendement locatif</Text>
            {data.rendement.available ? (
              <>
                <Text style={s.cardValue}>{pct(data.rendement.rendement_brut)}</Text>
                <Text style={s.cardSub}>
                  Loyer {eur(data.rendement.loyer_m2_median)}/m²
                </Text>
                <Text style={s.cardMini}>
                  Net estimé {pct(data.rendement.rendement_net_est)}
                </Text>
                <Text style={s.cardMini}>
                  Source {data.rendement.loyer_source ?? "OLAP/ANIL"}
                </Text>
              </>
            ) : (
              <Text style={s.cardMini}>Pas de référence loyer</Text>
            )}
          </View>

          <View style={s.card}>
            <Text style={s.cardTitle}>Zone fiscale</Text>
            {data.plafonds.available ? (
              <>
                <Text style={s.cardValue}>{data.plafonds.zone_abc}</Text>
                <Text style={s.cardSub}>Éligible Jeanbrun · LLI · Loc'Avantages</Text>
              </>
            ) : (
              <Text style={s.cardMini}>Zonage A/B/C non identifié</Text>
            )}
          </View>
        </View>

        {/* Quartier */}
        <Text style={s.sectionTitle}>Quartier</Text>
        <View style={s.scoresRow}>
          <View style={s.score}>
            <Text style={s.scoreVal}>
              {data.transports?.score_accessibilite ?? "—"}
              <Text style={s.scoreMax}>/100</Text>
            </Text>
            <Text style={s.scoreLbl}>Accessibilité transports</Text>
          </View>
          <View style={s.score}>
            <Text style={s.scoreVal}>
              {data.services_proximite?.score_quotidien ?? "—"}
              <Text style={s.scoreMax}>/100</Text>
            </Text>
            <Text style={s.scoreLbl}>Ville à 15 minutes</Text>
          </View>
          <View style={s.score}>
            <Text style={s.scoreVal}>{data.ecoles?.count ?? "—"}</Text>
            <Text style={s.scoreLbl}>Écoles &lt; 1,5 km</Text>
          </View>
        </View>

        {/* Listes détails */}
        <View style={s.twoCols}>
          <View style={s.col}>
            <Text style={s.sectionTitle}>Transports détail</Text>
            {data.transports?.par_type
              ? Object.entries(data.transports.par_type).map(([k, v]) => (
                  <View key={k} style={s.listItem}>
                    <Text style={s.listLabel}>{k}</Text>
                    <Text style={s.listValue}>{v}</Text>
                  </View>
                ))
              : <Text style={s.cardMini}>Aucun arrêt à proximité</Text>}
          </View>

          <View style={s.col}>
            <Text style={s.sectionTitle}>Écoles détail</Text>
            {data.ecoles?.par_type
              ? Object.entries(data.ecoles.par_type).map(([k, v]) => (
                  <View key={k} style={s.listItem}>
                    <Text style={s.listLabel}>{k}</Text>
                    <Text style={s.listValue}>{v}</Text>
                  </View>
                ))
              : <Text style={s.cardMini}>Aucune école dans le rayon</Text>}
          </View>
        </View>

        {/* Footer */}
        <Text style={s.footer} fixed>
          Rapport généré le {today} · Sources : DVF (notaires), OLAP, ANIL, INSEE, OpenStreetMap, Mapillary · DATAMERRY ne se substitue pas à un avis d'expert.
        </Text>
      </Page>
    </Document>
  );
}
