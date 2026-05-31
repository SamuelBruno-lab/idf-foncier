/**
 * GET /api/cabinets/eurealimmo/admin/applications
 *
 * Liste les candidatures Eurealimmo reçues via /eurealimmo-reseau/apply.
 *
 * Auth : cookie session admin Eurealimmo.
 *
 * Query params :
 *   - status=new|reviewing|call_scheduled|call_done|accepted|rejected|withdrawn
 *   - limit=20 (default)
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

const VALID_STATUS = new Set([
  "new",
  "reviewing",
  "call_scheduled",
  "call_done",
  "accepted",
  "rejected",
  "withdrawn",
]);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = getAdminSession(req);
  if (!session || session.slug !== "eurealimmo") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10) || 50, 200);

  const sb = getSupabase();
  let query = sb
    .from("eurealimmo_applications")
    .select(
      "id, first_name, last_name, email, phone, current_status, current_network, years_experience, has_carte_t, specialty, motivation, status, source, referred_by_email, consent_given, created_at, reviewed_at, reviewer_notes",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status && VALID_STATUS.has(status)) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[admin/applications] fetch error:", error);
    return NextResponse.json(
      { ok: false, error: "db_error", detail: error.message },
      { status: 500 },
    );
  }

  // Stats par status
  const { data: statsData } = await sb
    .from("eurealimmo_applications")
    .select("status", { count: "exact", head: false });

  const stats: Record<string, number> = {
    new: 0,
    reviewing: 0,
    call_scheduled: 0,
    call_done: 0,
    accepted: 0,
    rejected: 0,
    withdrawn: 0,
  };
  for (const row of (statsData ?? []) as Array<{ status: string }>) {
    if (row.status in stats) stats[row.status]++;
  }
  stats.total = (statsData ?? []).length;

  return NextResponse.json({ ok: true, applications: data ?? [], stats });
}

/**
 * PATCH /api/cabinets/eurealimmo/admin/applications
 *
 * Met à jour le status d'une candidature.
 * Body : { application_id: string, status: string, reviewer_notes?: string }
 */
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const session = getAdminSession(req);
  if (!session || session.slug !== "eurealimmo") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: { application_id?: string; status?: string; reviewer_notes?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const application_id = (body.application_id ?? "").trim();
  const status = (body.status ?? "").trim();
  if (!application_id) {
    return NextResponse.json({ ok: false, error: "application_id_required" }, { status: 400 });
  }
  if (!VALID_STATUS.has(status)) {
    return NextResponse.json({ ok: false, error: "invalid_status" }, { status: 400 });
  }

  const sb = getSupabase();
  const update: Record<string, unknown> = {
    status,
    reviewed_at: new Date().toISOString(),
    reviewer_email: session.email,
  };
  if (body.reviewer_notes) update.reviewer_notes = body.reviewer_notes.trim().slice(0, 2000);

  const { error } = await sb
    .from("eurealimmo_applications")
    .update(update)
    .eq("id", application_id);

  if (error) {
    return NextResponse.json(
      { ok: false, error: "db_error", detail: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, application_id, status });
}
