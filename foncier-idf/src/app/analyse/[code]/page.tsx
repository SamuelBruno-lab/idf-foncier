import { createClient } from "@supabase/supabase-js";
import Link from "next/link";
import ZonesMap from "@/components/ZonesMap";
import AnalyseLeadSection from "@/components/AnalyseLeadSection";
import WaitlistBox from "@/components/WaitlistBox";
import InvestmentScore from "@/components/InvestmentScore";
import InsightsSummary from "@/components/InsightsSummary";
import PriceAnomalies from "@/components/PriceAnomalies";

export const dynamicParams = true;
export const revalidate = 21600;

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
        if (codes.length >= 100) break;
      }
    }
    return codes.map((code) => ({ code }));
  } catch {
    return [];
  }
}

interface EvolutionRow { annee: number; count: number; prix_m2_median: number; }
interface TypeRow { type: string | null; count: number; prix_median: number | null; prix_m2_median: number | null; }
interface Zone {
  id: string; type_local: string; cluster_id: number; count: number;
  prix_m2_median: number | null; prix_m2_p25: number | null; prix_m2_p75: number | null;
  prix_median: number | null; hull_coords: [number, number][] | null;
  centroid_lat: number | null; centroid_lon: number | null;
  annee_min: number | null; annee_max: number | null;
}

