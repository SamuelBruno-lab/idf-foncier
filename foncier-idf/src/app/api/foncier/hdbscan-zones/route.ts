import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

/**
 * Returns HDBSCAN micro-market zones for a given commune (or dept).
 * Each zone has a convex hull polygon, prix_m2 stats, and transaction count.
 *
 * Query params:
 *  - insee: commune code (required for commune-level, loads ~5-20 zones)
 *  - dept: department code (loads all zones for a dept, can be large)
 *  - type_local: filter by property type (Appartement, Maison, etc.)
 *  - limit: max zones (default 200)
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const insee = searchParams.get("insee");
  const dept = searchParams.get("dept");
  const typeLocal = searchParams.get("type_local");
  const limit = Number(searchParams.get("limit") ?? "200");

  if (!insee && !dept) {
    return NextResponse.json(
      { error: "Parameter 'insee' or 'dept' is required" },
      { status: 400 }
    );
  }

  let q = supabase
    .from("dvf_hdbscan_zones")
    .select(
      "id,code_commune,nom_commune,dept,type_local,cluster_id,count,prix_m2_median,prix_m2_p25,prix_m2_p75,prix_median,hull_coords,centroid_lat,centroid_lon"
    )
    .gte("count", 5)
    .not("hull_coords", "is", null)
    .order("count", { ascending: false })
    .limit(limit);

  if (insee) {
    q = q.eq("code_commune", insee);
  } else if (dept) {
    q = q.eq("dept", dept);
  }

  if (typeLocal) {
    q = q.eq("type_local", typeLocal);
  }

  const { data, error } = await q;

  if (error) {
    console.error("hdbscan-zones error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Convert hull_coords [[lat,lon],...] to GeoJSON features for easy rendering
  const features = (data ?? [])
    .filter((z) => Array.isArray(z.hull_coords) && z.hull_coords.length >= 3)
    .map((z) => {
      // hull_coords is [[lat,lon],...] — GeoJSON needs [[lon,lat],...]
      const coords = z.hull_coords.map((p: number[]) => [p[1], p[0]]);
      // Close the ring
      if (
        coords.length > 0 &&
        (coords[0][0] !== coords[coords.length - 1][0] ||
          coords[0][1] !== coords[coords.length - 1][1])
      ) {
        coords.push(coords[0]);
      }

      return {
        type: "Feature" as const,
        geometry: {
          type: "Polygon" as const,
          coordinates: [coords],
        },
        properties: {
          id: z.id,
          code_commune: z.code_commune,
          nom_commune: z.nom_commune,
          type_local: z.type_local,
          cluster_id: z.cluster_id,
          count: z.count,
          prix_m2_median: z.prix_m2_median,
          prix_m2_p25: z.prix_m2_p25,
          prix_m2_p75: z.prix_m2_p75,
          prix_median: z.prix_median,
        },
      };
    });

  return NextResponse.json({
    type: "FeatureCollection",
    count: features.length,
    features,
  });
}
