import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import { notFound } from "next/navigation";
import ZonesMap from "@/components/ZonesMap";
import AnalyseLeadSection from "@/components/AnalyseLeadSection";

// Pages statiques pré-générées pour le SEO (top 100 communes par volume)
// Les autres communes restent accessibles en rendu dynamique
export const dynamicParams = true;

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
    // Dédupliquer par code commune (cluster_id = "{code}_{type_local}")
    const seen = new Set<string>();
    const codes: string[] = [];
    for (const row of data) {
      const code = row.cluster_id.split("_")[0];
      if (!seen.has(code)) {
        seen.add(code);
        codes.push(code);
        if (codes.length >= 100) break;
      }
    }
    return codes.map((code) => ({ code }));
  } catch {
    return [];
  }
}

interface EvolutionRow {
  annee: number;
  count: number;
  prix_m2_median: number;
}

interface TypeRow {
  type: string | null;
  count: number;
  prix_median: number | null;
  prix_m2_median: number | null;
}

interface HdbscanZone {
  id: string;
  type_local: string;
  cluster_id: number;
  count: number;
  prix_m2_median: number | null;
  prix_m2_p25: number | null;
  prix_m2_p75: number | null;
  prix_median: number | null;
  hull_coords: [number, number][] | null;
  centroid_lat: number | null;
  centroid_lon: number | null;
  annee_min: number | null;
  annee_max: number | null;
}

interface CommuneStats {
  code: string;
  nom: string;
  dept: string;
  totalCount: number;
  prix_m2_median: number;
  loyer_median_m2: number | null;
  rendement_brut: number | null;
  byType: TypeRow[];
  evolution: EvolutionRow[];
  hdbscanZones: HdbscanZone[];
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

async function getCommuneStats(code: string): Promise<CommuneStats | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: clusters } = await supabase
    .from("dvf_clusters_commune")
    .select("cluster_id,nom,dept,type_local,count,prix_median,prix_m2_median,loyer_median_m2,rendement_brut")
    .like("cluster_id", `${code}_%`);

  if (!clusters || clusters.length === 0) return null;

  const { data: points } = await supabase
    .from("dvf_points")
    .select("annee,prix_m2")
    .eq("code_commune", code)
    .limit(5000);

  const { data: hdbscanZones } = await supabase
    .from("dvf_hdbscan_zones")
    .select(
      "id,type_local,cluster_id,count,prix_m2_median,prix_m2_p25,prix_m2_p75,prix_median,hull_coords,centroid_lat,centroid_lon,annee_min,annee_max"
    )
    .eq("code_commune", code)
    .order("type_local")
    .order("cluster_id");

  const byYear: Record<number, { prices: number[]; count: number }> = {};
  for (const p of points ?? []) {
    if (!p.annee) continue;
    if (!byYear[p.annee]) byYear[p.annee] = { prices: [], count: 0 };
    byYear[p.annee].count++;
    if (p.prix_m2) byYear[p.annee].prices.push(p.prix_m2);
  }

  const evolution = Object.entries(byYear)
    .map(([annee, { prices, count }]) => ({
      annee: parseInt(annee),
      count,
      prix_m2_median: median(prices),
    }))
    .sort((a, b) => a.annee - b.annee);

  const allPrixM2 = clusters.map((c) => c.prix_m2_median).filter(Boolean) as number[];

  // Loyer et rendement : uniquement sur les biens résidentiels
  const residentialClusters = clusters.filter(
    (c) => c.type_local === "Appartement" || c.type_local === "Maison"
  );
  const loyerVals = residentialClusters
    .map((c) => c.loyer_median_m2)
    .filter((v): v is number => v != null && v > 0);
  const rendementVals = residentialClusters
    .map((c) => c.rendement_brut)
    .filter((v): v is number => v != null && v > 0);

  return {
    code,
    nom: clusters[0].nom,
    dept: clusters[0].dept,
    totalCount: clusters.reduce((s, c) => s + c.count, 0),
    prix_m2_median: median(allPrixM2),
    loyer_median_m2: loyerVals.length > 0 ? Math.round(median(loyerVals) * 10) / 10 : null,
    rendement_brut: rendementVals.length > 0 ? Math.round(median(rendementVals) * 10) / 10 : null,
    byType: clusters.map((c) => ({
      type: c.type_local,
      count: c.count,
      prix_median: c.prix_median,
      prix_m2_median: c.prix_m2_median,
    })),
    evolution,
    hdbscanZones: (hdbscanZones ?? []) as HdbscanZone[],
  };
}

// Médianes IDF de référence (source OLAP 2024 / DVF 2020-2024)
const IDF_RENDEMENT_MEDIAN = 4.4;
const IDF_PRIX_M2_MEDIAN = 5500;