interface CommuneStats {
  code: string; nom: string; dept: string; totalCount: number; prix_m2_median: number;
  byType: TypeRow[]; evolution: EvolutionRow[]; zones: Zone[];
  deptMedians: Record<string, number>;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPoints(supabase: any, code: string, anneeMin: number) {
  const PAGE_SIZE = 1000;
  const allRows: { annee: number | null; prix_m2: number | null; type_local: string | null; valeur_fonciere: number | null }[] = [];
  let offset = 0;
  while (true) {
    const { data } = await supabase.from("dvf_points")
      .select("annee,prix_m2,type_local,valeur_fonciere")
      .eq("code_commune", code).gte("annee", anneeMin)
      .range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return allRows;
}

const DISPLAYED_TYPES = new Set(["Appartement", "Maison", "Local industriel. commercial ou assimilé"]);

async function getCommuneStats(code: string): Promise<CommuneStats | null> {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

  const { data: clusters } = await supabase
    .from("dvf_clusters_commune")
    .select("cluster_id,nom,dept,type_local,count,prix_median,prix_m2_median,loyer_median_m2,rendement_brut")
    .like("cluster_id", `${code}_%`);

  const anneeMin = code.startsWith("75") || code === "92012" ? 2024 : 2020;
  const points = await fetchAllPoints(supabase, code, anneeMin);

  if ((!clusters || clusters.length === 0) && points.length === 0) return null;

  const hasPoints = points && points.length > 0;

  const { data: zones } = await supabase
    .from("dvf_hdbscan_zones")
    .select("id,type_local,cluster_id,count,prix_m2_median,prix_m2_p25,prix_m2_p75,prix_median,hull_coords,centroid_lat,centroid_lon,annee_min,annee_max")
    .eq("code_commune", code).order("type_local").order("cluster_id");

  let totalCount: number;
  let prixM2Median: number;
  let byTypeResult: TypeRow[];
  let evolution: EvolutionRow[];

  if (hasPoints) {
    const filtered = points.filter((p) => p.type_local != null && DISPLAYED_TYPES.has(p.type_local));
    const byYear: Record<number, { prices: number[]; count: number }> = {};
    const byType: Record<string, { prices: number[]; valeurs: number[]; count: number }> = {};

    for (const p of filtered) {
      if (p.annee) {
        if (!byYear[p.annee]) byYear[p.annee] = { prices: [], count: 0 };
        byYear[p.annee].count++;
        if (p.prix_m2) byYear[p.annee].prices.push(p.prix_m2);
      }
      const type = p.type_local!;
      if (!byType[type]) byType[type] = { prices: [], valeurs: [], count: 0 };
      byType[type].count++;
      if (p.prix_m2) byType[type].prices.push(p.prix_m2);
      if (p.valeur_fonciere) byType[type].valeurs.push(p.valeur_fonciere);
    }

    evolution = Object.entries(byYear)
      .map(([annee, { prices, count }]) => ({ annee: parseInt(annee), count, prix_m2_median: median(prices) }))
      .sort((a, b) => a.annee - b.annee);

    totalCount = filtered.length;
    prixM2Median = median(filtered.map((p) => p.prix_m2).filter((v): v is number => v != null && v > 0));
    byTypeResult = Object.entries(byType).map(([type, data]) => ({
      type, count: data.count,
      prix_median: data.valeurs.length > 0 ? median(data.valeurs) : null,
      prix_m2_median: data.prices.length > 0 ? median(data.prices) : null,
    }));
  } else {
    const filteredClusters = (clusters ?? []).filter((c) => c.type_local != null && DISPLAYED_TYPES.has(c.type_local));
    totalCount = filteredClusters.reduce((s, c) => s + c.count, 0);
    prixM2Median = median(filteredClusters.map((c) => c.prix_m2_median).filter(Boolean) as number[]);
    byTypeResult = filteredClusters.map((c) => ({ type: c.type_local, count: c.count, prix_median: c.prix_median, prix_m2_median: c.prix_m2_median }));
    evolution = [];
  }

  const nom = clusters?.[0]?.nom ?? code;
  const dept = clusters?.[0]?.dept ?? code.slice(0, 2);

  const { data: deptClusters } = await supabase
    .from("dvf_clusters_dept").select("type_local,prix_m2_median")
    .like("cluster_id", `${dept}_%`).not("type_local", "is", null);

  const deptMedians: Record<string, number> = {};
  for (const dc of deptClusters ?? []) {
    if (dc.type_local && dc.prix_m2_median) deptMedians[dc.type_local] = dc.prix_m2_median;
  }

  return { code, nom, dept, totalCount, prix_m2_median: prixM2Median, byType: byTypeResult, evolution, zones: (zones ?? []) as Zone[], deptMedians };
}

function pctVsDept(communePrix: number | null, deptPrix: number | undefined): number | null {
  if (!communePrix || !deptPrix || deptPrix === 0) return null;
  return Math.round(((communePrix - deptPrix) / deptPrix) * 100);
}

const TYPE_LABEL: Record<string, string> = {
  "Appartement": "Appartement",
  "Maison": "Maison",
  "Local industriel. commercial ou assimilé": "Local commercial",
};

/** Compute investment score from data signals */
function computeInvestmentScore(
  globalDelta: number | null,
  evolution: EvolutionRow[],
  totalCount: number,
  zonesCount: number,
): { score: number; label: string; pointsForts: string[]; pointsVigilance: string[] } {
  let score = 50;
  const pointsForts: string[] = [];
  const pointsVigilance: string[] = [];

  // Prix vs département
  if (globalDelta !== null) {
    if (globalDelta < -20) { score += 20; pointsForts.push(`Prix ${Math.abs(globalDelta)}% sous la médiane départementale — forte décote`); }
    else if (globalDelta < -10) { score += 12; pointsForts.push(`Prix ${Math.abs(globalDelta)}% sous la médiane départementale`); }
    else if (globalDelta < 0) { score += 5; pointsForts.push(`Prix légèrement sous la médiane départementale`); }
    else if (globalDelta > 30) { score -= 10; pointsVigilance.push(`Marché premium — prix ${globalDelta}% au-dessus du département`); }
    else if (globalDelta > 10) { score -= 5; pointsVigilance.push(`Prix ${globalDelta}% au-dessus de la médiane départementale`); }
  }

  // Tendance prix
  if (evolution.length >= 3) {
    const recent = evolution.slice(-2);
    const older = evolution.slice(0, -2);
    const avgRecent = recent.reduce((s, e) => s + e.prix_m2_median, 0) / recent.length;
    const avgOlder = older.reduce((s, e) => s + e.prix_m2_median, 0) / older.length;
    const trend = ((avgRecent - avgOlder) / avgOlder) * 100;
    if (trend > 10) { score += 8; pointsForts.push(`Tendance haussière : +${Math.round(trend)}% sur la période récente`); }
    else if (trend > 3) { score += 4; pointsForts.push(`Marché en progression modérée`); }
    else if (trend < -5) { score -= 5; pointsVigilance.push(`Tendance baissière récente — marché à surveiller`); }
  }

  // Volume
  if (totalCount > 500) { score += 5; pointsForts.push(`Volume de transactions élevé (${totalCount.toLocaleString("fr-FR")}) — données fiables`); }
  else if (totalCount > 100) { score += 2; pointsForts.push(`${totalCount.toLocaleString("fr-FR")} transactions analysées`); }
  else { pointsVigilance.push(`Volume limité (${totalCount}) — interprétation prudente`); }

  // Micro-zones
  if (zonesCount > 5) { score += 5; pointsForts.push(`${zonesCount} micro-marchés identifiés — granularité fine`); }
  else if (zonesCount > 0) { score += 2; }

  // Default vigilance
  if (pointsVigilance.length === 0) {
    pointsVigilance.push("Volatilité possible entre micro-zones");
    pointsVigilance.push("Analyser les projets d'urbanisme en cours");
  }

  score = Math.max(10, Math.min(95, score));

  let label = "";
  if (globalDelta !== null && globalDelta < -15) label = `Décote significative de ${Math.abs(globalDelta)}% vs département — potentiel de rattrapage.`;
  else if (globalDelta !== null && globalDelta < 0) label = `Prix légèrement sous le marché départemental — bonne fenêtre d'entrée.`;
  else if (globalDelta !== null && globalDelta > 20) label = `Marché premium avec des prix bien au-dessus du département.`;
  else label = `Marché dans la moyenne départementale.`;

  return { score, label, pointsForts, pointsVigilance };
}

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
  const { data } = await supabase.from("dvf_clusters_commune").select("nom,dept").like("cluster_id", `${code}_%`).limit(1).single();
  const nom = data?.nom ?? code;
  const dept = data?.dept ?? "";
  return {
    title: `Marché immobilier ${nom} (${dept}) — Score investissement, prix, tendances | datamerry`,
    description: `Analyse DVF de ${nom} : score d'investissement, prix médian, écart département, zones sous-cotées et micro-marchés.`,
  };
}

export default async function AnalysePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const stats = await getCommuneStats(code);

