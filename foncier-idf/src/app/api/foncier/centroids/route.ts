import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Returns parcel centroids for a commune.
 * Used by the HDBSCAN micro-zone matching script.
 * ?insee=92078&limit=2000&offset=0
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const insee = searchParams.get("insee");
  const limit = Number(searchParams.get("limit") ?? "1000");
  const offset = Number(searchParams.get("offset") ?? "0");

  if (!insee) {
    return NextResponse.json({ error: "insee required" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // Use raw SQL via RPC to get centroids (ST_X/ST_Y on centroid of geom)
  const { data, error } = await supabase.rpc("get_parcel_centroids", {
    p_insee: insee,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    // Fallback: if RPC doesn't exist, return error with instructions
    return NextResponse.json({
      error: "RPC get_parcel_centroids not found. Create it with: " +
        "CREATE FUNCTION get_parcel_centroids(p_insee TEXT, p_limit INT DEFAULT 1000, p_offset INT DEFAULT 0) " +
        "RETURNS TABLE(parcel_id TEXT, centroid_lon FLOAT, centroid_lat FLOAT) AS $$ " +
        "SELECT parcel_id, ST_X(ST_Centroid(ST_Transform(geom, 4326))), ST_Y(ST_Centroid(ST_Transform(geom, 4326))) " +
        "FROM parcels WHERE insee_code = p_insee ORDER BY parcel_id LIMIT p_limit OFFSET p_offset $$ LANGUAGE sql STABLE;",
      items: [],
    }, { status: 200 });
  }

  return NextResponse.json({ items: data ?? [], count: data?.length ?? 0 });
}
