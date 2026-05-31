/**
 * Landing recrutement mandataires Eurealimmo Réseau — version V2 ultra-simple.
 *
 * URL canonique : reseau.eurealimmo.com
 * URL Vercel directe : datamerry.com/eurealimmo-reseau
 *
 * Stratégie UX : zéro friction, copy direct, urgence visible.
 *   - Hero clair en 1 phrase
 *   - 6 avantages concrets (pas de jargon)
 *   - 2 prix simples
 *   - Formulaire 4 champs (Prénom / Nom / Email / Tél + 1 toggle contact)
 *   - Si code referral dans l'URL : banner premium + offre Fondateur pré-appliquée
 *
 * Stratégie virale : chaque mandataire ambassadeur (Diara, Samuel) a un code court
 *   (DIARA, SAMUEL) qui pré-applique l'offre Fondateur à 5 invités max chacun.
 *   Diara recrute son frère + son amie banquière HSBC = 2 fondateurs immédiats.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { ApplicationForm } from "./ApplicationForm";

export const metadata: Metadata = {
  title: "Rejoindre Eurealimmo Réseau",
  description:
    "Réseau de mandataires immobiliers HNWI. Carte T sous couverture, garantie financière incluse, outils DATAMERRY data, 6 mois gratuits. Réponse sous 48 h.",
  alternates: { canonical: "https://reseau.eurealimmo.com/" },
  robots: { index: true, follow: true },
};

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

type ReferralCode = {
  code: string;
  referrer_name: string;
  display_name: string | null;
  message_public: string | null;
  tier: "founder" | "standard" | "partner";
  places_remaining: number;
};

async function fetchReferralCode(rawCode: string | undefined): Promise<ReferralCode | null> {
  if (!rawCode) return null;
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9-]{2,30}$/.test(code)) return null;

  try {
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data } = await sb
      .from("v_eurealimmo_referral_codes_public")
      .select("code, referrer_name, display_name, message_public, tier, places_remaining")
      .eq("code", code)
      .maybeSingle();
    return (data as ReferralCode | null) ?? null;
  } catch {
    return null;
  }
}

export default async function EurealimmoReseauPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;
  const referral = await fetchReferralCode(ref);
  const isFounderInvite = referral?.tier === "founder";

  return (
    <main style={{ background: "#fafafa", color: DARK, minHeight: "100vh" }}>
      {/* ─── Banner referral en haut (si invité fondateur) ─────────────── */}
      {isFounderInvite && referral && (
        <div
          style={{
            background: PRIMARY,
            color: DARK,
            padding: "10px 20px",
            textAlign: "center",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: "0.02em",
          }}
        >
          ✨ Invité par {referral.display_name ?? referral.referrer_name} · Offre Fondateur ·{" "}
          <strong>Plus que {referral.places_remaining} places</strong> · Engagement 6 mois gratuits
        </div>
      )}

      {/* ─── Header ────────────────────────────────────────────────────── */}
      <header
        style={{
          background: DARK,
          padding: "18px 24px",
          borderBottom: `1px solid ${PRIMARY}40`,
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
                width: 40,
                height: 40,
                background: PRIMARY,
                color: DARK,
                fontWeight: 800,
                fontSize: 22,
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
              <div style={{ color: "white", fontSize: 15, fontWeight: 700, letterSpacing: "0.05em" }}>
                EUREALIMMO
              </div>
              <div style={{ color: PRIMARY, fontSize: 9, letterSpacing: "0.15em", fontWeight: 600 }}>
                INVESTIR · VALORISER · TRANSMETTRE
              </div>
            </div>
          </div>
          <a
            href="#rejoindre"
            style={{
              background: PRIMARY,
              color: DARK,
              padding: "10px 22px",
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: "none",
              letterSpacing: "0.02em",
            }}
          >
            Rejoindre →
          </a>
        </div>
      </header>

      {/* ─── Hero ──────────────────────────────────────────────────────── */}
      <section
        style={{
          background: `linear-gradient(135deg, ${DARK} 0%, #1e293b 100%)`,
          color: "white",
          padding: "70px 24px 60px",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          {referral && (
            <div
              style={{
                display: "inline-block",
                padding: "6px 14px",
                background: `${PRIMARY}22`,
                border: `1px solid ${PRIMARY}`,
                borderRadius: 999,
                fontSize: 11,
                color: PRIMARY,
                letterSpacing: "0.15em",
                fontWeight: 600,
                marginBottom: 24,
              }}
            >
              ✨ INVITÉ PAR {(referral.display_name ?? referral.referrer_name).toUpperCase()}
            </div>
          )}
          <h1
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 44,
              fontWeight: 700,
              lineHeight: 1.15,
              margin: "0 0 20px",
              letterSpacing: "-0.01em",
            }}
          >
            Votre carte T, vos outils data,
            <br />
            <span style={{ color: PRIMARY }}>jusqu&apos;à 95 % de vos commissions</span>.
          </h1>
          <p
            style={{
              fontSize: 18,
              lineHeight: 1.6,
              color: "#cbd5e1",
              maxWidth: 640,
              margin: "0 auto 32px",
            }}
          >
            Le réseau de mandataires immobiliers <strong style={{ color: "white" }}>premium</strong>.
            Carte T sous notre couverture, garantie financière incluse, outils DATAMERRY®.
            Réponse sous 24-48 h. <strong style={{ color: "white" }}>Aucun papier à remplir.</strong>
          </p>
          <a
            href="#rejoindre"
            style={{
              display: "inline-block",
              background: PRIMARY,
              color: DARK,
              padding: "18px 36px",
              borderRadius: 4,
              fontSize: 16,
              fontWeight: 700,
              textDecoration: "none",
              letterSpacing: "0.02em",
            }}
          >
            {isFounderInvite ? "Rejoindre (offre Fondateur)" : "Rejoindre Eurealimmo"} →
          </a>
          <div style={{ marginTop: 16, fontSize: 12, color: "#94a3b8" }}>
            Carte T n° CPI 7501 2024 000 219 · SARL EUREALIMMO · SIREN 984 449 470
          </div>
        </div>
      </section>

      {/* ─── 6 avantages ───────────────────────────────────────────────── */}
      <section style={{ padding: "70px 24px", background: "white" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 32,
              fontWeight: 700,
              textAlign: "center",
              margin: "0 0 12px",
            }}
          >
            Ce qu&apos;Eurealimmo vous apporte
          </h2>
          <p style={{ textAlign: "center", color: "#64748b", maxWidth: 560, margin: "0 auto 40px" }}>
            Concret, sans jargon. Voici ce que vous obtenez en signant.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 20,
            }}
          >
            <Advantage
              icon="🛡️"
              title="Carte T sous couverture"
              text="Vous exercez sous notre carte CPI 7501 2024 000 219. Pas de garantie financière à souscrire (~1 200 € économisés/an)."
            />
            <Advantage
              icon="💎"
              title="92-95 % nets sur vos ventes"
              text="Standard : 92 % nets (retenue 8 %, 20 % moins qu'Olean). Fondateur : 95 % nets (retenue 5 %)."
            />
            <Advantage
              icon="📊"
              title="DATAMERRY® inclus"
              text="11 M de transactions DVF, micro-marchés HDBSCAN, IDFM PRIM, INSEE. Estimation data en 30 sec."
            />
            <Advantage
              icon="🎓"
              title="Suivi Loi ALUR automatique"
              text="Rappels avant échéance des 14 h annuelles + plateformes partenaires recommandées (Studi, Visioformation, Diloy). À votre charge mais cadré."
            />
            <Advantage
              icon="⛓️"
              title="Empreinte cryptographique des mandats"
              text="Hash SHA256 horodaté de chaque mandat dès aujourd'hui. Ancrage on-chain Solana via Merkle Root prévu en Y2 (2027)."
            />
            <Advantage
              icon="🤝"
              title="Tout digital"
              text="Signature électronique sécurisée, contrat sous 7 jours, opérationnel sous 15-30 jours."
            />
          </div>
        </div>
      </section>

      {/* ─── 2 formules ────────────────────────────────────────────────── */}
      <section style={{ padding: "70px 24px", background: "#fafafa" }} id="tarifs">
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 32,
              fontWeight: 700,
              textAlign: "center",
              margin: "0 0 40px",
            }}
          >
            Tarifs
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
              gap: 24,
            }}
          >
            <PricingCard
              tier="Standard"
              price="79 €"
              priceSuffix="/mois HT"
              bullets={[
                "Carte T sous couverture (économie 1 200 €/an)",
                "DATAMERRY® illimité (vs 588 €/an séparé chez Olean)",
                "8 % de retenue (20 % moins qu'Olean à 10 %)",
                "Suivi ALUR automatique (rappels avant échéance)",
                "Engagement mensuel sans durée minimale",
                "Support 5j/7 par email",
                "+ 50 € frais CCI Paris à l'inscription (RCO)",
              ]}
              cta="Rejoindre Standard"
            />
            <PricingCard
              tier="Fondateur"
              badge={referral?.tier === "founder" ? `${referral.places_remaining} places restantes` : "40 places — exclusif"}
              price="59 €"
              priceSuffix="/mois HT"
              highlighted
              preselected={isFounderInvite}
              bullets={[
                "Tout l'offre Standard",
                "✨ 6 mois gratuits à l'entrée",
                "5 % de retenue (vs 8 % grille publique)",
                "Verrouillage tarifaire 36 mois",
                "18 % à vie sur tout HNWI que vous apportez",
                "Accès prioritaire outils en bêta",
                "Accès direct à Samuel BRUNO les 12 premiers mois",
                "+ 50 € frais CCI Paris à l'inscription (RCO)",
              ]}
              cta={isFounderInvite ? "Rejoindre (place réservée)" : "Demander une place Fondateur"}
            />
          </div>
        </div>
      </section>

      {/* ─── Transparence frais (à votre charge) ───────────────────────── */}
      <section style={{ padding: "70px 24px", background: "white" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 32,
              fontWeight: 700,
              textAlign: "center",
              margin: "0 0 12px",
            }}
          >
            Transparence totale sur vos frais
          </h2>
          <p style={{ textAlign: "center", color: "#64748b", maxWidth: 640, margin: "0 auto 40px" }}>
            Eurealimmo ne facture que le forfait mensuel. Voici les autres frais que <strong>tout</strong> agent
            commercial immobilier doit prévoir — légaux et incompressibles, peu importe le réseau.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 20,
              marginBottom: 24,
            }}
          >
            {/* One-shot */}
            <div
              style={{
                padding: 24,
                background: "#fafafa",
                borderTop: `4px solid ${PRIMARY}`,
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.15em",
                  color: PRIMARY,
                  fontWeight: 700,
                  marginBottom: 12,
                }}
              >
                ONE-SHOT À L&apos;INSCRIPTION
              </div>
              <CostLine label="Déclaration RCO à la CCI Paris" amount="50 €" note="obligatoire (art. R.134-6 C. com.)" />
              <CostLine label="Formation Loi ALUR initiale (14 h)" amount="150-200 €" note="via partenaires recommandés" />
              <CostLine
                label="Création société / micro-entreprise"
                amount="0-400 €"
                note="auto-entrepreneur : 0 € · SASU/EURL : 200-400 €"
              />
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px solid #e2e8f0",
                  fontSize: 13,
                  fontWeight: 700,
                  color: DARK,
                }}
              >
                Total estimé : <span style={{ color: PRIMARY }}>200-650 €</span> au lancement
              </div>
            </div>

            {/* Récurrent annuel */}
            <div
              style={{
                padding: 24,
                background: "#fafafa",
                borderTop: `4px solid ${PRIMARY}`,
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.15em",
                  color: PRIMARY,
                  fontWeight: 700,
                  marginBottom: 12,
                }}
              >
                RÉCURRENT ANNUEL
              </div>
              <CostLine
                label="Assurance RCP agent commercial"
                amount="150-200 €/an"
                note="obligatoire — à souscrire personnellement"
              />
              <CostLine
                label="Formation continue ALUR"
                amount="~70 €/an"
                note="14 h/an OU 42 h sur 3 ans cumulables"
              />
              <CostLine
                label="Cotisations sociales (URSSAF / SSI)"
                amount="variable"
                note="selon votre statut et CA — non couvertes par Eurealimmo"
              />
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px solid #e2e8f0",
                  fontSize: 13,
                  fontWeight: 700,
                  color: DARK,
                }}
              >
                Total fixe : <span style={{ color: PRIMARY }}>~220-270 €/an</span>
              </div>
            </div>

            {/* Récurrent mensuel */}
            <div
              style={{
                padding: 24,
                background: DARK,
                color: "white",
                borderTop: `4px solid ${PRIMARY}`,
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: "0.15em",
                  color: PRIMARY,
                  fontWeight: 700,
                  marginBottom: 12,
                }}
              >
                RÉCURRENT MENSUEL
              </div>
              <CostLine
                label="Forfait Eurealimmo Standard"
                amount="79 € HT/mo"
                note="carte T + DATAMERRY illimité — 94,80 € TTC"
                dark
              />
              <CostLine
                label="Forfait Eurealimmo Fondateur"
                amount="59 € HT/mo"
                note="6 mois gratuits — 70,80 € TTC"
                dark
              />
              <CostLine
                label="Retenue sur vos commissions"
                amount="5 % ou 8 %"
                note="seulement quand vous vendez — pas d'avance"
                dark
              />
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px solid #334155",
                  fontSize: 12,
                  color: "#cbd5e1",
                  lineHeight: 1.6,
                }}
              >
                Eurealimmo prélève uniquement quand vous gagnez. Pas de minimum d&apos;activité.
              </div>
            </div>
          </div>

          <div
            style={{
              padding: "20px 24px",
              background: "#fef3c7",
              borderLeft: `4px solid #d97706`,
              borderRadius: 4,
              fontSize: 13,
              lineHeight: 1.7,
              color: "#78350f",
            }}
          >
            <strong style={{ display: "block", marginBottom: 6, color: "#78350f" }}>
              ⚠️ Ce qu&apos;Eurealimmo ne couvre PAS (vous restez indépendant) :
            </strong>
            Votre <strong>RCP personnelle</strong> (notre RC pro couvre uniquement la SARL Eurealimmo, pas vos
            actes individuels) · Vos <strong>cotisations sociales</strong> (URSSAF/SSI selon statut) · Vos{" "}
            <strong>frais de prospection</strong> (déplacements, téléphone, marketing perso) · Votre{" "}
            <strong>fiscalité personnelle</strong> (IR ou IS selon structure)
          </div>

          <p
            style={{
              textAlign: "center",
              fontSize: 13,
              color: "#64748b",
              marginTop: 32,
              lineHeight: 1.7,
              maxWidth: 720,
              marginLeft: "auto",
              marginRight: "auto",
            }}
          >
            <strong>Comparaison utile :</strong> sur 50 000 €/an de commissions, vous économisez{" "}
            <strong style={{ color: DARK }}>~1 000 €/an</strong> chez Eurealimmo Standard vs Olean (10 %), et{" "}
            <strong style={{ color: DARK }}>~1 800 €/an</strong> en Fondateur. Sur 200 000 €/an de
            commissions (profil HWNI), l&apos;économie atteint{" "}
            <strong style={{ color: DARK }}>~3 000 € à ~9 300 €/an</strong>.
          </p>
        </div>
      </section>

      {/* ─── Comment ça marche (4 étapes) ──────────────────────────────── */}
      <section style={{ padding: "70px 24px", background: "white" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 32,
              fontWeight: 700,
              textAlign: "center",
              margin: "0 0 12px",
            }}
          >
            Comment ça marche
          </h2>
          <p style={{ textAlign: "center", color: "#64748b", maxWidth: 560, margin: "0 auto 40px" }}>
            15 à 30 jours du formulaire au premier mandat. Pas de RDV physique. Pas de paperasse.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 24,
            }}
          >
            <Step num="01" title="Vous remplissez" text="Le formulaire ci-dessous (2 minutes)." />
            <Step num="02" title="On vous appelle" text="Sous 24-48 h. Validation rapide." />
            <Step num="03" title="Contrat signé" text="Signature électronique sécurisée, sous 7 jours." />
            <Step num="04" title="Opérationnel" text="Déclaration CCI (50 €) puis accès DATAMERRY sous 48 h après validation." />
          </div>
        </div>
      </section>

      {/* ─── FAQ courte ────────────────────────────────────────────────── */}
      <section style={{ padding: "70px 24px", background: "#fafafa" }}>
        <div style={{ maxWidth: 760, margin: "0 auto" }}>
          <h2
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 32,
              fontWeight: 700,
              textAlign: "center",
              margin: "0 0 40px",
            }}
          >
            Questions fréquentes
          </h2>
          <Faq
            q="Faut-il avoir sa propre carte T ?"
            a="Non. Vous exercez sous la nôtre (CPI 7501 2024 000 219). Économie ~1 200 €/an de garantie financière."
          />
          <Faq
            q="Combien je gagne vraiment ?"
            a="Standard : 92 % de votre commission (retenue 8 %, 20 % moins qu'Olean à 10 %). Fondateur : 95 % (retenue 5 %). Sur une vente HNWI à 2 M€ (com agence 4 %), vous percevez 73 600 € net en Standard ou 76 000 € en Fondateur. Comparez à SAFTI/IAD où vous toucheriez ~55 000 €."
          />
          <Faq
            q="Je peux garder mon réseau actuel (SAFTI/IAD/Olean) en parallèle ?"
            a="Oui, si votre contrat n'a pas de clause d'exclusivité dure. Double-affiliation possible pendant la transition. On valide ça au téléphone."
          />
          <Faq
            q="Combien de temps avant le premier mandat ?"
            a="15 à 30 jours. Formulaire → call 48 h → contrat 7 j → déclaration RCO à la CCI Paris (3-7 j) → onboarding 48 h. Le délai dépend principalement du retour de la CCI."
          />
          <Faq
            q="Quels sont TOUS les frais à prévoir pour démarrer ?"
            a="Au lancement (one-shot) : 50 € déclaration CCI Paris (RCO) + 150-200 € formation Loi ALUR initiale + 0 à 400 € création de votre structure (auto-entrepreneur : 0 € · SASU/EURL : ~200-400 €) = 200 à 650 € au total. En récurrent annuel : 150-200 € pour votre RCP agent commercial (obligatoire, à souscrire personnellement) + ~70 €/an équivalent formation continue ALUR + vos cotisations URSSAF/SSI. En récurrent mensuel : votre forfait Eurealimmo (59 € ou 79 € HT). Aucun frais Eurealimmo à l'inscription en plus du 1er forfait mensuel. Voir la section Transparence ci-dessus pour le détail."
          />
          <Faq
            q="L'assurance RC pro Eurealimmo me couvre-t-elle personnellement ?"
            a="Non. Notre RC pro couvre uniquement la SARL Eurealimmo en tant que titulaire de la carte T. En tant qu'agent commercial indépendant, vous devez souscrire votre propre Responsabilité Civile Professionnelle (RCP agent commercial immobilier). Comptez 150-200 €/an. C'est obligatoire pour exercer — peu importe le réseau qui vous porte. Nous pouvons vous orienter vers des courtiers partenaires."
          />
          <Faq
            q="Que fait DATAMERRY exactement ?"
            a="Estimation immobilière en 30 sec à partir de 11 millions de transactions DVF + micro-marchés HDBSCAN + INSEE + transports IDFM. Vous arrivez chez un vendeur avec un PDF pro de 2 pages avant même la visite."
          />
          <Faq
            q="Programme referral 18 % à vie : comment ça marche ?"
            a="Vous nous présentez un autre mandataire HNWI qui signe. Vous touchez 18 % à vie sur les retenues que nous percevons sur ses ventes (5 % ou 8 %). Cumul illimité — c'est notre vrai jackpot pour vous."
          />
          <Faq
            q="TVA : comment ça marche concrètement ?"
            a="Eurealimmo facture HT + 20 % TVA (forfait 79 € HT = 94,80 € TTC). Si vous êtes en franchise TVA (micro-BNC < 36 800 €/an), vous ne récupérez pas cette TVA. Dès dépassement du seuil, vous récupérez 20 % et votre coût réel revient à 79 € HT. Nous recommandons un comptable partenaire pour anticiper cette bascule."
          />
        </div>
      </section>

      {/* ─── Formulaire ────────────────────────────────────────────────── */}
      <section id="rejoindre" style={{ padding: "70px 24px", background: DARK }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <h2
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 36,
                fontWeight: 700,
                color: "white",
                margin: 0,
              }}
            >
              Rejoindre Eurealimmo
            </h2>
            <p style={{ color: "#cbd5e1", marginTop: 12, fontSize: 14 }}>
              2 minutes. On vous appelle sous 24-48 h. Aucun spam.
            </p>
          </div>
          <ApplicationForm referral={referral} />
        </div>
      </section>

      {/* ─── Footer ────────────────────────────────────────────────────── */}
      <footer style={{ padding: "30px 24px", background: "#020617", color: "#94a3b8", fontSize: 11, lineHeight: 1.7 }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center" }}>
          <div style={{ color: "white", fontWeight: 700, marginBottom: 6 }}>EUREALIMMO</div>
          <div>SARL · SIREN 984 449 470 · RCS Paris · 60 Rue François 1<sup>er</sup>, 75008 Paris</div>
          <div>Carte professionnelle T n° CPI 7501 2024 000 219 (CCI Paris Île-de-France)</div>
          <div style={{ marginTop: 14, color: "#475569" }}>
            © {new Date().getFullYear()} EUREALIMMO · Conforme loi Hoguet n° 70-9 ·{" "}
            <a href="mailto:contact@datamerry.com" style={{ color: PRIMARY }}>contact@datamerry.com</a>{" · "}
            <Link href="/legal/mentions-legales" style={{ color: "#64748b", textDecoration: "underline" }}>
              Mentions légales
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
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: DARK }}>{title}</div>
      <div style={{ fontSize: 13, lineHeight: 1.6, color: "#475569" }}>{text}</div>
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
  preselected,
}: {
  tier: string;
  price: string;
  priceSuffix: string;
  bullets: string[];
  cta: string;
  highlighted?: boolean;
  badge?: string;
  preselected?: boolean;
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
        boxShadow: preselected ? `0 0 0 4px ${PRIMARY}30` : "none",
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
        href="#rejoindre"
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
        }}
      >
        {cta}
      </a>
    </div>
  );
}