function getContextPhrase(stats: CommuneStats): string | null {
  if (stats.rendement_brut != null) {
    const diff = stats.rendement_brut - IDF_RENDEMENT_MEDIAN;
    const pct = Math.abs(Math.round((diff / IDF_RENDEMENT_MEDIAN) * 100));
    if (diff >= 1.5)
      return `Rendement attractif · ${pct}% au-dessus de la médiane IDF (${IDF_RENDEMENT_MEDIAN}%) — profil investisseur locatif.`;
    if (diff >= 0)
      return `Rendement dans la moyenne IDF (${IDF_RENDEMENT_MEDIAN}%) — bon équilibre valorisation / rendement.`;
    if (diff >= -1.5)
      return `Marché légèrement sous la médiane IDF en rendement · profil patrimonial et valorisation long terme.`;
    return `Marché premium à faible rendement locatif · profil résidence principale ou patrimoine.`;
  }
  if (stats.prix_m2_median > IDF_PRIX_M2_MEDIAN * 1.4)
    return `Marché premium — prix médian ${Math.round(((stats.prix_m2_median - IDF_PRIX_M2_MEDIAN) / IDF_PRIX_M2_MEDIAN) * 100)}% au-dessus de la médiane IDF.`;
  if (stats.prix_m2_median < IDF_PRIX_M2_MEDIAN * 0.7)
    return `Marché accessible — prix médian ${Math.round(((IDF_PRIX_M2_MEDIAN - stats.prix_m2_median) / IDF_PRIX_M2_MEDIAN) * 100)}% sous la médiane IDF.`;
  return null;
}

const TYPE_LABEL: Record<string, string> = {
  "Appartement": "Appartement",
  "Maison": "Maison",
  "Local industriel. commercial ou assimilé": "Local commercial",
  "Dépendance": "Dépendance",
};

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  const { data } = await supabase
    .from("dvf_clusters_commune")
    .select("nom,dept")
    .like("cluster_id", `${code}_%`)
    .limit(1)
    .single();

  const nom = data?.nom ?? code;
  const dept = data?.dept ?? "";
  return {
    title: `Marché immobilier ${nom} (${dept}) — Prix, loyers, rendement | datamerry`,
    description: `Analyse DVF de ${nom} : prix médian au m², loyer médian, rendement locatif brut, évolution 2020–2025 et micro-marchés identifiés par IA.`,
  };
}

