import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Méthodologie et Transparence — datamerry · Observatoire foncier IA",
  description:
    "Sources de données, traitements algorithmiques et engagements de transparence de datamerry. Données DVF, DPE, analyse de micro-marchés, open data.",
};

const SECTIONS = [
  {
    icon: "📡",
    title: "Sources de données",
    color: "#00d4ff",
    items: [
      {
        label: "DVF (Demandes de Valeurs Foncières)",
        desc: "Base exhaustive des transactions immobilières publiée par la DGFiP sur data.gouv.fr. Chaque vente enregistrée en France depuis 2019 y figure avec prix, surface, type de bien et localisation.",
      },
      {
        label: "DPE (Diagnostics de Performance Énergétique)",
        desc: "Données ouvertes de l'ADEME couvrant les diagnostics énergétiques des logements. Utilisées pour enrichir les analyses communales avec la performance énergétique du parc.",
      },
      {
        label: "Référentiels géographiques",
        desc: "Contours communaux et départementaux issus de l'IGN (Admin Express) et de l'INSEE pour le maillage territorial.",
      },
    ],
  },
  {
    icon: "⚙️",
    title: "Traitements et algorithmes",
    color: "#00ff88",
    items: [
      {
        label: "Nettoyage et normalisation",
        desc: "Les transactions aberrantes (prix au m² extrêmes, surfaces nulles, doublons) sont filtrées automatiquement. Les adresses sont géocodées et rattachées à leur commune via les codes INSEE.",
      },
      {
        label: "Identification des micro-marchés",
        desc: "Notre pipeline d'analyse spatiale repose sur un algorithme de clustering qui détecte les micro-marchés immobiliers à partir des transactions réelles. Contrairement aux approches classiques qui découpent le territoire en quartiers administratifs arbitraires, notre méthode fait émerger les zones de prix directement depuis les données, sans zonage prédéfini.",
      },
      {
        label: "Statistiques descriptives",
        desc: "Prix médians, évolutions annuelles, répartition par typologie — calculés par commune, département et micro-marché. La médiane est privilégiée à la moyenne pour limiter l'effet des valeurs extrêmes.",
      },
      {
        label: "Agrégation cartographique",
        desc: "Les points de transaction sont agrégés en clusters visuels (Supercluster) côté client pour garantir la fluidité de la carte, même avec plus d'un million de points.",
      },
    ],
  },
  {
    icon: "🔍",
    title: "Transparence et limites",
    color: "#a78bfa",
    items: [
      {
        label: "Données publiques uniquement",
        desc: "Datamerry n'utilise que des données ouvertes (open data) publiées par l'État français. Aucune donnée privée ou propriétaire n'est intégrée dans les analyses.",
      },
      {
        label: "Décalage temporel",
        desc: "Les données DVF sont publiées avec un décalage de 3 à 6 mois par rapport à la date de mutation. Les analyses reflètent donc le marché passé, pas le marché en temps réel.",
      },
      {
        label: "Pas de conseil en investissement",
        desc: "Les informations affichées sont des analyses statistiques à but informatif. Elles ne constituent en aucun cas un conseil en investissement immobilier, financier ou juridique.",
      },
      {
        label: "Couverture géographique",
        desc: "Actuellement limitée à l'Île-de-France (8 départements) et l'Oise. L'extension à d'autres régions est prévue progressivement.",
      },
      {
        label: "Précision du géocodage",
        desc: "Certaines transactions peuvent être positionnées de manière approximative (centroïde communal) lorsque l'adresse exacte n'est pas disponible dans les données DVF.",
      },
    ],
  },
  {
    icon: "🛡️",
    title: "Engagements",
    color: "#fbbf24",
    items: [
      {
        label: "Cartes existantes gratuites",
        desc: "La consultation des cartes et analyses communales déjà publiées est gratuite. Pour des analyses sur mesure ou des cartes spécifiques à vos besoins, contactez-nous pour un devis personnalisé.",
      },
      {
        label: "Vérifiabilité",
        desc: "Les sources de données utilisées sont publiques et référencées. Les résultats affichés peuvent être vérifiés par recoupement avec les données DVF officielles.",
      },
      {
        label: "Mise à jour continue",
        desc: "Les données sont actualisées à chaque nouvelle publication DVF sur data.gouv.fr, généralement sur un rythme semestriel.",
      },
    ],
  },
];

export default function MethodologiePage() {
  return (
    <div style={{ minHeight: "100vh", background: "#0a0a1e", fontFamily: "Segoe UI, Arial, sans-serif" }}>
      {/* Header nav */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "16px 32px", display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/" style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, textDecoration: "none" }}>
          ← datamerry.com
        </Link>
        <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.1)" }} />
        <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>Méthodologie &amp; Transparence</span>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px" }}>
        {/* Hero */}
        <div style={{ marginBottom: 56 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(0,255,136,0.1)", border: "1px solid rgba(0,255,136,0.3)",
            borderRadius: 99, padding: "5px 14px", marginBottom: 20,
            fontSize: 11, color: "#00ff88", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff88", display: "inline-block" }} />
            Open data · Méthodologie décrite
          </div>
          <h1 style={{ margin: "0 0 16px", fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>
            Méthodologie &amp; Transparence
          </h1>
          <p style={{ margin: 0, fontSize: 16, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, maxWidth: 620 }}>
            Datamerry repose intégralement sur des données publiques et des algorithmes décrits.
            Voici comment nous collectons, traitons et restituons l&apos;information foncière.
          </p>
        </div>

        {/* Sections */}
        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          {SECTIONS.map((section) => (
            <div key={section.title}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
                <span style={{ fontSize: 24 }}>{section.icon}</span>
                <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: section.color }}>
                  {section.title}
                </h2>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {section.items.map((item) => (
                  <div
                    key={item.label}
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      borderRadius: 12,
                      padding: "20px 24px",
                    }}
                  >
                    <h3 style={{ margin: "0 0 8px", fontSize: 15, fontWeight: 700, color: "#fff" }}>
                      {item.label}
                    </h3>
                    <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
                      {item.desc}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* CTA bottom */}
        <div style={{
          marginTop: 56, padding: "32px", borderRadius: 16,
          border: "1px solid rgba(0,212,255,0.2)", background: "rgba(0,212,255,0.05)",
          textAlign: "center",
        }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "#fff" }}>
            Besoin d&apos;une analyse sur mesure ?
          </h3>
          <p style={{ margin: "0 0 20px", fontSize: 14, color: "rgba(255,255,255,0.45)" }}>
            Vous souhaitez des cartes spécifiques, une analyse de zone personnalisée ou un accompagnement dédié ? Contactez-nous pour un devis.
          </p>
          <a href="mailto:contact@datamerry.com" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "12px 28px", borderRadius: 10,
            background: "linear-gradient(135deg, #00d4ff, #0099cc)",
            color: "#000", fontSize: 14, fontWeight: 700, textDecoration: "none",
          }}>
            Demander un devis →
          </a>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 48, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.2)" }}>
          datamerry.com · Observatoire foncier France · Source DVF data.gouv.fr
        </div>
      </div>
    </div>
  );
}
