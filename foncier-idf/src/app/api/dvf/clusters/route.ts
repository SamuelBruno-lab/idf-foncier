import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
    let q = supabase
      .from("dvf_points")
      .select("id,lat,lon,valeur_fonciere,prix_m2,surface,type_local,date_mutation,adresse,commune,code_commune,dept,annee")
      .gte("annee", annee_min)
      .lte("annee", annee_max)
      .limit(mode === "heatmap" ? 15000 : 2000);

    if (code_commune) {
      // Filtrer par commune (INSEE) — ne pas ajouter dept (redondant) ni
      // type_local dans la requête SQL pour éviter les timeouts Supabase
      // quand il n'y a pas d'index composite. On filtre type_local côté JS.
      // Exclure Dépendance et null pour maximiser les résultats utiles
      // dans la limite de lignes Supabase (1000 par défaut).
      q = q.eq("code_commune", code_commune)
        .not("type_local", "is", null)
        .neq("type_local", "Dépendance");
    } else {
      if (dept.length > 0) q = q.in("dept", dept);
      if (type_local) q = q.eq("type_local", type_local);
      if (commune) q = q.ilike("commune", `%${commune}%`);
    }

    const { data, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Filtre type_local côté JS quand code_commune est utilisé
    const filtered = (code_commune && type_local)
      ? (data ?? []).filter((d: { type_local?: string }) => d.type_local === type_local)
      : data;

    return NextResponse.json({ mode: "points", data: filtered });
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
