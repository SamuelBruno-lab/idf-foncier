import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Conditions Générales d'Utilisation — datamerry",
  description:
    "CGU du site datamerry.com : conditions d'accès, propriété intellectuelle, données personnelles et responsabilités.",
};

const LAST_UPDATED = "17 mars 2026";

export default function CguPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#0a0a1e", fontFamily: "Segoe UI, Arial, sans-serif" }}>
      {/* Header nav */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "16px 32px", display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/" style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, textDecoration: "none" }}>
          ← datamerry.com
        </Link>
        <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.1)" }} />
        <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>Conditions Générales d&apos;Utilisation</span>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px" }}>
        {/* Hero */}
        <div style={{ marginBottom: 48 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.3)",
            borderRadius: 99, padding: "5px 14px", marginBottom: 20,
            fontSize: 11, color: "#00d4ff", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00d4ff", display: "inline-block" }} />
            Juridique
          </div>
          <h1 style={{ margin: "0 0 16px", fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>
            Conditions Générales d&apos;Utilisation
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.35)" }}>
            Dernière mise à jour : {LAST_UPDATED}
          </p>
        </div>

        {/* Articles */}
        <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>

          {/* Article 1 */}
          <Section num={1} title="Objet">
            <P>
              Les présentes Conditions Générales d&apos;Utilisation (ci-après « CGU ») définissent les
              modalités d&apos;accès et d&apos;utilisation du site <strong style={{ color: "#00d4ff" }}>datamerry.com</strong> (ci-après « le Site »),
              édité par datamerry.
            </P>
            <P>
              L&apos;accès au Site implique l&apos;acceptation pleine et entière des présentes CGU.
            </P>
          </Section>

          {/* Article 2 */}
          <Section num={2} title="Éditeur du site">
            <P>
              Le Site est édité par datamerry.<br />
              Contact : <a href="mailto:contact@datamerry.com" style={{ color: "#00d4ff", textDecoration: "none" }}>contact@datamerry.com</a><br />
              Hébergeur : Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis.
            </P>
          </Section>

          {/* Article 3 */}
          <Section num={3} title="Accès au Site">
            <P>
              Le Site est accessible gratuitement à tout utilisateur disposant d&apos;un accès à Internet.
              datamerry se réserve le droit de suspendre, limiter ou interrompre l&apos;accès au Site
              à tout moment, notamment pour des raisons de maintenance ou de mise à jour.
            </P>
          </Section>

          {/* Article 4 */}
          <Section num={4} title="Services proposés">
            <P>
              Le Site propose un observatoire foncier basé sur les données ouvertes (open data)
              publiées par l&apos;État français, notamment les Demandes de Valeurs Foncières (DVF)
              et les Diagnostics de Performance Énergétique (DPE).
            </P>
            <P>
              Les services incluent : consultation d&apos;une carte interactive des transactions
              immobilières, analyses statistiques par commune et département, identification
              de micro-marchés par algorithmes de clustering.
            </P>
          </Section>

          {/* Article 5 */}
          <Section num={5} title="Données personnelles">
            <P>
              Le Site peut collecter des données personnelles dans le cadre du formulaire de
              contact et de la demande d&apos;analyse personnalisée (nom, email, commune d&apos;intérêt).
            </P>
            <P>
              Ces données sont collectées avec le consentement de l&apos;utilisateur et sont utilisées
              exclusivement pour répondre aux demandes et fournir les services sollicités.
              Elles ne sont ni vendues ni transmises à des tiers sans consentement préalable.
            </P>
            <P>
              Conformément au Règlement Général sur la Protection des Données (RGPD) et à la
              loi Informatique et Libertés, tout utilisateur dispose d&apos;un droit d&apos;accès, de
              rectification, de suppression et d&apos;opposition sur ses données personnelles.
              Pour exercer ces droits, contactez : <a href="mailto:contact@datamerry.com" style={{ color: "#00d4ff", textDecoration: "none" }}>contact@datamerry.com</a>.
            </P>
          </Section>

          {/* Article 6 */}
          <Section num={6} title="Cookies">
            <P>
              Le Site utilise des cookies analytiques (Vercel Analytics) pour mesurer la fréquentation.
              Ces cookies ne collectent aucune donnée personnelle identifiante.
              L&apos;utilisateur peut les refuser via le bandeau de consentement affiché lors de sa première visite.
            </P>
          </Section>

          {/* Article 7 */}
          <Section num={7} title="Propriété intellectuelle">
            <P>
              Les données source (DVF, DPE) sont des données publiques sous licence ouverte Etalab.
            </P>
            <P>
              Les analyses, visualisations, interfaces et algorithmes du Site sont la propriété
              de datamerry. Toute reproduction, représentation ou diffusion non autorisée, en tout
              ou partie, est interdite sauf pour un usage strictement personnel et non commercial.
            </P>
          </Section>

          {/* Article 8 */}
          <Section num={8} title="Limitation de responsabilité">
            <P>
              Les informations présentées sur le Site sont fournies à titre indicatif et informatif.
              Elles ne constituent en aucun cas un conseil en investissement immobilier, financier,
              fiscal ou juridique.
            </P>
            <P>
              datamerry s&apos;efforce de garantir l&apos;exactitude des données mais ne peut être tenu
              responsable des erreurs, omissions ou résultats obtenus à partir des informations
              diffusées. Les données DVF comportent un décalage temporel de 3 à 6 mois et
              certaines transactions peuvent être géolocalisées de manière approximative.
            </P>
            <P>
              L&apos;utilisateur est seul responsable de l&apos;usage qu&apos;il fait des informations
              consultées sur le Site.
            </P>
          </Section>

          {/* Article 9 */}
          <Section num={9} title="Liens hypertextes">
            <P>
              Le Site peut contenir des liens vers des sites tiers (data.gouv.fr, GitHub, etc.).
              datamerry n&apos;exerce aucun contrôle sur ces sites et décline toute responsabilité
              quant à leur contenu ou leur politique de confidentialité.
            </P>
          </Section>

          {/* Article 10 */}
          <Section num={10} title="Droit applicable">
            <P>
              Les présentes CGU sont soumises au droit français. En cas de litige, les parties
              s&apos;engagent à rechercher une solution amiable avant toute action judiciaire.
              À défaut, les tribunaux compétents de Paris seront seuls compétents.
            </P>
          </Section>

          {/* Article 11 */}
          <Section num={11} title="Modification des CGU">
            <P>
              datamerry se réserve le droit de modifier les présentes CGU à tout moment.
              Les utilisateurs seront informés de toute modification par la mise à jour de la
              date indiquée en haut de cette page. La poursuite de l&apos;utilisation du Site
              après modification vaut acceptation des nouvelles conditions.
            </P>
          </Section>
        </div>

        {/* Contact */}
        <div style={{
          marginTop: 56, padding: "32px", borderRadius: 16,
          border: "1px solid rgba(0,212,255,0.2)", background: "rgba(0,212,255,0.05)",
          textAlign: "center",
        }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "#fff" }}>
            Une question ?
          </h3>
          <p style={{ margin: "0 0 20px", fontSize: 14, color: "rgba(255,255,255,0.45)" }}>
            Pour toute question relative aux présentes CGU, contactez-nous.
          </p>
          <a href="mailto:contact@datamerry.com" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "12px 28px", borderRadius: 10,
            background: "linear-gradient(135deg, #00d4ff, #0099cc)",
            color: "#000", fontSize: 14, fontWeight: 700, textDecoration: "none",
          }}>
            contact@datamerry.com
          </a>
        </div>

        {/* Footer links */}
        <div style={{ marginTop: 48, textAlign: "center", display: "flex", justifyContent: "center", gap: 24, flexWrap: "wrap" }}>
          <Link href="/methodologie" style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textDecoration: "none" }}>
            Méthodologie
          </Link>
          <Link href="/actualites" style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", textDecoration: "none" }}>
            Actualités
          </Link>
        </div>
        <div style={{ marginTop: 16, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.2)" }}>
          datamerry.com · Observatoire foncier France · Source DVF data.gouv.fr
        </div>
      </div>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function Section({ num, title, children }: { num: number; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.02)",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: 12,
      padding: "24px 28px",
    }}>
      <h2 style={{ margin: "0 0 14px", fontSize: 18, fontWeight: 700, color: "#fff" }}>
        <span style={{ color: "#00d4ff", marginRight: 8 }}>Article {num}.</span>
        {title}
      </h2>
      {children}
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ margin: "0 0 12px", fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.8 }}>
      {children}
    </p>
  );
}
