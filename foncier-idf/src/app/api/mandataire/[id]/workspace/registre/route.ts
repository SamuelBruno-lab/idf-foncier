/**
 * GET /api/mandataire/[id]/workspace/registre
 *
 * Registre des mandats (obligation Hoguet décret 72-678 art. 73) :
 *   - tous les mandats signés par ce mandataire, chronologiques
 *   - numéro de registre, type, date signature, date fin, état
 *
 * Format : conforme registre officiel art. 65 (numérotation continue).
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
      "id, mandat_numero_registre, mandat_type, mandat_modalite, mandat_signe_at, mandat_duree_mois, visitor_name, address, mandat_commission_pct, mandat_pdf_url, vente_date, vente_prix_final",
    )
    .eq("mandataire_id", id)
    .not("mandat_signe_at", "is", null)
    .order("mandat_numero_registre", { ascending: true });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mandats: data ?? [] });
}
