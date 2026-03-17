import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  // Clusters pré-calculés
  const { data: clusters, error: err1 } = await supabase
    .from("dvf_clusters_commune")
    .select("cluster_id,nom,dept,type_local,count,prix_median,prix_m2_median,lat,lon")
    .like("cluster_id", `${code}_%`);

  // Paris (75xxx) et Boulogne-Billancourt (92012) : trop de volume → 2024-2025
  // Toutes les autres communes IDF + 60 : historique complet 2020-2025
  const anneeMin = code.startsWith("75") || code === "92012" ? 2024 : 2020;

  // Points DVF bruts — source de vérité quand disponibles
  const { data: points, error: err2 } = await supabase
    .from("dvf_points")
    .select("annee,prix_m2,type_local,valeur_fonciere")
    .eq("code_commune", code)
    .gte("annee", anneeMin)
    .limit(50000);

  if (err1) return NextResponse.json({ error: err1.message }, { status: 500 });
  if (err2) return NextResponse.json({ error: err2.message }, { status: 500 });
  if ((!clusters || clusters.length === 0) && (!points || points.length === 0))
    return NextResponse.json({ error: "Commune introuvable" }, { status: 404 });

  // Micro-marchés pré-calculés (zones géospatiales)
  const { data: microMarches } = await supabase
    .from("dvf_hdbscan_zones")
    .select(
      "id,type_local,cluster_id,count,prix_m2_median,prix_m2_p25,prix_m2_p75,prix_median,hull_coords,centroid_lat,centroid_lon,annee_min,annee_max"
    )
    .eq("code_commune", code)
    .order("type_local")
    .order("cluster_id");

  const hasPoints = points && points.length > 0;

  // Infos commune (depuis clusters)
  const nom = clusters?.[0]?.nom ?? code;
  const dept = clusters?.[0]?.dept ?? code.slice(0, 2);
  const lat = clusters?.[0]?.lat ?? 0;
  const lon = clusters?.[0]?.lon ?? 0;

  let totalCount: number;
  let prixM2Median: number;
  let byTypeResult: { type: string | null; count: number; prix_median: number | null; prix_m2_median: number | null }[];
  let evolution: { annee: number; count: number; prix_m2_median: number }[];

  // Types affichés (exclut Dépendance, Autre…)
  const DISPLAYED_TYPES = new Set(["Appartement", "Maison", "Local industriel. commercial ou assimilé"]);

  if (hasPoints) {
    // Source de vérité : dvf_points — filtré sur les types affichés
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
      .map(([annee, { prices, count }]) => ({
        annee: parseInt(annee),
        count,
        prix_m2_median: median(prices),
      }))
      .sort((a, b) => a.annee - b.annee);

    totalCount = filtered.length;
    const allPrixM2 = filtered.map((p) => p.prix_m2).filter((v): v is number => v != null && v > 0);
    prixM2Median = median(allPrixM2);
    byTypeResult = Object.entries(byType).map(([type, data]) => ({
      type,
      count: data.count,
      prix_median: data.valeurs.length > 0 ? median(data.valeurs) : null,
      prix_m2_median: data.prices.length > 0 ? median(data.prices) : null,
    }));
  } else {
    // Fallback : dvf_clusters_commune — filtré sur les types affichés
    const filteredClusters = (clusters ?? []).filter(
      (c: { type_local: string | null }) => c.type_local != null && DISPLAYED_TYPES.has(c.type_local)
    );
    totalCount = filteredClusters.reduce((s: number, c: { count: number }) => s + c.count, 0);
    const allPrixM2 = filteredClusters.map((c: { prix_m2_median: number | null }) => c.prix_m2_median).filter(Boolean) as number[];
    prixM2Median = median(allPrixM2);
    byTypeResult = filteredClusters.map((c: { type_local: string | null; count: number; prix_median: number | null; prix_m2_median: number | null }) => ({
      type: c.type_local,
      count: c.count,
      prix_median: c.prix_median,
      prix_m2_median: c.prix_m2_median,
    }));
    evolution = [];
  }

  return NextResponse.json({
    code,
    nom,
    dept,
    lat,
    lon,
    totalCount,
    prix_m2_median: prixM2Median,
    byType: byTypeResult,
    evolution,
    zones: microMarches ?? [],
  });
}