  if (!stats) {
    let communeNom = code;
    try {
      const geo = await fetch(`https://geo.api.gouv.fr/communes/${code}?fields=nom`, { next: { revalidate: 86400 } });
      if (geo.ok) { const d = await geo.json(); communeNom = d.nom ?? code; }
    } catch { /* ignore */ }
    return (
      <div style={{ minHeight: "100vh", background: "#070714", color: "#e8e8f0", fontFamily: "Segoe UI, Arial, sans-serif", padding: "0 0 60px", paddingTop: 52 }}>
        <div style={{ background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.08)", padding: "16px 32px", display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/" style={{ color: "rgba(255,255,255,0.4)", fontSize: 13, textDecoration: "none" }}>← datamerry</Link>
        </div>
        <div style={{ maxWidth: 640, margin: "60px auto", padding: "0 24px" }}>
          <WaitlistBox commune={{ code, nom: communeNom }} />
        </div>
      </div>
    );
  }

  const maxPrix = Math.max(...stats.evolution.map((e) => e.prix_m2_median), 1);
  const maxCount = Math.max(...stats.evolution.map((e) => e.count), 1);
  const yearMin = stats.evolution.length > 0 ? stats.evolution[0].annee : 2020;
  const yearMax = stats.evolution.length > 0 ? stats.evolution[stats.evolution.length - 1].annee : 2025;

  const mainTypes = stats.byType
    .filter((t) => t.type === "Appartement" || t.type === "Maison" || t.type === "Local industriel. commercial ou assimilé")
    .sort((a, b) => b.count - a.count);

  const allDeptPrices = Object.values(stats.deptMedians);
  const deptGlobalMedian = allDeptPrices.length > 0 ? Math.round(allDeptPrices.reduce((s, v) => s + v, 0) / allDeptPrices.length) : null;
  const globalDelta = pctVsDept(stats.prix_m2_median, deptGlobalMedian ?? undefined);

  // Compute investment score and insights
  const { score, label: scoreLabel, pointsForts, pointsVigilance } = computeInvestmentScore(
    globalDelta, stats.evolution, stats.totalCount, stats.zones.length
  );

  return (
    <div style={{ minHeight: "100vh", background: "#070714", color: "#e8e8f0", fontFamily: "Segoe UI, Arial, sans-serif", padding: "0 0 60px", paddingTop: 52 }}>
      {/* Breadcrumb header */}
      <div style={{
        background: "linear-gradient(135deg, rgba(0,212,255,0.08), rgba(168,85,247,0.06))",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        padding: "16px 32px",
        display: "flex", alignItems: "center", gap: 20,
      }}>
        <Link href="/" style={{ color: "rgba(0,212,255,0.7)", textDecoration: "none", fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          ← Carte
        </Link>
        <span style={{ color: "rgba(255,255,255,0.15)" }}>|</span>
        <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>datamerry.com</span>
      </div>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "40px 24px 0" }}>
        {/* Titre commune */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.25)",
            borderRadius: 99, padding: "4px 12px", fontSize: 11,
            color: "#00d4ff", letterSpacing: 1, textTransform: "uppercase", marginBottom: 14,
          }}>
            Département {stats.dept} · Analyse DVF
          </div>
          <h1 style={{ margin: 0, fontSize: "clamp(28px, 5vw, 48px)", fontWeight: 800, color: "#fff", lineHeight: 1.1 }}>
            {stats.nom}
          </h1>
          <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14, marginTop: 6 }}>
            {stats.totalCount.toLocaleString("fr-FR")} transactions immobilières · {yearMin}–{yearMax} · Source DVF open data
          </p>
        </div>

        {/* ═══ INVESTMENT SCORE — New section ═══ */}
        <InvestmentScore score={score} label={scoreLabel} commune={stats.nom} />

        {/* ═══ INSIGHTS SUMMARY — Points forts + Vigilance ═══ */}
        <InsightsSummary pointsForts={pointsForts} pointsVigilance={pointsVigilance} />

        {/* Stats cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 36 }}>
          {[
            { label: "Prix médian €/m²", value: stats.prix_m2_median ? `${stats.prix_m2_median.toLocaleString("fr-FR")} €/m²` : "N/A", color: "#ffdd00" },
            {
              label: `vs médiane dept ${stats.dept}`,
              value: globalDelta !== null ? `${globalDelta > 0 ? "+" : ""}${globalDelta}%` : "N/A",
              color: globalDelta !== null ? (globalDelta > 0 ? "#ff6b6b" : globalDelta < 0 ? "#51cf66" : "rgba(255,255,255,0.5)") : "rgba(255,255,255,0.5)",
            },
            { label: "Transactions", value: stats.totalCount.toLocaleString("fr-FR"), color: "#00d4ff" },
            { label: "Période", value: `${yearMin} – ${yearMax}`, color: "#a855f7" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "20px 18px" }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: 0.5 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Context insight */}
        {globalDelta !== null && Math.abs(globalDelta) > 15 && (
          <div style={{ marginBottom: 28, padding: "14px 20px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: 12, alignItems: "flex-start" }}>
            <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>📊</span>
            <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.65)", lineHeight: 1.6 }}>
              {globalDelta < 0
                ? `Marché accessible — prix médian ${Math.abs(globalDelta)}% sous la médiane du département ${stats.dept}. Potentiel de rattrapage à surveiller.`
                : `Marché premium — prix médian ${globalDelta}% au-dessus de la médiane du département ${stats.dept}.`}
            </p>
          </div>
        )}

        {/* Par type de bien */}
        {mainTypes.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
              Par type de bien — vs médiane département {stats.dept}
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 12 }}>
              {mainTypes.map((t) => {
                const deptPrix = stats.deptMedians[t.type ?? ""];
                const delta = pctVsDept(t.prix_m2_median, deptPrix);
                const isAbove = delta !== null && delta > 0;
                const isBelow = delta !== null && delta < 0;
                const deltaColor = isAbove ? "#ff6b6b" : isBelow ? "#51cf66" : "rgba(255,255,255,0.4)";
                const deltaLabel = delta !== null ? (isAbove ? `+${delta}%` : `${delta}%`) : null;

                return (
                  <div key={t.type} style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "18px 20px" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 12 }}>
                      {TYPE_LABEL[t.type ?? ""] ?? t.type}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Prix médian €/m²</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#ffdd00" }}>{t.prix_m2_median?.toLocaleString("fr-FR") ?? "N/A"} €</span>
                    </div>
                    {deptPrix && (
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Médiane dept {stats.dept}</span>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.45)" }}>{deptPrix.toLocaleString("fr-FR")} €/m²</span>
                      </div>
                    )}
                    {deltaLabel && (
                      <div style={{
                        marginTop: 8, padding: "8px 12px", borderRadius: 8,
                        background: isAbove ? "rgba(255,107,107,0.1)" : "rgba(81,207,102,0.1)",
                        border: `1px solid ${isAbove ? "rgba(255,107,107,0.2)" : "rgba(81,207,102,0.2)"}`,
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                      }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>vs dept {stats.dept}</span>
                        <span style={{ fontSize: 15, fontWeight: 800, color: deltaColor }}>{deltaLabel}</span>
                      </div>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                      <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>Transactions</span>
                      <span style={{ fontSize: 13, color: "#00d4ff" }}>{t.count.toLocaleString("fr-FR")}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Évolution annuelle */}
        {stats.evolution.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 14 }}>
              Évolution annuelle
            </h2>
            <div style={{ overflowX: "auto" }}>
              <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, overflow: "hidden", minWidth: 420 }}>
                <div style={{ display: "grid", gridTemplateColumns: "80px 1fr 120px", padding: "10px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: 0.5, textTransform: "uppercase", gap: 12 }}>
                  <span>Année</span><span>Prix médian €/m²</span><span style={{ textAlign: "right" }}>Transactions</span>
                </div>
                {stats.evolution.map((row, i) => (
                  <div key={row.annee} style={{ display: "grid", gridTemplateColumns: "80px 1fr 120px", padding: "12px 20px", borderBottom: i < stats.evolution.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", alignItems: "center", gap: 12 }}>
                    <span style={{ fontWeight: 700, color: "#fff" }}>{row.annee}</span>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ height: 6, borderRadius: 3, width: `${Math.round((row.prix_m2_median / maxPrix) * 100)}%`, minWidth: 4, background: "linear-gradient(90deg, #00d4ff, #a855f7)" }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: "#ffdd00", whiteSpace: "nowrap" }}>{row.prix_m2_median.toLocaleString("fr-FR")} €/m²</span>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ display: "inline-block", height: 4, borderRadius: 2, width: `${Math.round((row.count / maxCount) * 60)}px`, background: "rgba(0,212,255,0.4)", verticalAlign: "middle", marginRight: 8 }} />
                      <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{row.count.toLocaleString("fr-FR")}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Micro-marchés */}
        {stats.zones.length > 0 && (() => {
          const types = [...new Set(stats.zones.map((z) => z.type_local))];
          return (
            <div style={{ marginBottom: 36 }}>
              <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
                Micro-marchés
              </h2>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>
                {stats.zones.length} micro-marchés identifiés par analyse géospatiale
              </p>
              <div style={{ marginBottom: 20 }}>
                <ZonesMap zones={stats.zones} />
              </div>
              {types.map((type) => {
                const zones = stats.zones.filter((z) => z.type_local === type);
                const typeColors: Record<string, string> = { Appartement: "#00d4ff", Maison: "#ff8844", "Local industriel. commercial ou assimilé": "#a855f7" };
                const color = typeColors[type] ?? "#00ff88";
                return (
                  <div key={type} style={{ marginBottom: 20 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 8 }}>
                      {TYPE_LABEL[type] ?? type} — {zones.length} micro-marchés
                    </div>
                    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, overflow: "hidden" }}>
                      <div style={{ overflowX: "auto" }}>
                        <div style={{ minWidth: 480 }}>
                          <div style={{ display: "grid", gridTemplateColumns: "60px 1fr 110px 110px 90px", padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: 0.5, textTransform: "uppercase", gap: 8 }}>
                            <span>Zone</span><span>Prix médian €/m²</span><span style={{ textAlign: "right" }}>Fourchette</span><span style={{ textAlign: "right" }}>Prix médian</span><span style={{ textAlign: "right" }}>Tx</span>
                          </div>
                          {zones.map((zone, i) => {
                            const maxZonePrix = Math.max(...zones.map((z) => z.prix_m2_median ?? 0), 1);
                            const pct = Math.round(((zone.prix_m2_median ?? 0) / maxZonePrix) * 100);
                            return (
                              <div key={zone.id} style={{ display: "grid", gridTemplateColumns: "60px 1fr 110px 110px 90px", padding: "10px 16px", borderBottom: i < zones.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", alignItems: "center", gap: 8 }}>
                                <span style={{ fontWeight: 700, fontSize: 12, color }}>Z{zone.cluster_id}</span>
                                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                  <div style={{ height: 5, borderRadius: 3, width: `${pct}%`, minWidth: 4, background: `linear-gradient(90deg, ${color}88, ${color})`, maxWidth: 120 }} />
                                  <span style={{ fontSize: 13, fontWeight: 700, color: "#ffdd00", whiteSpace: "nowrap" }}>{zone.prix_m2_median?.toLocaleString("fr-FR") ?? "—"} €/m²</span>
                                </div>
                                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", textAlign: "right", whiteSpace: "nowrap" }}>{zone.prix_m2_p25?.toLocaleString("fr-FR") ?? "—"} – {zone.prix_m2_p75?.toLocaleString("fr-FR") ?? "—"}</span>
                                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", textAlign: "right", whiteSpace: "nowrap" }}>{zone.prix_median ? `${Math.round(zone.prix_median / 1000)}k €` : "—"}</span>
                                <span style={{ fontSize: 11, color: "#00d4ff", textAlign: "right" }}>{zone.count.toLocaleString("fr-FR")}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* ═══ ANOMALIES DE PRIX INTER-ZONES ═══ */}
        <PriceAnomalies zones={stats.zones} commune={stats.nom} />

        {/* ═══ REDESIGNED CTAs — result-oriented ═══ */}
        <AnalyseLeadSection commune={{ code: stats.code, nom: stats.nom }} />

        {/* Footer */}
        <div style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center" }}>
          datamerry.com · Données DVF open data · data.gouv.fr · Mise à jour 2025
        </div>
      </div>
    </div>
  );
}
