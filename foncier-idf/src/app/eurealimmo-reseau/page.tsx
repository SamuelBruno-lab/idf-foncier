/**
 * Landing recrutement mandataires Eurealimmo Réseau.
 *
 * URL canonique : reseau.eurealimmo.com (via middleware + DNS CNAME → Vercel)
 * URL Vercel directe : datamerry.com/eurealimmo-reseau
 *
 * Objectif business : recruter 30 mandataires (mix HNWI + standard expérimenté)
 * en 12 mois pour atteindre le break-even cabinet Eurealimmo (~15 k€/mo net).
 *
 * Cible :
 *   - HNWI ex-banque privée (ex-HSBC, BNP, SG Privée, Indosuez…)
 *   - Mandataires expérimentés (3-10 ans) chez SAFTI / IAD / Capifrance qui veulent
 *     leur indépendance et un meilleur taux de rétrocession
 *   - Reconversion immobilier formés (Studi, ESI Business School, etc.)
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ApplicationForm } from "./ApplicationForm";

export const metadata: Metadata = {
  title: "Devenir mandataire — Eurealimmo Réseau",
  description:
    "Rejoignez Eurealimmo Réseau : carte T sous couverture, garantie financière incluse, outils data DATAMERRY®, 6 mois gratuits, commission 5%. Modèle dédié aux mandataires HNWI et expérimentés.",
  alternates: { canonical: "https://reseau.eurealimmo.com/" },
  robots: { index: true, follow: true },
};

const PRIMARY = "#c8a25d"; // or doré Eurealimmo
const DARK = "#0f172a"; // slate-900

export default function EurealimmoReseauPage() {
  return (
    <main style={{ background: "#fafafa", color: DARK, minHeight: "100vh" }}>
      {/* ─── Header ───────────────────────────────────────────────── */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "rgba(15, 23, 42, 0.95)",
          backdropFilter: "blur(8px)",
          borderBottom: `1px solid ${PRIMARY}40`,
          padding: "14px 24px",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                background: PRIMARY,
                color: DARK,
                fontWeight: 800,
                fontSize: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                fontFamily: "Georgia, serif",
              }}
            >
              E
            </div>
            <div>
              <div style={{ color: "white", fontSize: 14, fontWeight: 700, letterSpacing: "0.05em" }}>
                EUREALIMMO
              </div>
              <div style={{ color: PRIMARY, fontSize: 9, letterSpacing: "0.15em", fontWeight: 600 }}>
                INVESTIR · VALORISER · TRANSMETTRE
              </div>
            </div>
          </div>
          <a
            href="#postuler"
            style={{
              background: PRIMARY,
              color: DARK,
              padding: "10px 20px",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
              letterSpacing: "0.02em",
            }}
          >
            Postuler
          </a>
        </div>
      </header>

      {/* ─── Hero ────────────────────────────────────────────────── */}
      <section
        style={{
          background: `linear-gradient(135deg, ${DARK} 0%, #1e293b 100%)`,
          color: "white",
          padding: "80px 24px",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <div
            style={{
              display: "inline-block",
              padding: "6px 14px",
              border: `1px solid ${PRIMARY}80`,
              borderRadius: 999,
              fontSize: 11,
              color: PRIMARY,
              letterSpacing: "0.15em",
              fontWeight: 600,
              marginBottom: 24,
            }}
          >
            RÉSEAU FRANCE · CARTE T 7501 2024 000 219
          </div>
          <h1
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 48,
              fontWeight: 700,
              lineHeight: 1.15,
              margin: "0 0 20px",
              letterSpacing: "-0.01em",
            }}
          >
            Le réseau de mandataires immobiliers
            <br />
            <span style={{ color: PRIMARY }}>data-driven, premium</span>, conforme.
          </h1>
          <p
            style={{
              fontSize: 18,
              lineHeight: 1.6,
              color: "#cbd5e1",
              maxWidth: 720,
              margin: "0 auto 36px",
            }}
          >
            Rejoignez Eurealimmo et exercez votre métier de mandataire avec les meilleurs
            outils data du marché (DATAMERRY®), notre carte T qui vous couvre, et une
            rémunération à <strong style={{ color: "white" }}>95 % nette</strong> sur vos commissions.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <a
              href="#postuler"
              style={{
                background: PRIMARY,
                color: DARK,
                padding: "16px 32px",
                borderRadius: 4,
                fontSize: 15,
                fontWeight: 700,
                textDecoration: "none",
                letterSpacing: "0.02em",
              }}
            >
              Candidater au réseau →
            </a>
            <a
              href="#tarifs"
              style={{
                background: "transparent",
                color: PRIMARY,
                padding: "16px 32px",
                borderRadius: 4,
                fontSize: 15,
                fontWeight: 700,
                textDecoration: "none",
                border: `1.5px solid ${PRIMARY}`,
              }}
            >
              Voir les tarifs
            </a>
          </div>
        </div>
      </section>

      {/* ─── Pourquoi nous rejoindre ──────────────────────────────── */}
      <section style={{ padding: "80px 24px", background: "white" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <SectionTitle eyebrow="Avantages" title="Pourquoi nous rejoindre" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 24,
              marginTop: 40,
            }}
          >
            <Advantage
              icon="🏛️"
              title="Carte T sous notre couverture"
              text="Pas besoin de souscrire votre propre carte T. Vous exercez sous la carte professionnelle Eurealimmo n° CPI 7501 2024 000 219 (CCI Paris), garantie financière incluse — économie ~1 200 €/an."
            />
            <Advantage
              icon="📊"
              title="DATAMERRY® inclus"
              text="Accès illimité à notre stack de données : 11 millions de transactions DVF, clustering HDBSCAN micro-marchés, IDFM PRIM, INSEE Filosofi, paris-distance. Estimation data-driven en 30 secondes."
            />
            <Advantage
              icon="💎"
              title="Commission 95 % nette"
              text="Vous conservez 95 % de votre commission. Nous prenons 5 % seulement pour couvrir la carte T, la RC pro structure, les outils DATAMERRY et la formation continue Loi ALUR."
            />
            <Advantage
              icon="🎓"
              title="Formation Loi ALUR"
              text="14h de formation continue par an obligatoires (loi ALUR). Partenariats avec Studi, Visioformation, Diloy — tarifs négociés et tracking automatique du suivi."
            />
            <Advantage
              icon="⛓️"
              title="Registre des mandats blockchain"
              text="Vos mandats signés sont notarisés on-chain sur Solana via Merkle Root mensuel. Preuve cryptographique d'antériorité conforme CNIL délibération 2018-303. Différenciateur unique vs SAFTI/IAD/Capifrance."
            />
            <Advantage
              icon="🤝"
              title="6 mois gratuits"
              text="Option Fondateur (40 premiers mandataires) : 6 mois sans abonnement à l'entrée pour tester le réseau sans risque. Engagement 36 mois ensuite."
            />
          </div>
        </div>
      </section>

      {/* ─── Pour qui ? ───────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px", background: "#fafafa" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <SectionTitle eyebrow="Profil idéal" title="Pour qui ?" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 20,
              marginTop: 40,
            }}
          >
            <ProfileCard
              tier="HNWI"
              title="Ex-banque privée"
              examples="HSBC Privée · BNP Banque Privée · Société Générale Privée · Indosuez · Pictet"
              fit="Vous avez un carnet de clients fortunés et cherchez une plateforme pour transformer ces contacts en mandats. Tickets moyens 1-10 M€."
            />
            <ProfileCard
              tier="EXPÉRIMENTÉ"
              title="Mandataire confirmé"
              examples="SAFTI · IAD · Capifrance · Optimhome · La Boîte Immo · indépendants Carte T"
              fit="3+ ans d'expérience, vous voulez plus de rétrocession (95% vs 70%), de meilleurs outils, et un réseau spécialisé qui élève votre image."
            />
            <ProfileCard
              tier="RECONVERSION"
              title="Junior formé"
              examples="Studi · ESI Business School · Diloy · diplômes BTS Pro Immo récents"
              fit="Vous démarrez votre carrière mandataire et cherchez un cadre structuré avec carte T, formation continue, et outils data pour vous différencier."
            />
          </div>
        </div>
      </section>

      {/* ─── Tarifs ───────────────────────────────────────────────── */}
      <section id="tarifs" style={{ padding: "80px 24px", background: "white" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <SectionTitle eyebrow="Tarification" title="Deux formules" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 24,
              marginTop: 40,
            }}
          >
            <PricingCard
              tier="Standard"
              price="39 €"
              priceSuffix="/mois HT"
              bullets={[
                "Carte T sous couverture Eurealimmo",
                "Garantie financière incluse",
                "Accès DATAMERRY® illimité",
                "Commission 5 % sur vos ventes",
                "Support 5j/7 par email",
                "Engagement mensuel — sans durée minimale",
              ]}
              cta="Postuler"
            />
            <PricingCard
              tier="Fondateur"
              badge="40 premières places"
              price="59 €"
              priceSuffix="/mois HT"
              highlighted
              bullets={[
                "Tout l'offre Standard",
                "6 mois gratuits à l'entrée",
                "Engagement 36 mois",
                "Commission 5 % uniquement",
                "Referral 18 % à vie sur tout mandataire HNWI que vous apportez",
                "Accès prioritaire aux outils en bêta (registre blockchain Y2)",
                "Hotline dédiée + onboarding personnalisé",
              ]}
              cta="Postuler à l'Option Fondateur"
            />
          </div>
        </div>
      </section>

      {/* ─── Process ──────────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px", background: "#fafafa" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <SectionTitle eyebrow="Process" title="Comment ça marche" />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 20,
              marginTop: 40,
            }}
          >
            <Step
              num="01"
              title="Candidature"
              text="Vous remplissez le formulaire ci-dessous (5 min). Nous recevons un email immédiat."
            />
            <Step
              num="02"
              title="Entretien"
              text="Call de 30 min avec Samuel BRUNO sous 48h ouvrées pour valider la cohérence du projet."
            />
            <Step
              num="03"
              title="Signature contrat"
              text="Contrat de mandataire conforme loi Hoguet, signature électronique eIDAS. Sous 7 jours."
            />
            <Step
              num="04"
              title="Onboarding"
              text="Setup carte T RCO, accès DATAMERRY, formation Loi ALUR, intégration au CRM Eurealimmo."
            />
          </div>
        </div>
      </section>

      {/* ─── FAQ ──────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px", background: "white" }}>
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <SectionTitle eyebrow="Questions" title="Foire aux questions" />
          <div style={{ marginTop: 40 }}>
            <Faq
              q="Faut-il avoir sa propre carte T ?"
              a="Non. Vous exercez sous notre carte professionnelle Eurealimmo (CPI 7501 2024 000 219) en tant qu'agent commercial. Vous économisez ~1 200 €/an de garantie financière et n'avez pas à gérer la conformité Hoguet."
            />
            <Faq
              q="Combien gagne réellement un mandataire chez vous ?"
              a="Vous touchez 95 % de la commission sur vos ventes. Sur une vente à 500 000 € (com agence 3 %), vous percevez 14 250 € net (95 % de 15 000 €). Comparez à SAFTI/IAD/Capifrance où vous touchez 60-70 %."
            />
            <Faq
              q="Puis-je continuer mon activité actuelle chez SAFTI / IAD / Olean en parallèle ?"
              a="Oui, sous réserve que votre contrat actuel ne contienne pas de clause d'exclusivité dure. Vous pouvez avoir une double-affiliation pendant votre période de transition. Nous validons cela ensemble lors du call."
            />
            <Faq
              q="Combien de temps pour devenir actif ?"
              a="7 jours ouvrés du formulaire à votre premier mandat. Étapes : candidature → entretien (48h) → contrat (3 jours) → onboarding DATAMERRY + carte T RCO (3 jours)."
            />
            <Faq
              q="Quels secteurs géographiques couvrez-vous ?"
              a="France entière. Notre force est l'Île-de-France (cluster HDBSCAN ultra-fin pour Paris + 78/91/92/93/94/95), mais nous accompagnons les ventes en province via DVF national."
            />
            <Faq
              q="Quel est le programme de referral 18 % ?"
              a="Si vous nous présentez un autre mandataire HNWI qui rejoint Eurealimmo, vous touchez 18 % à vie sur la commission DATAMERRY générée par ses ventes. C'est cumulable sans plafond."
            />
          </div>
        </div>
      </section>

      {/* ─── Formulaire candidature ───────────────────────────────── */}
      <section id="postuler" style={{ padding: "80px 24px", background: DARK }}>
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div
              style={{
                color: PRIMARY,
                fontSize: 11,
                letterSpacing: "0.15em",
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              CANDIDATURE
            </div>
            <h2
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 36,
                fontWeight: 700,
                color: "white",
                margin: 0,
              }}
            >
              Rejoindre le réseau
            </h2>
            <p style={{ color: "#cbd5e1", marginTop: 12 }}>
              Réponse sous 48 h ouvrées. Toutes les informations restent strictement confidentielles.
            </p>
          </div>
          <ApplicationForm />
        </div>
      </section>

      {/* ─── Footer mentions légales Hoguet ───────────────────────── */}
      <footer style={{ padding: "40px 24px", background: "#020617", color: "#94a3b8", fontSize: 11, lineHeight: 1.7 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 }}>
            <div>
              <div style={{ color: "white", fontWeight: 700, marginBottom: 8 }}>EUREALIMMO</div>
              <div>SARL au capital social</div>
              <div>SIREN 984 449 470 — RCS Paris</div>
              <div>Siège : 60 Rue François 1<sup>er</sup>, 75008 Paris</div>
            </div>
            <div>
              <div style={{ color: "white", fontWeight: 700, marginBottom: 8 }}>Carte professionnelle</div>
              <div>Carte T n° CPI 7501 2024 000 219</div>
              <div>Délivrée par CCI Paris Île-de-France</div>
              <div>Activité : transactions sur immeubles &amp; fonds de commerce</div>
            </div>
            <div>
              <div style={{ color: "white", fontWeight: 700, marginBottom: 8 }}>Contact</div>
              <div>
                <a href="mailto:contact@datamerry.com" style={{ color: PRIMARY, textDecoration: "none" }}>
                  contact@datamerry.com
                </a>
              </div>
              <div>Représenté par Samuel BRUNO, Président</div>
            </div>
          </div>
          <div style={{ marginTop: 30, paddingTop: 20, borderTop: "1px solid #1e293b", textAlign: "center" }}>
            © {new Date().getFullYear()} EUREALIMMO — Tous droits réservés. Conforme loi Hoguet n° 70-9 et décret 72-678.
            {" · "}
            <Link href="/legal/mentions-legales" style={{ color: "#64748b", textDecoration: "underline" }}>
              Mentions légales
            </Link>
            {" · "}
            <Link href="/legal/cgu" style={{ color: "#64748b", textDecoration: "underline" }}>
              CGU
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Sub-components
// ══════════════════════════════════════════════════════════════════════════

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          color: PRIMARY,
          fontSize: 11,
          letterSpacing: "0.15em",
          fontWeight: 600,
          marginBottom: 8,
        }}
      >
        {eyebrow.toUpperCase()}
      </div>
      <h2
        style={{
          fontFamily: "Georgia, serif",
          fontSize: 36,
          fontWeight: 700,
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h2>
    </div>
  );
}