export default async function AnalysePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const stats = await getCommuneStats(code);
  if (!stats) notFound();

  const maxPrix = Math.max(...stats.evolution.map((e) => e.prix_m2_median), 1);
  const maxCount = Math.max(...stats.evolution.map((e) => e.count), 1);
  const yearMin = stats.evolution.length > 0 ? stats.evolution[0].annee : 2020;
  const yearMax = stats.evolution.length > 0 ? stats.evolution[stats.evolution.length - 1].annee : 2025;

  const mainTypes = stats.byType
    .filter((t) => t.type === "Appartement" || t.type === "Maison")
    .sort((a, b) => b.count - a.count);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#070714",
        color: "#e8e8f0",
        fontFamily: "Segoe UI, Arial, sans-serif",
        padding: "0 0 60px",
      }}
    >
      {/* Header */}
      <div
        style={{
          background: "linear-gradient(135deg, rgba(0,212,255,0.08), rgba(168,85,247,0.06))",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          padding: "16px 32px",
          display: "flex",
          alignItems: "center",
          gap: 20,
        }}
      >
        <Link
          href="/"
          style={{
            color: "rgba(0,212,255,0.7)",
            textDecoration: "none",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          ← Carte
        </Link>
        <span style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>
          datamerry.com
        </span>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 0" }}>
        {/* Titre commune */}
        <div style={{ marginBottom: 32 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(0,212,255,0.1)",
              border: "1px solid rgba(0,212,255,0.25)",
              borderRadius: 99,
              padding: "4px 12px",
              fontSize: 11,
              color: "#00d4ff",
              letterSpacing: 1,
              textTransform: "uppercase",
              marginBottom: 14,
            }}
          >
            Département {stats.dept} · Analyse DVF
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(28px, 5vw, 48px)",
              fontWeight: 800,
              color: "#fff",
              lineHeight: 1.1,
            }}
          >
            {stats.nom}
          </h1>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginTop: 6 }}>
            {stats.totalCount.toLocaleString("fr-FR")} transactions immobilières · {yearMin}–{yearMax} · Source DVF
          </p>
        </div>

        {/* Stats cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: 14,
            marginBottom: 36,
          }}
        >
          {[
            {
              label: "Prix médian €/m²",
              value: stats.prix_m2_median
                ? `${stats.prix_m2_median.toLocaleString("fr-FR")} €/m²`
                : "N/A",
              color: "#ffdd00",
              show: true,
            },
            {
              label: "Transactions totales",
              value: stats.totalCount.toLocaleString("fr-FR"),
              color: "#00d4ff",
              show: true,
            },
            {
              label: "Période couverte",
              value: `${yearMin} – ${yearMax}`,
              color: "#a855f7",
              show: true,
            },
            {
              label: "Loyer médian",
              value: stats.loyer_median_m2 != null
                ? `${stats.loyer_median_m2.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} €/m²/mois`
                : "N/A",
              color: "#88ffcc",
              show: stats.loyer_median_m2 != null,
            },
            {
              label: "Rendement brut",
              value: stats.rendement_brut != null
                ? `${stats.rendement_brut.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
                : "N/A",
              color: stats.rendement_brut == null
                ? "#888"
                : stats.rendement_brut >= 5
                ? "#00ff88"
                : stats.rendement_brut >= 3
                ? "#ffaa00"
                : "#ff4444",
              show: stats.rendement_brut != null,
            },
          ].filter((c) => c.show).map(({ label, value, color }) => (
            <div
              key={label}
              style={{
                background: label === "Rendement brut"
                  ? "rgba(0,255,136,0.04)"
                  : "rgba(255,255,255,0.04)",
                border: label === "Rendement brut"
                  ? "1px solid rgba(0,255,136,0.15)"
                  : "1px solid rgba(255,255,255,0.08)",
                borderRadius: 12,
                padding: "20px 18px",
              }}
            >
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: 0.5 }}>
                {label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Phrase de contexte marché */}
        {(() => {
          const phrase = getContextPhrase(stats);
          if (!phrase) return null;
          const isGood = stats.rendement_brut != null && stats.rendement_brut >= IDF_RENDEMENT_MEDIAN;
          return (
            <div
              style={{
                marginBottom: 28,
                padding: "14px 20px",
                borderRadius: 10,
                background: isGood ? "rgba(0,255,136,0.04)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${isGood ? "rgba(0,255,136,0.2)" : "rgba(255,255,255,0.07)"}`,
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{isGood ? "📈" : "📊"}</span>
              <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>
                {phrase}
              </p>
            </div>
          );
        })()}

        {/* Par type de bien */}
        {mainTypes.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <h2
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "rgba(255,255,255,0.5)",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 14,
              }}
            >
              Par type de bien
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
              {mainTypes.map((t) => (
                <div
                  key={t.type}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 12,
                    padding: "18px 20px",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 12 }}>
                    {TYPE_LABEL[t.type ?? ""] ?? t.type}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Prix médian €/m²</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#ffdd00" }}>
                      {t.prix_m2_median?.toLocaleString("fr-FR") ?? "N/A"} €
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Transactions</span>
                    <span style={{ fontSize: 13, color: "#00d4ff" }}>
                      {t.count.toLocaleString("fr-FR")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Évolution annuelle */}
        {stats.evolution.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <h2
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "rgba(255,255,255,0.5)",
                textTransform: "uppercase",
                letterSpacing: 1,
                marginBottom: 14,
              }}
            >
              Évolution annuelle
            </h2>
            <div style={{ overflowX: "auto" }}>
            <div
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 12,
                overflow: "hidden",
                minWidth: 420,
              }}
            >
              {/* En-tête tableau */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "80px 1fr 120px",
                  padding: "10px 20px",
                  borderBottom: "1px solid rgba(255,255,255,0.07)",
                  fontSize: 11,
                  color: "rgba(255,255,255,0.3)",
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  gap: 12,
                }}
              >
                <span>Année</span>
                <span>Prix médian €/m²</span>
                <span style={{ textAlign: "right" }}>Transactions</span>
              </div>
              {stats.evolution.map((row, i) => (
                <div
                  key={row.annee}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "80px 1fr 120px",
                    padding: "12px 20px",
                    borderBottom:
                      i < stats.evolution.length - 1
                        ? "1px solid rgba(255,255,255,0.04)"
                        : "none",
                    alignItems: "center",
                    gap: 12,
                  }}
                >
                  <span style={{ fontWeight: 700, color: "#fff" }}>{row.annee}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div
                      style={{
                        height: 6,
                        borderRadius: 3,
                        width: `${Math.round((row.prix_m2_median / maxPrix) * 100)}%`,
                        minWidth: 4,
                        background: "linear-gradient(90deg, #00d4ff, #a855f7)",
                      }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#ffdd00", whiteSpace: "nowrap" }}>
                      {row.prix_m2_median.toLocaleString("fr-FR")} €/m²
                    </span>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div
                      style={{
                        display: "inline-block",
                        height: 4,
                        borderRadius: 2,
                        width: `${Math.round((row.count / maxCount) * 60)}px`,
                        background: "rgba(0,212,255,0.4)",
                        verticalAlign: "middle",
                        marginRight: 8,
                      }}
                    />
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>
                      {row.count.toLocaleString("fr-FR")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            </div>{/* /overflowX wrapper */}
          </div>
        )}

        {/* Zones HDBSCAN */}
        {stats.hdbscanZones.length > 0 && (() => {
          const types = [...new Set(stats.hdbscanZones.map((z) => z.type_local))];
          return (
            <div style={{ marginBottom: 36 }}>
              <h2
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "rgba(255,255,255,0.5)",
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 6,
                }}
              >
                Micro-marchés
              </h2>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>
                {stats.hdbscanZones.length} micro-marchés identifiés par analyse géospatiale
              </p>

              {/* Carte des zones */}
              <div style={{ marginBottom: 20 }}>
                <ZonesMap zones={stats.hdbscanZones} />
              </div>

              {types.map((type) => {
                const zones = stats.hdbscanZones.filter((z) => z.type_local === type);
                const typeColors: Record<string, string> = {
                  Appartement: "#00d4ff",
                  Maison: "#ff8844",
                  "Local industriel. commercial ou assimilé": "#a855f7",
                };
                const color = typeColors[type] ?? "#00ff88";
                return (
                  <div key={type} style={{ marginBottom: 20 }}>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color,
                        textTransform: "uppercase",
                        letterSpacing: 0.8,
                        marginBottom: 8,
                      }}
                    >
                      {TYPE_LABEL[type] ?? type} — {zones.length} micro-marchés
                    </div>
                    <div
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 12,
                        overflow: "hidden",
                      }}
                    >
                    <div style={{ overflowX: "auto" }}>
                    <div style={{ minWidth: 480 }}>
                      {/* En-tête */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "60px 1fr 110px 110px 90px",
                          padding: "8px 16px",
                          borderBottom: "1px solid rgba(255,255,255,0.07)",
                          fontSize: 10,
                          color: "rgba(255,255,255,0.3)",
                          letterSpacing: 0.5,
                          textTransform: "uppercase",
                          gap: 8,
                        }}
                      >
                        <span>Zone</span>
                        <span>Prix médian €/m²</span>
                        <span style={{ textAlign: "right" }}>Fourchette</span>
                        <span style={{ textAlign: "right" }}>Prix médian</span>
                        <span style={{ textAlign: "right" }}>Tx</span>
                      </div>
                      {zones.map((zone, i) => {
                        const maxZonePrix = Math.max(...zones.map((z) => z.prix_m2_median ?? 0), 1);
                        const pct = Math.round(((zone.prix_m2_median ?? 0) / maxZonePrix) * 100);
                        return (
                          <div
                            key={zone.id}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "60px 1fr 110px 110px 90px",
                              padding: "10px 16px",
                              borderBottom:
                                i < zones.length - 1
                                  ? "1px solid rgba(255,255,255,0.04)"
                                  : "none",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 700,
                                fontSize: 12,
                                color,
                              }}
                            >
                              Z{zone.cluster_id}
                            </span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <div
                                style={{
                                  height: 5,
                                  borderRadius: 3,
                                  width: `${pct}%`,
                                  minWidth: 4,
                                  background: `linear-gradient(90deg, ${color}88, ${color})`,
                                  maxWidth: 120,
                                }}
                              />
                              <span style={{ fontSize: 13, fontWeight: 700, color: "#ffdd00", whiteSpace: "nowrap" }}>
                                {zone.prix_m2_median?.toLocaleString("fr-FR") ?? "—"} €/m²
                              </span>
                            </div>
                            <span
                              style={{
                                fontSize: 11,
                                color: "rgba(255,255,255,0.35)",
                                textAlign: "right",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {zone.prix_m2_p25?.toLocaleString("fr-FR") ?? "—"}
                              {" – "}
                              {zone.prix_m2_p75?.toLocaleString("fr-FR") ?? "—"}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                color: "rgba(255,255,255,0.5)",
                                textAlign: "right",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {zone.prix_median
                                ? `${Math.round(zone.prix_median / 1000)}k €`
                                : "—"}
                            </span>
                            <span
                              style={{
                                fontSize: 11,
                                color: "#00d4ff",
                                textAlign: "right",
                              }}
                            >
                              {zone.count.toLocaleString("fr-FR")}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                    </div>{/* /minWidth */}
                    </div>{/* /overflowX */}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* CTAs monétisables */}
        <AnalyseLeadSection commune={{ code: stats.code, nom: stats.nom }} />

        {/* Footer */}
        <div
          style={{
            marginTop: 40,
            paddingTop: 20,
            borderTop: "1px solid rgba(255,255,255,0.06)",
            fontSize: 11,
            color: "rgba(255,255,255,0.2)",
            textAlign: "center",
          }}
        >
          datamerry.com · Données DVF open data · data.gouv.fr · Mise à jour 2025
        </div>
      </div>
    </div>
  );
}
