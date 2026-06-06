import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Anonymisation des données — Transparence DATAMERRY",
  description:
    "Comment DATAMERRY garantit l'anonymisation des données personnelles : architecture, k-anonymisation, ancrage cryptographique, audit RGPD.",
  robots: { index: true, follow: true },
};

const DM_DARK = "#064e3b";
const DM_GREEN = "#10b981";
const GOLD = "#c8a25d";
const SOLANA = "#9945ff";
const MUTED = "#64748b";
const TEXT = "#0f172a";
const BORDER = "#e2e8f0";
const BG = "#f8fafc";
const HIGHLIGHT = "#fef3c7";

function Section({
  title,
  icon,
  color,
  children,
}: {
  title: string;
  icon: string;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${color}`,
        borderRadius: 8,
        padding: 24,
        marginBottom: 20,
      }}
    >
      <h2
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: DM_DARK,
          margin: "0 0 14px 0",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span style={{ fontSize: 24 }}>{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function AnonymisationPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          padding: "48px 24px",
        }}
      >
        {/* Header */}
        <header style={{ marginBottom: 36 }}>
          <Link
            href="/"
            style={{
              fontSize: 13,
              color: MUTED,
              textDecoration: "none",
              display: "inline-block",
              marginBottom: 16,
            }}
          >
            ← Retour à DATAMERRY
          </Link>
          <div
            style={{
              display: "inline-block",
              background: DM_DARK,
              color: "#fff",
              padding: "4px 12px",
              borderRadius: 999,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 1,
              marginBottom: 12,
            }}
          >
            🔒 TRANSPARENCE RGPD
          </div>
          <h1
            style={{
              fontSize: 36,
              fontWeight: 800,
              color: DM_DARK,
              margin: "0 0 12px 0",
              lineHeight: 1.15,
            }}
          >
            Anonymisation des données — comment ça marche
          </h1>
          <p
            style={{
              fontSize: 16,
              color: MUTED,
              lineHeight: 1.5,
              margin: 0,
            }}
          >
            Cette page détaille publiquement notre architecture
            d'anonymisation, conforme RGPD et auditée. Elle s'adresse
            aux cabinets immobiliers partenaires, à leurs DPO, aux
            avocats et à la CNIL.
          </p>
        </header>

        {/* Section 1 : Définition */}
        <Section
          title="1. Anonymisation vs Pseudonymisation"
          icon="📚"
          color={GOLD}
        >
          <p style={{ marginBottom: 14, lineHeight: 1.6, color: TEXT }}>
            La CNIL (lignes directrices WP216) distingue deux notions
            souvent confondues :
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
            }}
          >
            <div
              style={{
                background: BG,
                padding: 16,
                borderRadius: 8,
                border: `1px solid ${BORDER}`,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#dc2626",
                  marginBottom: 6,
                }}
              >
                ❌ Pseudonymisation
              </div>
              <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                Remplacer un identifiant par un pseudonyme (hash, UUID).
                <br />
                <strong style={{ color: TEXT }}>
                  Réversible — reste donnée personnelle au sens RGPD.
                </strong>
              </div>
            </div>
            <div
              style={{
                background: "#ecfdf5",
                padding: 16,
                borderRadius: 8,
                border: `1px solid ${DM_GREEN}`,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: DM_GREEN,
                  marginBottom: 6,
                }}
              >
                ✅ Anonymisation (notre engagement)
              </div>
              <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.5 }}>
                Irréversibilité totale — impossibilité de
                ré-identification.
                <br />
                <strong style={{ color: TEXT }}>
                  Sort du champ RGPD (CNIL WP216).
                </strong>
              </div>
            </div>
          </div>
        </Section>

        {/* Section 2 : Architecture */}
        <Section
          title="2. Architecture technique — séparation des bases"
          icon="🏗️"
          color={DM_DARK}
        >
          <p style={{ marginBottom: 14, lineHeight: 1.6, color: TEXT }}>
            Les données personnelles (PII) sont physiquement séparées
            des données statistiques utilisées pour entraîner les
            modèles d'estimation. <strong>Aucune foreign key, aucun
            join SQL possible</strong> entre les deux bases.
          </p>
          <div
            style={{
              fontFamily: "ui-monospace, 'Menlo', monospace",
              fontSize: 12,
              background: TEXT,
              color: "#a7f3d0",
              padding: 18,
              borderRadius: 8,
              overflowX: "auto",
              lineHeight: 1.6,
            }}
          >
            {`┌──────────────────────────────────────┐
│  Base PII (privée par cabinet)        │
│  • dim_cabinet_leads                  │
│    - nom, email, téléphone            │
│    - adresse perso, IP                │
│  • Accès : cabinet propriétaire       │
│  • RLS activé (Supabase)              │
│  • Auditée (audit_pii_access)         │
└──────────────────────────────────────┘
              ✋ AUCUN LIEN ✋
┌──────────────────────────────────────┐
│  Base anonymisée (publique)           │
│  • fact_dvf_clusters                  │
│    - adresse bien (publique)          │
│    - surface, type, prix              │
│  • Accès : modèles statistiques       │
│  • K-anonymisation k ≥ 5              │
│  • Aucune PII                         │
└──────────────────────────────────────┘`}
          </div>
        </Section>

        {/* Section 3 : K-anonymisation */}
        <Section
          title="3. K-anonymisation (k ≥ 5)"
          icon="🛡️"
          color={DM_GREEN}
        >
          <p style={{ lineHeight: 1.6, color: TEXT }}>
            Pour empêcher toute ré-identification indirecte, toute
            statistique agrégée publiée par DATAMERRY (médian, moyenne,
            indicateur de cluster) n'est calculée que si la zone
            contient au moins <strong>5 transactions distinctes</strong>.
            Une zone avec 1, 2, 3 ou 4 ventes est masquée et signalée
            comme « données insuffisantes ».
          </p>
          <div
            style={{
              background: BG,
              padding: 14,
              borderRadius: 6,
              marginTop: 12,
              fontSize: 12,
              color: MUTED,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            SELECT AVG(prix_m2), COUNT(*) FROM ventes_zone
            <br />
            GROUP BY zone_id
            <br />
            <strong style={{ color: DM_GREEN }}>
              HAVING COUNT(*) ≥ 5; -- k-anonymisation
            </strong>
          </div>
        </Section>

        {/* Section 4 : Hébergement UE */}
        <Section
          title="4. Hébergement 100 % Union européenne"
          icon="🇪🇺"
          color="#3b82f6"
        >
          <p style={{ marginBottom: 12, lineHeight: 1.6, color: TEXT }}>
            Toutes les données (PII et statistiques) sont hébergées
            exclusivement dans des datacenters situés dans
            l'Union européenne :
          </p>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              fontSize: 14,
              color: TEXT,
              lineHeight: 1.8,
            }}
          >
            <li>
              ✅ <strong>Supabase (PostgreSQL)</strong> — Région
              Frankfurt (Allemagne)
            </li>
            <li>
              ✅ <strong>Vercel (hébergement Next.js)</strong> — Région
              Frankfurt (Allemagne)
            </li>
            <li>
              ✅ <strong>Resend (envoi d'emails)</strong> — Région
              Dublin (Irlande)
            </li>
          </ul>
          <p style={{ fontSize: 13, color: MUTED, marginTop: 12 }}>
            Aucun transfert vers les États-Unis ou un pays tiers sans
            accord écrit préalable du cabinet et garanties appropriées
            (RGPD art. 44 et suivants).
          </p>
        </Section>

        {/* Section 5 : Audit + ancrage */}
        <Section
          title="5. Audit + ancrage cryptographique"
          icon="🔗"
          color={SOLANA}
        >
          <p style={{ lineHeight: 1.6, color: TEXT, marginBottom: 14 }}>
            Chaque accès à une donnée personnelle est enregistré dans
            un journal d'audit immuable (<code>audit_pii_access</code>)
            comportant : identité de l'utilisateur, adresse IP, ressource
            consultée, action (READ/LIST/EXPORT/UPDATE/DELETE) et
            horodatage.
          </p>
          <p style={{ lineHeight: 1.6, color: TEXT, marginBottom: 14 }}>
            <strong>Engagement Phase 2 (Q3 2026)</strong> : chaque mois,
            le hash SHA-256 de l'ensemble des logs sera ancré sur la
            blockchain Bitcoin via le protocole{" "}
            <a
              href="https://opentimestamps.org/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: SOLANA, fontWeight: 600 }}
            >
              Open Timestamps
            </a>{" "}
            (standard ouvert, gratuit). Le fichier de preuve
            (<code>.ots</code>) sera publié sur cette page, permettant
            à n'importe qui de vérifier sur{" "}
            <a
              href="https://ots.tools/"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: SOLANA, fontWeight: 600 }}
            >
              ots.tools
            </a>{" "}
            que les logs n'ont pas été modifiés a posteriori. Cette
            preuve est opposable devant un tribunal français.
          </p>
        </Section>

        {/* Section 6 : Droits du cabinet */}
        <Section
          title="6. Droits du cabinet partenaire"
          icon="✨"
          color={GOLD}
        >
          <p style={{ lineHeight: 1.6, color: TEXT, marginBottom: 14 }}>
            Le cabinet (responsable de traitement RGPD) peut, à tout
            moment :
          </p>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              fontSize: 14,
              color: TEXT,
              lineHeight: 1.8,
            }}
          >
            <li>
              📥 <strong>Exporter</strong> l'intégralité de ses leads
              au format CSV ou JSON depuis son dashboard admin (sous
              48h ouvrées maximum)
            </li>
            <li>
              📋 <strong>Consulter le journal d'accès</strong> à ses
              données (qui a consulté quoi, quand, depuis quelle IP)
            </li>
            <li>
              🗑️ <strong>Demander la suppression</strong> de tout ou
              partie de ses leads
            </li>
            <li>
              🔍 <strong>Auditer</strong> annuellement les mesures de
              sécurité techniques et organisationnelles
            </li>
            <li>
              📤 <strong>Récupérer toutes les données</strong> sous 30
              jours en cas de rupture du contrat
            </li>
          </ul>
        </Section>

        {/* Section 7 : Documents */}
        <Section title="7. Documents officiels" icon="📄" color="#3b82f6">
          <p style={{ lineHeight: 1.6, color: TEXT, marginBottom: 12 }}>
            Les documents juridiques suivants sont disponibles sur
            simple demande à{" "}
            <a
              href="mailto:contact@datamerry.com"
              style={{ color: DM_GREEN, fontWeight: 600 }}
            >
              contact@datamerry.com
            </a>{" "}
            :
          </p>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              fontSize: 14,
              color: TEXT,
              lineHeight: 1.8,
            }}
          >
            <li>
              📋 <strong>Convention de sous-traitance (DPA)</strong> —
              modèle RGPD article 28
            </li>
            <li>
              📋 <strong>Registre des activités de traitement</strong>{" "}
              — RGPD article 30
            </li>
            <li>
              📋 <strong>Analyse d'impact (PIA)</strong> — pour les
              traitements à risque élevé
            </li>
            <li>
              📋 <strong>Plan de continuité d'activité (PCA)</strong>
            </li>
          </ul>
        </Section>

        {/* Footer */}
        <footer
          style={{
            marginTop: 32,
            padding: 20,
            background: HIGHLIGHT,
            borderRadius: 8,
            border: `1px solid ${GOLD}`,
            fontSize: 13,
            color: TEXT,
            lineHeight: 1.6,
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: DM_DARK,
              marginBottom: 6,
            }}
          >
            📞 Une question, un doute, un audit ?
          </div>
          DATAMERRY accueille volontiers toute question d'avocat, de
          DPO ou de la CNIL. Écrivez-nous à{" "}
          <a
            href="mailto:contact@datamerry.com"
            style={{ color: DM_DARK, fontWeight: 600 }}
          >
            contact@datamerry.com
          </a>{" "}
          — nous répondons sous 48h ouvrées.
          <br />
          <span
            style={{
              fontSize: 11,
              color: MUTED,
              fontStyle: "italic",
              display: "block",
              marginTop: 8,
            }}
          >
            Dernière mise à jour : {new Date().toLocaleDateString("fr-FR")}{" "}
            — Cette page sera étoffée au fil des évolutions de notre
            programme de transparence.
          </span>
        </footer>
      </div>
    </main>
  );
}
