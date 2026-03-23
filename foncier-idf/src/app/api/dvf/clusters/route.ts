import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const COLUMNS = "id,lat,lon,valeur_fonciere,prix_m2,surface,type_local,date_mutation,adresse,commune,code_commune,dept,annee";

const MAX_COMMUNE_POINTS = 8000;

/** Paginate through Supabase rows; returns [] on error instead of throwing */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function paginateQuery(
  buildQuery: (offset: number, pageSize: number) => any,
): Promise<Record<string, unknown>[]> {
  const PAGE_SIZE = 1000;
  const allRows: Record<string, unknown>[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await buildQuery(offset, PAGE_SIZE);
    if (error) {
      console.error("paginateQuery error:", error.message ?? error);
      return allRows; // return what we have so far instead of throwing
    }
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (allRows.length >= MAX_COMMUNE_POINTS) break;
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return allRows.slice(0, MAX_COMMUNE_POINTS);
}

/**
 * Fetch DVF points for a commune.
 * Uses dept as primary filter (indexed) + code_commune as secondary.
 * Falls back to geographic bbox if code_commune queries fail/timeout.
 */
async function fetchAllCommunePoints(
  code_commune: string,
  annee_min: number,
  annee_max: number,
  dept?: string,
  lat?: number,
  lon?: number,
) {
  // Strategy 1: dept (indexed) + code_commune LIKE prefix
  // Using LIKE instead of eq because eq times out on unindexed code_commune
  // Adding dept filter first so Postgres uses the dept index to narrow the scan.
  if (dept) {
    const rows = await paginateQuery((offset, pageSize) =>
      supabase
        .from("dvf_points")
        .select(COLUMNS)
        .eq("dept", dept)
        .like("code_commune", `${code_commune}%`)
        .gte("annee", annee_min)
        .lte("annee", annee_max)
        .not("type_local", "is", null)
        .neq("type_local", "Dépendance")
        .range(offset, offset + pageSize - 1)
    );
    if (rows.length > 0) return rows;
  }

  // Strategy 2: just LIKE on code_commune without dept (broader)
  const rows = await paginateQuery((offset, pageSize) =>
    supabase
      .from("dvf_points")
      .select(COLUMNS)
      .like("code_commune", `${code_commune}%`)
      .gte("annee", annee_min)
      .lte("annee", annee_max)
      .not("type_local", "is", null)
      .neq("type_local", "Dépendance")
      .range(offset, offset + pageSize - 1)
  );
  if (rows.length > 0) return rows;

  // Strategy 3: geographic bounding box (~2km radius around commune center)
  if (dept && lat && lon) {
    const DELTA_LAT = 0.02; // ~2.2km
    const DELTA_LON = 0.03; // ~2.1km at 48°N
    return await paginateQuery((offset, pageSize) =>
      supabase
        .from("dvf_points")
        .select(COLUMNS)
        .eq("dept", dept)
        .gte("lat", lat - DELTA_LAT)
        .lte("lat", lat + DELTA_LAT)
        .gte("lon", lon - DELTA_LON)
        .lte("lon", lon + DELTA_LON)
        .gte("annee", annee_min)
        .lte("annee", annee_max)
        .not("type_local", "is", null)
        .neq("type_local", "Dépendance")
        .range(offset, offset + pageSize - 1)
    );
  }

  return rows;
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
  const lat = searchParams.get("lat") ? parseFloat(searchParams.get("lat")!) : undefined;
  const lon = searchParams.get("lon") ? parseFloat(searchParams.get("lon")!) : undefined;

  // Heatmap ou Zoom > 13 → points bruts
  if (mode === "heatmap" || zoom >= 13) {
    // Commune spécifique → pagination pour récupérer TOUS les points
    if (code_commune) {
      const allData = await fetchAllCommunePoints(
        code_commune, annee_min, annee_max,
        dept[0], lat, lon,
      );
      const filtered = type_local
        ? allData.filter((d) => d.type_local === type_local)
        : allData;
      return NextResponse.json({ mode: "points", data: filtered });
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

  const extraCols = cluster_level === "commune" ? ",loyer_median_m2,rendement_brut" : "";
  let q = supabase
    .from(`dvf_clusters_${cluster_level}`)
    .select(`cluster_id,lat,lon,count,prix_median,prix_m2_median,dept,type_local,nom${extraCols}`)
    .gte("count", cluster_level === "commune" ? 20 : 5);

  if (dept.length > 0) q = q.in("dept", dept);
  if (type_local) q = q.eq("type_local", type_local);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ mode: cluster_level, data });
}
