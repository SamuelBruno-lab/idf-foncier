import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

const COLUMNS = "id,lat,lon,valeur_fonciere,prix_m2,surface,type_local,date_mutation,adresse,commune,code_commune,dept,annee";

// Seuils outliers prix/m² — par département (garde-fou absolu)
// Paris/petite couronne tolère plus que grande couronne
const PRIX_M2_MAX_BY_DEPT: Record<string, Record<string, number>> = {
  "75": { Appartement: 18_000, Maison: 15_000, "Local industriel. commercial ou assimilé": 12_000 },
  "92": { Appartement: 13_000, Maison: 10_000, "Local industriel. commercial ou assimilé": 10_000 },
  "93": { Appartement: 8_000, Maison: 6_500, "Local industriel. commercial ou assimilé": 8_000 },
  "94": { Appartement: 10_000, Maison: 8_000, "Local industriel. commercial ou assimilé": 8_000 },
};
const PRIX_M2_MAX_DEFAULT: Record<string, number> = {
  Appartement: 8_000,
  Maison: 6_000,
  "Local industriel. commercial ou assimilé": 8_000,
};
const PRIX_M2_MIN = 500;
const SURFACE_MIN = 9; // m² — minimum légal d'habitation en France

/**
 * Filtre les outliers en deux passes :
 * 1. Seuils fixes par département (garde-fou)
 * 2. Filtre IQR statistique par commune × type (élimine les valeurs aberrantes locales)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function filterOutliers(rows: any[]): any[] {
  // Passe 1 : seuils fixes (surface min + prix/m² max par dept)
  const pass1 = rows.filter((r) => {
    if (r.surface != null && r.surface > 0 && r.surface < SURFACE_MIN) return false;
    const pm2 = r.prix_m2;
    if (pm2 == null) return true;
    if (pm2 < PRIX_M2_MIN) return false;
    const deptThresholds = PRIX_M2_MAX_BY_DEPT[r.dept] ?? PRIX_M2_MAX_DEFAULT;
    const max = deptThresholds[r.type_local] ?? PRIX_M2_MAX_DEFAULT[r.type_local];
    if (max && pm2 > max) return false;
    return true;
  });

  // Passe 2 : filtre IQR par (code_commune, type_local)
  // Regroupe les prix/m², calcule Q1/Q3/IQR, exclut ceux hors [Q1-1.5*IQR, Q3+1.5*IQR]
  const groups = new Map<string, number[]>();
  for (const r of pass1) {
    if (r.prix_m2 == null || !r.code_commune) continue;
    const key = `${r.code_commune}_${r.type_local ?? ""}`;
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(r.prix_m2);
  }

  const bounds = new Map<string, { lo: number; hi: number }>();
  for (const [key, prices] of groups) {
    if (prices.length < 6) continue; // pas assez pour un IQR fiable
    prices.sort((a, b) => a - b);
    const q1 = prices[Math.floor(prices.length * 0.25)];
    const q3 = prices[Math.floor(prices.length * 0.75)];
    const iqr = q3 - q1;
    bounds.set(key, { lo: q1 - 1.5 * iqr, hi: q3 + 1.5 * iqr });
  }

  return pass1.filter((r) => {
    if (r.prix_m2 == null || !r.code_commune) return true;
    const key = `${r.code_commune}_${r.type_local ?? ""}`;
    const b = bounds.get(key);
    if (!b) return true; // pas assez de données → pas de filtre IQR
    return r.prix_m2 >= b.lo && r.prix_m2 <= b.hi;
  });
}

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
  // Strategy 1: dept (indexed) + exact code_commune match
  // dept filter first so Postgres uses the dept index to narrow the scan.
  if (dept) {
    const rows = await paginateQuery((offset, pageSize) =>
      getSupabase()
        .from("dvf_points")
        .select(COLUMNS)
        .eq("dept", dept)
        .eq("code_commune", code_commune)
        .gte("annee", annee_min)
        .lte("annee", annee_max)
        .not("type_local", "is", null)
        .neq("type_local", "Dépendance")
        .range(offset, offset + pageSize - 1)
    );
    if (rows.length > 0) return rows;
  }

  // Strategy 2: exact code_commune match without dept
  const rows = await paginateQuery((offset, pageSize) =>
    getSupabase()
      .from("dvf_points")
      .select(COLUMNS)
      .eq("code_commune", code_commune)
      .gte("annee", annee_min)
      .lte("annee", annee_max)
      .not("type_local", "is", null)
      .neq("type_local", "Dépendance")
      .range(offset, offset + pageSize - 1)
  );
  if (rows.length > 0) return rows;

  // Strategy 3: geographic bounding box (~2km radius around commune center)
  // Filter client-side to keep only the exact commune
  if (dept && lat && lon) {
    const DELTA_LAT = 0.02; // ~2.2km
    const DELTA_LON = 0.03; // ~2.1km at 48°N
    const bboxRows = await paginateQuery((offset, pageSize) =>
      getSupabase()
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
    // bbox includes neighboring communes → filter to exact code_commune
    return bboxRows.filter((r) => r.code_commune === code_commune);
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
      return NextResponse.json({ mode: "points", data: filterOutliers(filtered) });
    }

    // Pas de commune → requête classique avec limit
    let q = getSupabase()
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

    return NextResponse.json({ mode: "points", data: filterOutliers(data ?? []) });
  }

  // Zoom < 13 → clusters pré-calculés
  const cluster_level = zoom >= 10 ? "commune" : zoom >= 7 ? "dept" : "region";

  const extraCols = cluster_level === "commune" ? ",loyer_median_m2,rendement_brut" : "";
  let q = getSupabase()
    .from(`dvf_clusters_${cluster_level}`)
    .select(`cluster_id,lat,lon,count,prix_median,prix_m2_median,dept,type_local,nom${extraCols}`)
    .gte("count", cluster_level === "commune" ? 20 : 5);

  if (dept.length > 0) q = q.in("dept", dept);
  if (type_local) q = q.eq("type_local", type_local);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ mode: cluster_level, data });
}
