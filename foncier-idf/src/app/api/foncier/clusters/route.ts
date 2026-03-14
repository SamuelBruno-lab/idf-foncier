import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Returns HDBSCAN commune-level clusters for the foncier map overlay.
 * Only returns clusters with prix_m2_median and >= 20 transactions.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const dept = searchParams.get("dept")?.split(",").filter(Boolean) ?? [];

  let q = supabase
    .from("dvf_clusters_commune")
    .select(
      "cluster_id,lat,lon,count,prix_median,prix_m2_median,dept,type_local,nom,loyer_median_m2,rendement_brut"
    )
    .gte("count", 20)
    .not("prix_m2_median", "is", null);

  if (dept.length > 0) {
    q = q.in("dept", dept);
  }

  const { data, error } = await q;

  if (error) {
    console.error("foncier/clusters error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    count: data?.length ?? 0,
    items: data ?? [],
  });
}
