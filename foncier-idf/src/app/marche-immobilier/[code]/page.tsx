import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import AnalyseLeadSection from "@/components/AnalyseLeadSection";

export const dynamicParams = true;
export const revalidate = 86400; // 24h

const DEPT_NAMES: Record<string, string> = {
  "75": "Paris",
  "77": "Seine-et-Marne",
  "78": "Yvelines",
  "91": "Essonne",
  "92": "Hauts-de-Seine",
  "93": "Seine-Saint-Denis",
  "94": "Val-de-Marne",
  "95": "Val-d'Oise",
  "60": "Oise",
};

const TYPE_LABEL: Record<string, string> = {
  Appartement: "appartement",
  Maison: "maison",
  "Local industriel. commercial ou assimilé": "local commercial",
};

export async function generateStaticParams() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data } = await supabase
      .from("dvf_clusters_commune")
      .select("cluster_id,count")
      .order("count", { ascending: false })
      .limit(500);
    if (!data) return [];
    const seen = new Set<string>();
    const codes: string[] = [];
    for (const row of data) {
      const code = row.cluster_id.split("_")[0];
      if (!seen.has(code)) {
        seen.add(code);
        codes.push(code);
        if (codes.length >= 50) break;
      }
    }
    return codes.map((code) => ({ code }));
  } catch {
    return [];
  }
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

interface MarketData {
  code: string;
  nom: string;
  dept: string;
  deptNom: string;
  totalCount: number;
  prixM2: number;
  byType: { type: string; count: number; prixM2: number }[];
  deptMedians: Record<string, number>;
  yearMin: number;
  yearMax: number;
}

async function getMarketData(code: string): Promise<MarketData | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: clusters } = await supabase
    .from("dvf_clusters_commune")
    .select("cluster_id,nom,dept,type_local,count,prix_m2_median")
    .like("cluster_id", `${code}_%`);

  if (!clusters || clusters.length === 0) return null;

  const TYPES = new Set(["Appartement", "Maison", "Local industriel. commercial ou assimilé"]);
  const filtered = clusters.filter((c) => c.type_local && TYPES.has(c.type_local));

  const nom = clusters[0]?.nom ?? code;
  const dept = clusters[0]?.dept ?? code.slice(0, 2);

  const totalCount = filtered.reduce((s, c) => s + c.count, 0);
  const prices = filtered.map((c) => c.prix_m2_median).filter(Boolean) as number[];
  const prixM2 = median(prices);

  const byType = filtered.map((c) => ({
    type: c.type_local,
    count: c.count,
    prixM2: c.prix_m2_median ?? 0,
  })).sort((a, b) => b.count - a.count);

  const { data: deptClusters } = await supabase
    .from("dvf_clusters_dept")
    .select("type_local,prix_m2_median")
    .like("cluster_id", `${dept}_%`)
    .not("type_local", "is", null);

  const deptMedians: Record<string, number> = {};
  for (const dc of deptClusters ?? []) {
    if (dc.type_local && dc.prix_m2_median) deptMedians[dc.type_local] = dc.prix_m2_median;
  }

  // Get year range from points
  const anneeMin = code.startsWith("75") || code === "92012" ? 2024 : 2020;

  return {
    code,
    nom,
    dept,
    deptNom: DEPT_NAMES[dept] ?? dept,
    totalCount,
    prixM2,
    byType,
    deptMedians,
    yearMin: anneeMin,
    yearMax: 2025,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const data = await getMarketData(code);
  const nom = data?.nom ?? code;
  const dept = data?.deptNom ?? "";
  const prix = data?.prixM2 ? `${data.prixM2.toLocaleString("fr-FR")} €/m²` : "";

  return {
    title: `Marché immobilier ${nom} (${dept}) 2025 — Prix au m², tendances, quartiers | datamerry`,
    description: `Prix immobilier à ${nom} en 2025 : ${prix} en médiane. Analyse complète du marché, évolution des prix, comparaison par type de bien et micro-zones. Données DVF officielles.`,
    keywords: [
      `prix immobilier ${nom}`,
      `marché immobilier ${nom} 2025`,
      `prix m2 ${nom}`,
      `acheter ${nom}`,
      `vendre ${nom}`,
      `investir ${nom}`,
      `estimation ${nom}`,
      `${nom} ${dept}`,
    ],
    openGraph: {
      title: `Marché immobilier ${nom} 2025 — ${prix}`,
      description: `Analyse DVF complète de ${nom} : prix, tendances et micro-zones identifiées par IA.`,
      type: "article",
    },
  };
}

