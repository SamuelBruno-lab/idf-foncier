/**
 * GET /api/cabinets/{slug}/estimate?address=...&surface=...&type_local=...
 *
 * Endpoint dédié aux pages white-label /cabinets/{slug}/estimer.
 * Réutilise la logique métier interne (geocode + cluster HDBSCAN) sans exposer
 * de clé API au client. L'usage est tracé sur la clé du cabinet via api_key_id
 * dans dim_cabinets_white_label (pour comptage Stripe ultérieur).
 *
 * Filtre métier : on ne renvoie que les infos publiques nécessaires à
 * l'estimation visible côté visiteur (prix m² médian, fourchette p10/p90,
 * nb ventes DVF). On NE renvoie PAS le zone_id, les hull_coords, etc.
 */

import { NextRequest, NextResponse } from "next/server";
import { geocodeAddress } from "@/lib/geocode";
import { pointInPolygon } from "@/lib/geo";
import { getSupabaseServerClient } from "@/lib/supabase-server";

type ZoneRow = {
  id: string;
  count: number;
  hull_coords: number[][] | null;
  centroid_lat: number | null;
  centroid_lon: number | null;
  prix_m2_median: number | null;
  prix_m2_p10: number | null;
  prix_m2_p90: number | null;
};

function resolveTypeLocal(input: string | null): string {
  if (!input) return "Appartement";
  const v = input.toLowerCase().trim();
  if (v.startsWith("maison")) return "Maison";
  return "Appartement";
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const address = sp.get("address")?.trim() ?? "";
  const surface = Number(sp.get("surface")) || null;
  const typeLocal = resolveTypeLocal(sp.get("type_local"));

  if (address.length < 5) {
    return NextResponse.json(
      { available: false, reason: "address_too_short" },
      { status: 400 },
    );
  }

  const sb = getSupabaseServerClient();

  // 1) Vérifie que le cabinet existe et est actif
  const { data: cabinet } = await sb
    .from("dim_cabinets_white_label")
    .select("slug, active, api_key_id")
    .eq("slug", slug.toLowerCase())
    .eq("active", true)
    .maybeSingle();
  if (!cabinet) {
    return NextResponse.json({ error: "cabinet_not_found" }, { status: 404 });
  }

  // 2) Géocodage
  let top;
  try {
    const geo = await geocodeAddress(address, sb);
    top = geo.results[0];
  } catch {
    return NextResponse.json(
      { available: false, reason: "geocode_failed" },
      { status: 200 },
    );
  }
  if (!top) {
    return NextResponse.json(
      { available: false, reason: "address_not_found" },
      { status: 200 },
    );
  }

  // 3) Cluster lookup
  const { data: zones } = await sb
    .from("dvf_hdbscan_zones")
    .select(
      "id, count, hull_coords, centroid_lat, centroid_lon, prix_m2_median, prix_m2_p10, prix_m2_p90",
    )
    .eq("code_commune", top.code_insee)
    .eq("type_local", typeLocal);

  if (!zones || zones.length === 0) {
    return NextResponse.json(
      { available: false, address: top.label, reason: "no_cluster" },
      { status: 200 },
    );
  }

  const rows = zones as ZoneRow[];
  const point: [number, number] = [top.lat, top.lon];
  let match = rows.find((z) => z.hull_coords && pointInPolygon(point, z.hull_coords));
  if (!match) {
    let best: { row: ZoneRow; d: number } | null = null;
    for (const z of rows) {
      if (z.centroid_lat == null || z.centroid_lon == null) continue;
      const d = (z.centroid_lat - top.lat) ** 2 + (z.centroid_lon - top.lon) ** 2;
      if (!best || d < best.d) best = { row: z, d };
    }
    match = best?.row ?? rows[0];
  }

  if (!match.prix_m2_median) {
    return NextResponse.json(
      { available: false, address: top.label, reason: "no_prix_m2" },
      { status: 200 },
    );
  }

  const surface_safe = surface && surface > 0 ? surface : null;

  // 4) Log usage cabinet (non bloquant, pour Stripe billing futur)
  if (cabinet.api_key_id) {
    void sb.from("api_usage_log").insert({
      api_key_id: cabinet.api_key_id,
      endpoint: `/api/cabinets/${slug}/estimate`,
      method: "GET",
      status: 200,
      latency_ms: 0,
      ip: null,
      user_agent: req.headers.get("user-agent"),
      address_searched: address,
      insee_commune: top.code_insee,
      surface,
      billable: true,
    });
  }

  return NextResponse.json({
    available: true,
    address: top.label,
    prix_m2_median: match.prix_m2_median,
    prix_m2_p10: match.prix_m2_p10,
    prix_m2_p90: match.prix_m2_p90,
    prix_total_median: surface_safe ? Math.round(match.prix_m2_median * surface_safe) : null,
    nb_ventes: match.count,
  });
}
