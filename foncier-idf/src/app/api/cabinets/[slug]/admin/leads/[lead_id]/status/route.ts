/**
 * PATCH /api/cabinets/{slug}/admin/leads/{lead_id}/status
 *
 * Change le statut d'un lead du cabinet via la fonction Postgres
 * change_lead_status qui log automatiquement dans dim_lead_status_history.
 *
 * Body JSON :
 *   {
 *     "new_status": "contacted" | "rdv_planifie" | "mandat_signe" | "vendu" | "non_vendu" | "lost" | "new",
 *     "note": "optionnel"
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminSession } from "@/lib/admin-auth";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const VALID_STATUSES = [
  "new",
  "contacted",
  "rdv_planifie",
  "mandat_signe",
  "vendu",
  "non_vendu",
  "lost",
] as const;

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; lead_id: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug, lead_id } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  // Auth
  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { new_status?: string; note?: string };
  try {
    body = (await req.json()) as { new_status?: string; note?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const newStatus = body.new_status?.trim();
  if (!newStatus || !VALID_STATUSES.includes(newStatus as (typeof VALID_STATUSES)[number])) {
    return NextResponse.json(
      { error: "invalid_status", valid: VALID_STATUSES },
      { status: 400 },
    );
  }

  const note = body.note?.trim().slice(0, 1000) || null;

  const sb = getSupabase();

  // Vérif d'abord que ce lead appartient bien à ce cabinet (sécurité)
  // ET récupère l'ancien statut pour l'historique
  const { data: leadRow, error: leadErr } = await sb
    .from("dim_cabinet_leads")
    .select("id, cabinet_slug, status")
    .eq("id", lead_id)
    .maybeSingle();

  if (leadErr) {
    console.error("[admin/leads/status] lead lookup error:", leadErr);
    return NextResponse.json(
      { error: "db_error", details: leadErr.message },
      { status: 500 },
    );
  }
  const lead = leadRow as unknown as { id: string; cabinet_slug: string; status: string } | null;
  if (!lead || lead.cabinet_slug !== slug) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  const oldStatus = lead.status;
  const changedAt = new Date().toISOString();

  // UPDATE direct (plus robuste qu'une RPC plpgsql qui peut planter sur trigger)
  const { error: updateErr } = await sb
    .from("dim_cabinet_leads")
    .update({ status: newStatus, updated_at: changedAt })
    .eq("id", lead_id);

  if (updateErr) {
    console.error("[admin/leads/status] update error:", updateErr);
    return NextResponse.json(
      { error: "update_failed", details: updateErr.message },
      { status: 500 },
    );
  }

  // Log dans l'historique (best-effort — non bloquant)
  const { error: historyErr } = await sb.from("dim_lead_status_history").insert({
    lead_id,
    from_status: oldStatus === newStatus ? oldStatus : oldStatus,
    to_status: newStatus,
    changed_at: changedAt,
    changed_by_email: session.email,
    note,
  });
  if (historyErr) {
    console.warn("[admin/leads/status] history insert failed (non-bloquant):", historyErr);
  }

  return NextResponse.json({
    ok: true,
    lead_id,
    old_status: oldStatus,
    new_status: newStatus,
    changed_at: changedAt,
  });
}