function Advantage({ icon, title, text }: { icon: string; title: string; text: string }) {
  return (
    <div
      style={{
        padding: 24,
        background: "#fafafa",
        borderLeft: `3px solid ${PRIMARY}`,
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 10 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: DARK }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: "#475569" }}>{text}</div>
    </div>
  );
}

function ProfileCard({
  tier,
  title,
  examples,
  fit,
}: {
  tier: string;
  title: string;
  examples: string;
  fit: string;
}) {
  return (
    <div
      style={{
        padding: 28,
        background: "white",
        borderRadius: 8,
        border: "1px solid #e2e8f0",
      }}
    >
      <div
        style={{
          display: "inline-block",
          padding: "4px 10px",
          background: PRIMARY + "22",
          color: PRIMARY,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.1em",
          borderRadius: 999,
          marginBottom: 12,
        }}
      >
        {tier}
      </div>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 700, color: DARK, marginBottom: 10 }}>
        {title}
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 12, fontStyle: "italic" }}>{examples}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: "#475569" }}>{fit}</div>
    </div>
  );
}

function PricingCard({
  tier,
  price,
  priceSuffix,
  bullets,
  cta,
  highlighted,
  badge,
}: {
  tier: string;
  price: string;
  priceSuffix: string;
  bullets: string[];
  cta: string;
  highlighted?: boolean;
  badge?: string;
}) {
  return (
    <div
      style={{
        padding: 32,
        background: highlighted ? DARK : "white",
        color: highlighted ? "white" : DARK,
        borderRadius: 8,
        border: highlighted ? `2px solid ${PRIMARY}` : "1px solid #e2e8f0",
        position: "relative",
      }}
    >
      {badge && (
        <div
          style={{
            position: "absolute",
            top: -12,
            right: 24,
            background: PRIMARY,
            color: DARK,
            padding: "4px 12px",
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.1em",
          }}
        >
          {badge}
        </div>
      )}
      <div
        style={{
          color: highlighted ? PRIMARY : "#94a3b8",
          fontSize: 11,
          letterSpacing: "0.15em",
          fontWeight: 600,
          marginBottom: 12,
        }}
      >
        {tier.toUpperCase()}
      </div>
      <div style={{ marginBottom: 24 }}>
        <span style={{ fontFamily: "Georgia, serif", fontSize: 42, fontWeight: 700 }}>{price}</span>
        <span style={{ fontSize: 13, color: highlighted ? "#cbd5e1" : "#94a3b8", marginLeft: 6 }}>{priceSuffix}</span>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 28px" }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 10, paddingLeft: 22, position: "relative" }}>
            <span style={{ position: "absolute", left: 0, color: PRIMARY, fontWeight: 700 }}>✓</span>
            {b}
          </li>
        ))}
      </ul>
      <a
        href="#postuler"
        style={{
          display: "block",
          textAlign: "center",
          background: highlighted ? PRIMARY : "transparent",
          color: highlighted ? DARK : PRIMARY,
          padding: "14px 24px",
          borderRadius: 4,
          fontSize: 14,
          fontWeight: 700,
          textDecoration: "none",
          border: highlighted ? "none" : `1.5px solid ${PRIMARY}`,
          letterSpacing: "0.02em",
        }}
      >
        {cta}
      </a>
    </div>
  );
}

function Step({ num, title, text }: { num: string; title: string; text: string }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "Georgia, serif",
          fontSize: 48,
          color: PRIMARY,
          fontWeight: 700,
          lineHeight: 1,
          marginBottom: 12,
        }}
      >
        {num}
      </div>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8, color: DARK }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: "#475569" }}>{text}</div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details
      style={{
        borderBottom: "1px solid #e2e8f0",
        padding: "20px 0",
      }}
    >
      <summary
        style={{
          fontWeight: 700,
          fontSize: 16,
          color: DARK,
          cursor: "pointer",
          listStyle: "none",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {q}
        <span style={{ color: PRIMARY, fontSize: 20 }}>+</span>
      </summary>
      <div style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: "#475569" }}>{a}</div>
    </details>
  );
}

