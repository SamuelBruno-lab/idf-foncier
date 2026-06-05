import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_FIELDS = [
  "radius_mandataire_km",
  "radius_apporteur_km",
  "radius_vendeur_km",
  "radius_acheteur_km",
  "radius_paris_km",
  "radius_metro_km",
  "radius_default_km",
  "min_matches",
  "max_matches",
  "adaptive_mode",
  "adaptive_target_matches",
  "adaptive_max_radius_km",
  "show_no_match_message",
] as const;

/**
 * GET /api/cabinets/[slug]/matching/config
 * Récupère la config matching du cabinet.
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("matching_config")
    .select("*")
    .eq("cabinet_slug", slug)
    .single();

  if (error || !data) {
    // Si pas de config, créer la ligne par défaut
    const { data: created, error: insertErr } = await supabase
      .from("matching_config")
      .insert({ cabinet_slug: slug })
      .select("*")
      .single();

    if (insertErr) {
      return NextResponse.json(
        { error: "config_unavailable", message: insertErr.message },
        { status: 500 },
      );
    }
    return NextResponse.json(created);
  }

  return NextResponse.json(data);
}

/**
 * PUT /api/cabinets/[slug]/matching/config
 * Met à jour la config matching (depuis dashboard admin).
 * Body : { radius_mandataire_km?: number, ... }
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ slug: string }> },
) {
  const { slug } = await ctx.params;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Whitelist des champs autorisés
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of ALLOWED_FIELDS) {
    if (field in body) {
      patch[field] = body[field];
    }
  }

  // Validation basique : tous les rayons doivent être >= 1
  for (const key of Object.keys(patch)) {
    if (key.startsWith("radius_") && key.endsWith("_km")) {
      const v = patch[key];
      if (typeof v !== "number" || v < 1 || v > 5000) {
        return NextResponse.json(
          {
            error: "invalid_value",
            field: key,
            message: "Doit être un nombre entre 1 et 5000 km",
          },
          { status: 400 },
        );
      }
    }
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("matching_config")
    .update(patch)
    .eq("cabinet_slug", slug)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "update_failed", message: error?.message },
      { status: 500 },
    );
  }

  return NextResponse.json(data);
}
