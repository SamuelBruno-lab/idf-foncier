import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const COLUMNS = "id,lat,lon,valeur_fonciere,prix_m2,surface,type_local,date_mutation,adresse,commune,code_commune,dept,annee";

/** Paginate through all Supabase rows for a commune (cap at MAX_COMMUNE_POINTS) */
const MAX_COMMUNE_POINTS = 8000;

async function fetchAllCommunePoints(
  code_commune: string,
  annee_min: number,
  annee_max: number,
) {
  const PAGE_SIZE = 1000;
  const allRows: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("dvf_points")
      .select(COLUMNS)
      .eq("code_commune", code_commune)
      .gte("annee", annee_min)
      .lte("annee", annee_max)
      .not("type_local", "is", null)
      .neq("type_local", "Dépendance")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (allRows.length >= MAX_COMMUNE_POINTS) break;
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return allRows.slice(0, MAX_COMMUNE_POINTS);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dept = searchParams.get("dept")?.split(",").filter(Boolean) ?? [];
  const zoom = parseInt(searchParams.get("zoom") ?? "10");
  const type_local = searchParams.get("type_local");
  const annee_min = parseInt(searchParams.get("annee_min") ?? "2020");
  const annee_max = parseInt(searchParams.get("annee_max") ?? "2025");
  const mode = searchParams.get("mode");
  const commune = searchParams.get("commune");
  const code_commune = searchParams.get("code_commune");

  // Heatmap ou Zoom > 13 → points bruts
  if (mode === "heatmap" || zoom >= 13) {
    // Commune spécifique → pagination pour récupérer TOUS les points
    if (code_commune) {
      try {
        const allData = await fetchAllCommunePoints(code_commune, annee_min, annee_max);
        const filtered = type_local
          ? allData.filter((d) => d.type_local === type_local)
          : allData;
        return NextResponse.json({ mode: "points", data: filtered });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    // Pas de commune → requête classique avec limit
    let q = supabase
      .from("dvf_points")
      .select(COLUMNS)
      .gte("annee", annee_min)
      .lte("annee", annee_max)
      .limit(mode === "heatmap" ? 15000 : 2000);

    if (dept.length > 0) q = q.in("dept", dept);
    if (type_local) q = q.eq("type_local", type_local);
    if (commune) q = q.ilike("commune", `%${commune}%`);

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ mode: "points", data });
  }

  // Zoom < 13 → clusters pré-calculés
  const cluster_level = zoom >= 10 ? "commune" : zoom >= 7 ? "dept" : "region";

  // Les clusters sont des agrégats toutes années confondues → pas de filtre annee
  // (le filtre annee s'applique uniquement aux points bruts)
  const extraCols = cluster_level === "commune" ? ",loyer_median_m2,rendement_brut" : "";
  let q = supabase
    .from(`dvf_clusters_${cluster_level}`)
    .select(`cluster_id,lat,lon,count,prix_median,prix_m2_median,dept,type_local,nom${extraCols}`)
    .gte("count", cluster_level === "commune" ? 20 : 5);  // min 20 transactions/commune pour éviter les outliers statistiques

  if (dept.length > 0) q = q.in("dept", dept);
  if (type_local) q = q.eq("type_local", type_local);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ mode: cluster_level, data });
}
