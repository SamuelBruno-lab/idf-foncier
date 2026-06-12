/**
 * GET /api/mandataire/[id]/workspace/leads
 *
 * Retourne tous les leads attribués à ce mandataire, groupés par statut.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  const sb = getSupabase();
  const { data, error } = await sb
    .from("dim_cabinet_leads")
    .select(
      "id, cabinet_slug, visitor_name, visitor_email, visitor_phone, address, status, created_at, mandat_type, mandat_signe_at, vente_prix_final, vente_date, surface_m2, prix_estime",
    )
    .eq("mandataire_id", id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, leads: data ?? [] });
}
