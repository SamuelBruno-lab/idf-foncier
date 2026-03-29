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
        label: "Ventilation des mutations mixtes",
        desc: "Lorsqu'une transaction porte sur plusieurs types de biens (par exemple un appartement et un local commercial vendus ensemble), le prix global enregistré dans DVF ne distingue pas la part de chaque composante. Plutôt que d'écarter ces mutations — ce qui reviendrait à perdre une part significative du marché observé —, nous faisons le choix assumé de ventiler le prix total en nous appuyant sur des prix de référence issus exclusivement des transactions pures (mono-type) environnantes, selon une hiérarchie de proximité : d'abord la parcelle, puis la zone de micro-marché, et enfin la médiane globale du type concerné. Cette estimation est donc encadrée par le marché réel et non extrapolée. Ce procédé ne fausse en rien les calculs portant sur les autres transactions : les prix de référence utilisés pour la ventilation sont calculés uniquement à partir des ventes pures, jamais à partir d'autres estimations — il n'y a donc aucun effet de circularité. De plus, un filtre d'aberrance écarte automatiquement toute mutation dont la valeur théorique reconstituée s'éloigne de plus de 80 % du prix réel, éliminant ainsi les ventes atypiques (familiales, judiciaires, viagères). Les résultats ventilés sont par ailleurs systématiquement identifiés et accompagnés d'un détail complet (source du prix de référence, valeur théorique, quote-part attribuée), garantissant une traçabilité totale. En résumé : estimer n'est pas inventer — c'est appliquer une règle de proportionnalité fondée sur des données de marché vérifiées, dans un périmètre strictement contrôlé, sans jamais contaminer les transactions directement observées.",
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
            Open data · Méthodologie propriétaire
          </div>
          <h1 style={{ margin: "0 0 16px", fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>
            Méthodologie &amp; Transparence
          </h1>
          <p style={{ margin: 0, fontSize: 16, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, maxWidth: 620 }}>
            Datamerry repose intégralement sur des données publiques et des algorithmes documentés.
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

        {/* Micro-zones de prix — section dédiée */}
        <div style={{ marginTop: 56 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
            <span style={{ fontSize: 24 }}>🗺️</span>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#ff6b6b" }}>
              Les micro-zones de prix datamerry
            </h2>
          </div>

          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.55)", lineHeight: 1.8, marginBottom: 32 }}>
            Un prix médian communal (&quot;4 500 €/m² à Drancy&quot;) ne veut pas dire grand-chose.
            Dans la même commune, vous pouvez avoir un quartier à 3 000 €/m² et un autre à 6 000 €/m².
            Que vous gériez un portefeuille ou que vous estimiez un bien, vous avez besoin d&apos;un prix
            de quartier, pas d&apos;une moyenne de ville.
          </p>

          {/* Sous-section : Comment on construit ces zones */}
          <div style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 12, padding: "24px 28px", marginBottom: 24,
          }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 700, color: "#fff" }}>
              Comment on construit ces zones
            </h3>

            <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: "#00d4ff" }}>
              1. On part des ventes réelles
            </h4>
            <ul style={{ margin: "0 0 20px", paddingLeft: 20, fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
              <li>Base DVF (Demandes de Valeurs Foncières), 2020–2025 — les actes notariés publiés par l&apos;État</li>
              <li>Filtrage : prix/m² entre 500 € et 20 000 € (appartements), exclusion des VEFA pour les maisons</li>
              <li>Minimum 5 ventes par commune et type de bien pour qu&apos;une analyse soit pertinente</li>
            </ul>

            <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: "#00d4ff" }}>
              2. On laisse les transactions dessiner elles-mêmes les zones
            </h4>
            <p style={{ margin: "0 0 12px", fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
              Pour chaque commune et chaque type de bien (appartement, maison, local commercial),
              on analyse où les ventes se concentrent géographiquement. Là où il y a un noyau dense
              de transactions proches les unes des autres, une micro-zone se forme naturellement.
            </p>

            {/* Tableau paramètres */}
            <div style={{ overflowX: "auto", marginBottom: 16 }}>
              <table style={{
                width: "100%", borderCollapse: "collapse", fontSize: 13,
                color: "rgba(255,255,255,0.6)",
              }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "rgba(255,255,255,0.3)", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>&nbsp;</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "#00d4ff", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Appartements / Commerces</th>
                    <th style={{ padding: "8px 12px", textAlign: "left", color: "#00ff88", fontWeight: 600, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>Maisons</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "8px 12px", fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>Approche</td>
                    <td style={{ padding: "8px 12px" }}>Zones statistiquement stables</td>
                    <td style={{ padding: "8px 12px" }}>Zones plus fines (granularité maximale)</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "8px 12px", fontWeight: 600, color: "rgba(255,255,255,0.4)" }}>Taille min. de zone</td>
                    <td style={{ padding: "8px 12px" }}>~8 % du volume de transactions</td>
                    <td style={{ padding: "8px 12px" }}>4 à 8 transactions</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div style={{
              background: "rgba(0,212,255,0.06)", border: "1px solid rgba(0,212,255,0.15)",
              borderRadius: 8, padding: "12px 16px", marginBottom: 16,
              fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.7,
            }}>
              <strong style={{ color: "#00d4ff" }}>Exemple :</strong> 386 ventes d&apos;appartements dans
              une commune → environ 6 micro-zones distinctes, chacune avec son propre prix de référence.
            </div>

            <p style={{ margin: "0 0 20px", fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
              Les ventes isolées — un pavillon vendu au milieu de nulle part, une transaction atypique —
              sont automatiquement écartées pour ne pas fausser les références.
            </p>

            <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: "#00d4ff" }}>
              3. Pour chaque zone, on calcule les indicateurs clés
            </h4>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
              <li>Le périmètre géographique de la zone (affichable sur carte)</li>
              <li>Le prix/m² médian et la fourchette P25–P75</li>
              <li>Le nombre de transactions sous-jacentes</li>
            </ul>
          </div>

          {/* Sous-section : Ce que ça change — Asset management */}
          <div style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 12, padding: "24px 28px", marginBottom: 24,
          }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 700, color: "#fff" }}>
              Ce que ça change pour vous
            </h3>

            <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "#fbbf24" }}>
              Si vous gérez un portefeuille (asset management)
            </h4>
            <ul style={{ margin: "0 0 20px", paddingLeft: 20, fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
              <li><strong style={{ color: "rgba(255,255,255,0.7)" }}>Valorisation actif par actif :</strong> chaque bien est rattaché à sa micro-zone avec un prix/m² réel, au lieu d&apos;un prix communal appliqué à l&apos;aveugle</li>
              <li><strong style={{ color: "rgba(255,255,255,0.7)" }}>Repérage d&apos;opportunités :</strong> une zone à 3 200 €/m² juste à côté d&apos;une zone à 5 500 €/m², c&apos;est un signal — potentiel de rattrapage ou décalage à arbitrer</li>
              <li><strong style={{ color: "rgba(255,255,255,0.7)" }}>Scoring automatique :</strong> chaque parcelle reçoit une note de marché de 0 à 10 selon le prix de sa micro-zone, intégrée dans un score global (mutabilité, sous-exploitation, PLU, surface)</li>
            </ul>

            <h4 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "#fbbf24" }}>
              Si vous faites de l&apos;estimation ou de la transaction
            </h4>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
              <li><strong style={{ color: "rgba(255,255,255,0.7)" }}>Des comparables objectifs :</strong> fini le &quot;secteur&quot; dessiné à la main — la zone est délimitée par la réalité des ventes, pas par votre intuition ni par un découpage administratif</li>
              <li><strong style={{ color: "rgba(255,255,255,0.7)" }}>Une fourchette, pas juste un chiffre :</strong> le P25–P75 vous donne directement la marge de négociation réaliste</li>
              <li><strong style={{ color: "rgba(255,255,255,0.7)" }}>La profondeur du marché en un coup d&apos;œil :</strong> 8 ventes dans la zone ou 80 ? Vous savez tout de suite à quel point votre référence est solide</li>
              <li><strong style={{ color: "rgba(255,255,255,0.7)" }}>Deux biens dans la même commune ≠ même prix :</strong> s&apos;ils sont dans deux micro-zones différentes, ils auront des références distinctes — ce que vos clients et vos mandants attendent</li>
            </ul>
          </div>

          {/* Sous-section : Pourquoi pas les IRIS */}
          <div style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 12, padding: "24px 28px", marginBottom: 24,
          }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 17, fontWeight: 700, color: "#fff" }}>
              Pourquoi pas simplement les IRIS ou les quartiers ?
            </h3>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.8 }}>
              <li>Les IRIS sont des découpages de l&apos;INSEE pensés pour le recensement, pas pour le marché immobilier</li>
              <li>Les quartiers dépendent de qui les définit — chaque professionnel a les siens</li>
              <li>Nos micro-zones s&apos;adaptent au terrain : zones serrées en centre-ville dense, zones plus larges en périphérie pavillonnaire</li>
              <li>C&apos;est reproductible : mêmes ventes → mêmes zones → mêmes prix. Pas de subjectivité</li>
            </ul>
          </div>

          {/* Résumé */}
          <div style={{
            background: "rgba(255,107,107,0.06)", border: "1px solid rgba(255,107,107,0.2)",
            borderRadius: 12, padding: "20px 24px",
          }}>
            <h4 style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 700, color: "#ff6b6b" }}>
              En une phrase
            </h4>
            <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.6)", lineHeight: 1.7 }}>
              On transforme les ventes DVF d&apos;une commune en carte de micro-zones de prix, pour que
              chaque bien soit comparé à son vrai marché de proximité — pas à une moyenne de ville.
            </p>
          </div>
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
