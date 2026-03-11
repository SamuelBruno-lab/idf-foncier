import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Actualités — datamerry · Observatoire foncier IA",
  description: "Projets pilotes et actualités datamerry : Villeneuve-la-Garenne, analyses foncières territoriales et innovations IA.",
};

const ARTICLES = [
  {
    id: "vlg",
    date: "Janvier 2025",
    tag: "Projet pilote",
    tagColor: "#00ff88",
    title: "Villeneuve-la-Garenne : premier territoire cartographié par IA",
    summary: "Datamerry a cartographié l'intégralité du marché immobilier de Villeneuve-la-Garenne (92), commune de 25 000 habitants en bord de Seine. Micro-marchés identifiés par IA, évolution 2025, typologies de biens.",
    mapUrl: "https://samuelbruno-lab.github.io/vlg-foncier/",
    stats: [
      { val: "2 800+", label: "transactions analysées" },
      { val: "7", label: "micro-marchés identifiés" },
      { val: "5 ans", label: "de données DVF" },
    ],
    featured: true,
  },
  {
    id: "idf",
    date: "Décembre 2024",
    tag: "Couverture régionale",
    tagColor: "#00d4ff",
    title: "1,2 million de transactions IDF cartographiées",
    summary: "L'Île-de-France complète est désormais couverte : 8 départements + l'Oise. Chaque commune est accessible avec ses données DVF et ses analyses de marché calculées par l'IA.",
    mapUrl: "https://datamerry.com",
    stats: [
      { val: "1,2M", label: "transactions" },
      { val: "9", label: "départements" },
      { val: "1 200+", label: "communes" },
    ],
    featured: false,
  },
  {
    id: "hauts-de-seine",
    date: "Novembre 2024",
    tag: "Analyse départementale",
    tagColor: "#00d4ff",
    title: "Le 92 décrypté : Hauts-de-Seine, marché premium sous tension",
    summary: "Analyse complète du marché foncier des Hauts-de-Seine. Neuilly-sur-Seine, Boulogne-Billancourt, Levallois-Perret — les données DVF révèlent un marché sous tension avec des prix médians dépassant 7 000€/m² pour les appartements.",
    mapUrl: "https://samuelbruno-lab.github.io/hauts-de-seine-foncier/",
    stats: [
      { val: "36", label: "communes analysées" },
      { val: "7 200€", label: "prix médian/m²" },
    ],
    featured: false,
  },
  {
    id: "val-de-marne",
    date: "Octobre 2024",
    tag: "Analyse départementale",
    tagColor: "#a78bfa",
    title: "Val-de-Marne (94) : micro-marchés à fort potentiel",
    summary: "Le Val-de-Marne présente des dynamiques de marché parmi les plus intéressantes d'IDF sur certaines communes. L'analyse DVF révèle des micro-marchés encore méconnus des investisseurs.",
    mapUrl: "https://datamerry.com/dept/94",
    stats: [
      { val: "47", label: "communes analysées" },
      { val: "5 800€", label: "prix médian/m²" },
    ],
    featured: false,
  },
];

export default function ActualitesPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#0a0a1e", fontFamily: "Segoe UI, Arial, sans-serif" }}>
      {/* Header nav */}
      <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "16px 32px", display: "flex", alignItems: "center", gap: 16 }}>
        <Link href="/" style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, textDecoration: "none" }}>
          ← datamerry.com
        </Link>
        <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.1)" }} />
        <span style={{ color: "rgba(255,255,255,0.6)", fontSize: 13 }}>Actualités & projets pilotes</span>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "48px 24px" }}>
        {/* Hero */}
        <div style={{ marginBottom: 56 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.3)",
            borderRadius: 99, padding: "5px 14px", marginBottom: 20,
            fontSize: 11, color: "#00d4ff", letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 600,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00d4ff", display: "inline-block" }} />
            Observatoire foncier IA · datamerry
          </div>
          <h1 style={{ margin: "0 0 16px", fontSize: "clamp(28px, 4vw, 42px)", fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>
            Actualités &amp; projets pilotes
          </h1>
          <p style={{ margin: 0, fontSize: 16, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, maxWidth: 620 }}>
            Datamerry cartographie le marché immobilier français commune par commune grâce à l'IA.
            Retrouvez ici nos analyses territoriales, projets pilotes et couvertures géographiques.
          </p>
        </div>

        {/* Articles */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {ARTICLES.map((article) => (
            <article key={article.id} style={{
              background: article.featured ? "rgba(0,255,136,0.04)" : "rgba(255,255,255,0.02)",
              border: `1px solid ${article.featured ? "rgba(0,255,136,0.2)" : "rgba(255,255,255,0.07)"}`,
              borderRadius: 16,
              padding: "28px 32px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <span style={{
                  padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 700,
                  border: `1px solid ${article.tagColor}55`,
                  background: `${article.tagColor}15`,
                  color: article.tagColor, letterSpacing: 0.5,
                }}>
                  {article.tag}
                </span>
                <span style={{ color: "rgba(255,255,255,0.25)", fontSize: 12 }}>{article.date}</span>
                {article.featured && (
                  <span style={{
                    padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 700,
                    background: "rgba(0,255,136,0.15)", color: "#00ff88", letterSpacing: 0.5,
                  }}>
                    FEATURED
                  </span>
                )}
              </div>

              <h2 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "#fff", lineHeight: 1.35 }}>
                {article.title}
              </h2>

              <p style={{ margin: "0 0 20px", fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.7 }}>
                {article.summary}
              </p>

              {/* Stats */}
              <div style={{ display: "flex", gap: 24, marginBottom: 24, flexWrap: "wrap" }}>
                {article.stats.map((s) => (
                  <div key={s.label}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{s.val}</div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>

              <a
                href={article.mapUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "10px 20px", borderRadius: 8,
                  border: `1px solid ${article.tagColor}55`,
                  background: `${article.tagColor}10`,
                  color: article.tagColor, fontSize: 13, fontWeight: 600,
                  textDecoration: "none", transition: "all 0.15s",
                }}
              >
                Explorer la carte →
              </a>
            </article>
          ))}
        </div>

        {/* CTA bottom */}
        <div style={{
          marginTop: 56, padding: "32px", borderRadius: 16,
          border: "1px solid rgba(0,212,255,0.2)", background: "rgba(0,212,255,0.05)",
          textAlign: "center",
        }}>
          <h3 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 700, color: "#fff" }}>
            Votre commune n'est pas encore analysée ?
          </h3>
          <p style={{ margin: "0 0 20px", fontSize: 14, color: "rgba(255,255,255,0.45)" }}>
            Demandez l'analyse de votre ville — générée en 72h, puis disponible gratuitement pour tous.
          </p>
          <Link href="/" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "12px 28px", borderRadius: 10,
            background: "linear-gradient(135deg, #00d4ff, #0099cc)",
            color: "#000", fontSize: 14, fontWeight: 700, textDecoration: "none",
          }}>
            Rechercher ma commune →
          </Link>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 48, textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.2)" }}>
          datamerry.com · Observatoire foncier France · Source DVF data.gouv.fr
        </div>
      </div>
    </div>
  );
}
