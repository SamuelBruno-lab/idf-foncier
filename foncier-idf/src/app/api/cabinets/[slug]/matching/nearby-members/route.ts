import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase-server";
import {
  findNearbyMembers,
  type MemberType,
} from "@/lib/matching/find-nearby-members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/cabinets/[slug]/matching/nearby-members
 *
 * Query params :
 *   lat     : number  (latitude WGS84)
 *   lng     : number  (longitude WGS84)
 *   types   : string  (comma-separated : vendeur,acheteur,mandataire,apporteur)
 *
 * Réponse : { matches, radius_km_used, total_matches_found,
 *             adaptive_iterations, no_match_message? }
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const url = new URL(req.url);

  const latRaw = url.searchParams.get("lat");
  const lngRaw = url.searchParams.get("lng");
  const typesRaw = url.searchParams.get("types");

  if (!latRaw || !lngRaw) {
    return NextResponse.json(
      { error: "Missing required query params : lat, lng" },
      { status: 400 },
    );
  }

  const lat = Number(latRaw);
  const lng = Number(lngRaw);
  if (Number.isNaN(lat) || Number.isNaN(lng)) {
    return NextResponse.json(
      { error: "Invalid lat/lng" },
      { status: 400 },
    );
  }

  let memberTypes: MemberType[] | undefined;
  if (typesRaw) {
    const arr = typesRaw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s): s is MemberType =>
        ["vendeur", "acheteur", "mandataire", "apporteur"].includes(s),
      );
    if (arr.length > 0) memberTypes = arr;
  }

  try {
    const supabase = getSupabaseServerClient();
    const result = await findNearbyMembers({
      supabase,
      cabinetSlug: slug,
      leadLat: lat,
      leadLng: lng,
      memberTypes,
    });

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: "matching_failed", message },
      { status: 500 },
    );
  }
}