export default async function MarcheImmobilierPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const data = await getMarketData(code);

  if (!data) {
    return (
      <div style={{ minHeight: "100vh", background: "#070714", color: "#e8e8f0", fontFamily: "Segoe UI, Arial, sans-serif", padding: "60px 24px", textAlign: "center" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Commune non trouvée</h1>
        <p style={{ color: "rgba(255,255,255,0.4)", marginTop: 12 }}>
          Les données pour cette commune ne sont pas encore disponibles.
        </p>
        <Link href="/" style={{ color: "#00d4ff", textDecoration: "none", marginTop: 20, display: "inline-block" }}>
          ← Retour à la carte
        </Link>
      </div>
    );
  }

  const globalDeptMedian = Object.values(data.deptMedians).length > 0
    ? Math.round(Object.values(data.deptMedians).reduce((s, v) => s + v, 0) / Object.values(data.deptMedians).length)
    : null;
  const globalDelta = globalDeptMedian && globalDeptMedian > 0
    ? Math.round(((data.prixM2 - globalDeptMedian) / globalDeptMedian) * 100)
    : null;

  const positionLabel = globalDelta !== null
    ? (globalDelta > 20 ? "un marché premium" : globalDelta < -20 ? "un marché accessible" : "un marché dans la moyenne départementale")
    : "un marché dynamique";

  const currentYear = 2025;

  return (
    <div style={{ minHeight: "100vh", background: "#070714", color: "#e8e8f0", fontFamily: "Segoe UI, Arial, sans-serif" }}>
      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg, rgba(0,212,255,0.08), rgba(168,85,247,0.06))",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        padding: "14px 24px",
        display: "flex", alignItems: "center", gap: 16,
      }}>
        <Link href="/" style={{ color: "rgba(0,212,255,0.7)", textDecoration: "none", fontSize: 13 }}>
          ← datamerry
        </Link>
        <span style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
        <Link href={`/analyse/${data.code}`} style={{ color: "rgba(168,85,247,0.7)", textDecoration: "none", fontSize: 13 }}>
          Analyse détaillée →
        </Link>
      </div>

      <article style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px 60px" }}>
        {/* Breadcrumb SEO */}
        <nav style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 24 }}>
          <Link href="/" style={{ color: "rgba(0,212,255,0.5)", textDecoration: "none" }}>Accueil</Link>
          {" > "}
          <Link href={`/dept/${data.dept}`} style={{ color: "rgba(0,212,255,0.5)", textDecoration: "none" }}>{data.deptNom}</Link>
          {" > "}
          <span>{data.nom}</span>
        </nav>

        {/* H1 SEO */}
        <h1 style={{
          fontSize: "clamp(26px, 4vw, 42px)", fontWeight: 800, color: "#fff",
          lineHeight: 1.2, margin: "0 0 8px",
        }}>
          Marché immobilier {data.nom} ({data.deptNom}) en {currentYear}
        </h1>

        <p style={{ fontSize: 15, color: "rgba(255,255,255,0.5)", lineHeight: 1.7, margin: "0 0 32px" }}>
          Dernière mise à jour : mars {currentYear} · Source : DVF open data (data.gouv.fr)
        </p>

        {/* Résumé introductif (texte SEO riche) */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 12 }}>
            Prix immobilier à {data.nom} en {currentYear}
          </h2>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", lineHeight: 1.8 }}>
            Le prix médian au m² à <strong style={{ color: "#fff" }}>{data.nom}</strong> est de{" "}
            <strong style={{ color: "#ffdd00" }}>{data.prixM2.toLocaleString("fr-FR")} €/m²</strong>,
            d&apos;après l&apos;analyse de {data.totalCount.toLocaleString("fr-FR")} transactions immobilières
            enregistrées entre {data.yearMin} et {data.yearMax}.
            {globalDelta !== null && (
              <> C&apos;est {positionLabel}, avec des prix{" "}
                {globalDelta > 0
                  ? `${globalDelta}% au-dessus de la médiane du département ${data.deptNom}`
                  : `${Math.abs(globalDelta)}% en dessous de la médiane du département ${data.deptNom}`
                }.
              </>
            )}
          </p>
        </section>

        {/* Prix par type de bien */}
        {data.byType.length > 0 && (
          <section style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 16 }}>
              Prix au m² par type de bien à {data.nom}
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
              {data.byType.map((t) => {
                const deptPrix = data.deptMedians[t.type];
                const delta = deptPrix && deptPrix > 0
                  ? Math.round(((t.prixM2 - deptPrix) / deptPrix) * 100)
                  : null;
                return (
                  <div key={t.type} style={{
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 12, padding: "20px",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 12, textTransform: "capitalize" }}>
                      {TYPE_LABEL[t.type] ?? t.type}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 800, color: "#ffdd00", marginBottom: 8 }}>
                      {t.prixM2.toLocaleString("fr-FR")} €/m²
                    </div>
                    <div style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
                      {t.count.toLocaleString("fr-FR")} transactions
                    </div>
                    {delta !== null && (
                      <div style={{
                        marginTop: 10, fontSize: 12, fontWeight: 600,
                        color: delta > 0 ? "#ff6b6b" : "#51cf66",
                      }}>
                        {delta > 0 ? "+" : ""}{delta}% vs médiane {data.deptNom}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Texte SEO descriptif */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 12 }}>
            Pourquoi acheter ou investir à {data.nom} ?
          </h2>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", lineHeight: 1.8, marginBottom: 16 }}>
            {data.nom} se situe dans le département {data.deptNom} ({data.dept}) en Île-de-France.
            Avec {data.totalCount.toLocaleString("fr-FR")} transactions enregistrées sur la période {data.yearMin}–{data.yearMax},
            la commune dispose d&apos;un marché immobilier {data.totalCount > 500 ? "très actif" : data.totalCount > 100 ? "dynamique" : "de taille modérée"}.
          </p>
          {data.byType.length > 1 && (
            <p style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", lineHeight: 1.8, marginBottom: 16 }}>
              Le marché est composé principalement de{" "}
              {data.byType.map((t, i) => (
                <span key={t.type}>
                  {i > 0 && (i === data.byType.length - 1 ? " et " : ", ")}
                  <strong style={{ color: "rgba(255,255,255,0.8)" }}>
                    {TYPE_LABEL[t.type] ?? t.type}s
                  </strong> ({t.prixM2.toLocaleString("fr-FR")} €/m² en médiane)
                </span>
              ))}.
            </p>
          )}
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", lineHeight: 1.8 }}>
            Pour une analyse complète incluant l&apos;évolution annuelle des prix, les micro-zones
            identifiées par intelligence artificielle et la comparaison quartier par quartier,
            consultez{" "}
            <Link href={`/analyse/${data.code}`} style={{ color: "#00d4ff", textDecoration: "underline" }}>
              l&apos;analyse détaillée de {data.nom}
            </Link>.
          </p>
        </section>

        {/* FAQ SEO */}
        <section style={{ marginBottom: 36 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#fff", marginBottom: 16 }}>
            Questions fréquentes sur l&apos;immobilier à {data.nom}
          </h2>

          {[
            {
              q: `Quel est le prix au m² à ${data.nom} en ${currentYear} ?`,
              a: `Le prix médian au m² à ${data.nom} est de ${data.prixM2.toLocaleString("fr-FR")} €/m² en ${currentYear}, calculé sur ${data.totalCount.toLocaleString("fr-FR")} transactions DVF.`,
            },
            {
              q: `${data.nom} est-elle chère par rapport au département ?`,
              a: globalDelta !== null
                ? `${data.nom} est ${positionLabel}. Les prix sont ${globalDelta > 0 ? `${globalDelta}% au-dessus` : `${Math.abs(globalDelta)}% en dessous`} de la médiane départementale (${globalDeptMedian?.toLocaleString("fr-FR")} €/m²).`
                : `Consultez notre analyse détaillée pour comparer ${data.nom} avec les communes voisines.`,
            },
            {
              q: `Est-ce le bon moment pour acheter à ${data.nom} ?`,
              a: `Notre analyse couvre ${data.yearMax - data.yearMin + 1} ans de données DVF à ${data.nom}. Pour voir l'évolution des prix et identifier les tendances, consultez l'analyse détaillée avec graphiques interactifs.`,
            },
          ].map(({ q, a }) => (
            <div key={q} style={{
              marginBottom: 16, padding: "16px 20px",
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 10,
            }}>
              <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "0 0 8px" }}>{q}</h3>
              <p style={{ fontSize: 14, color: "rgba(255,255,255,0.55)", lineHeight: 1.7, margin: 0 }}>{a}</p>
            </div>
          ))}
        </section>

        {/* CTA vers analyse + lead capture */}
        <section style={{ marginBottom: 36 }}>
          <div style={{
            padding: "24px", borderRadius: 14,
            background: "linear-gradient(135deg, rgba(0,212,255,0.08), rgba(168,85,247,0.06))",
            border: "1px solid rgba(0,212,255,0.15)",
            textAlign: "center",
          }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: "0 0 8px" }}>
              Analyse complète de {data.nom}
            </h2>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", margin: "0 0 16px" }}>
              Micro-zones, évolution des prix, comparaison quartier par quartier
            </p>
            <Link
              href={`/analyse/${data.code}`}
              style={{
                display: "inline-block",
                padding: "12px 32px",
                borderRadius: 10,
                background: "linear-gradient(135deg, #00ff88, #00d4ff)",
                color: "#0a0a1e",
                fontWeight: 700,
                fontSize: 15,
                textDecoration: "none",
              }}
            >
              Voir l&apos;analyse détaillée →
            </Link>
          </div>
        </section>

        {/* Lead section */}
        <AnalyseLeadSection commune={{ code: data.code, nom: data.nom }} />

        {/* Footer SEO */}
        <footer style={{
          marginTop: 40, paddingTop: 20,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center",
          lineHeight: 1.8,
        }}>
          <p style={{ margin: 0 }}>
            datamerry.com · Données DVF open data · data.gouv.fr · Mise à jour {currentYear}
          </p>
          <p style={{ margin: "6px 0 0" }}>
            <Link href="/methodologie" style={{ color: "rgba(255,255,255,0.3)", textDecoration: "none" }}>Méthodologie</Link>
            {" · "}
            <Link href="/cgu" style={{ color: "rgba(255,255,255,0.3)", textDecoration: "none" }}>CGU</Link>
            {" · "}
            <Link href="/actualites" style={{ color: "rgba(255,255,255,0.3)", textDecoration: "none" }}>Analyses</Link>
          </p>
        </footer>
      </article>

      {/* JSON-LD Schema.org pour SEO */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: `Marché immobilier ${data.nom} (${data.deptNom}) ${currentYear}`,
            description: `Prix immobilier à ${data.nom} : ${data.prixM2.toLocaleString("fr-FR")} €/m² en médiane. ${data.totalCount} transactions analysées.`,
            datePublished: `${currentYear}-01-01`,
            dateModified: `${currentYear}-03-22`,
            author: { "@type": "Organization", name: "datamerry" },
            publisher: { "@type": "Organization", name: "datamerry" },
            about: {
              "@type": "Place",
              name: data.nom,
              address: {
                "@type": "PostalAddress",
                addressRegion: data.deptNom,
                addressCountry: "FR",
              },
            },
          }),
        }}
      />
    </div>
  );
}
