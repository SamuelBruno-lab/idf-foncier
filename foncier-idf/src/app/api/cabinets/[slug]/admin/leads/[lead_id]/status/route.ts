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
  const { data: lead } = await sb
    .from("dim_cabinet_leads")
    .select("id, cabinet_slug")
    .eq("id", lead_id)
    .maybeSingle();

  if (!lead || lead.cabinet_slug !== slug) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  // Appel de la fonction Postgres change_lead_status (log auto dans history)
  const { data: result, error } = await sb.rpc("change_lead_status", {
    p_lead_id: lead_id,
    p_new_status: newStatus,
    p_changed_by_email: session.email,
    p_note: note,
  });

  if (error) {
    console.error("[admin/leads/status] rpc error:", error);
    return NextResponse.json({ error: "db_error", details: error.message }, { status: 500 });
  }

  const row = Array.isArray(result) ? result[0] : result;

  return NextResponse.json({
    ok: true,
    lead_id,
    old_status: row?.old_status ?? null,
    new_status: row?.new_status ?? newStatus,
    changed_at: row?.changed_at ?? new Date().toISOString(),
  });
}