function Step({ num, title, text }: { num: string; title: string; text: string }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div
        style={{
          fontFamily: "Georgia, serif",
          fontSize: 36,
          color: PRIMARY,
          fontWeight: 700,
          lineHeight: 1,
          marginBottom: 12,
        }}
      >
        {num}
      </div>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6, color: DARK }}>{title}</div>
      <div style={{ fontSize: 12, lineHeight: 1.6, color: "#64748b" }}>{text}</div>
    </div>
  );
}

function CostLine({
  label,
  amount,
  note,
  dark,
}: {
  label: string;
  amount: string;
  note?: string;
  dark?: boolean;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 12,
          fontSize: 13,
          fontWeight: 600,
          color: dark ? "white" : DARK,
        }}
      >
        <span>{label}</span>
        <span style={{ color: PRIMARY, fontWeight: 700, whiteSpace: "nowrap" }}>{amount}</span>
      </div>
      {note && (
        <div style={{ fontSize: 11, color: dark ? "#94a3b8" : "#64748b", marginTop: 2, lineHeight: 1.5 }}>
          {note}
        </div>
      )}
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <details
      style={{
        background: "white",
        borderRadius: 6,
        padding: "16px 20px",
        marginBottom: 10,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      <summary
        style={{
          fontWeight: 700,
          fontSize: 15,
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
