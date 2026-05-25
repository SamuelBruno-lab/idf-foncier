/**
 * GET /api/cabinets/{slug}
 *
 * Renvoie les infos publiques de branding d'un cabinet (utilisé par les pages
 * white-label /cabinets/{slug}/...). Ne renvoie AUCUNE info sensible (pas de
 * clé API, pas de hash, juste le branding visible).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("dim_cabinets_white_label")
    .select(
      "slug, cabinet_name, primary_color, secondary_color, logo_url, cta_contact_url, cta_contact_label, contact_email, contact_phone, legal_mention",
    )
    .eq("slug", slug.toLowerCase())
    .eq("active", true)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "cabinet_not_found" }, { status: 404 });
  }
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, max-age=300" }, // cache CDN 5 min
  });
}
