/**
 * GET /api/mandataire/[id]/workspace/commissions
 *
 * Retourne toutes les commissions du mandataire (à venir + encaissées).
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
    .from("v_mandataire_commissions")
    .select("*")
    .eq("mandataire_id", id);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const commissions = data ?? [];
  const totalAVenir = commissions
    .filter((c) => c.statut_commission === "a_venir")
    .reduce((acc, c) => acc + Number(c.retrocession_mandataire ?? 0), 0);
  const totalEncaisse = commissions
    .filter((c) => c.statut_commission === "encaissee_attente_versement")
    .reduce((acc, c) => acc + Number(c.retrocession_mandataire ?? 0), 0);

  return NextResponse.json({
    ok: true,
    commissions,
    totals: { a_venir: totalAVenir, encaisse: totalEncaisse },
  });
}
