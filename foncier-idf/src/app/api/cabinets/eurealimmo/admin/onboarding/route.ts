/**
 * GET /api/cabinets/eurealimmo/admin/onboarding
 *
 * Dashboard admin : retourne la liste des mandataires avec leur % de complétion,
 * leur étape courante, et le nombre de jours d'inactivité.
 *
 * Auth : cookie session admin Eurealimmo (pattern admin-auth.ts).
 *
 * Query params optionnels :
 *   - filter=stagnant : ne retourne que les mandataires inactifs > 7 jours
 *   - filter=blocked : ne retourne que les mandataires bloqués sur une étape
 *   - filter=ready : ne retourne que les mandataires prêts pour 1er mandat
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

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Auth admin
  const session = getAdminSession(req);
  if (!session || session.slug !== "eurealimmo") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const filter = url.searchParams.get("filter");

  const sb = getSupabase();
  let query = sb
    .from("v_eurealimmo_onboarding_summary")
    .select("*")
    .order("last_activity_at", { ascending: false, nullsFirst: false });

  // Filtres
  if (filter === "stagnant") {
    query = query.gte("days_since_last_activity", 7);
  } else if (filter === "blocked") {
    query = query.gt("blocked_steps", 0);
  } else if (filter === "ready") {
    query = query.eq("ready_for_first_mandate", true);
  }

  const { data: mandataires, error } = await query;

  if (error) {
    console.error("[admin/onboarding] fetch error:", error);
    return NextResponse.json(
      { ok: false, error: "db_error", detail: error.message },
      { status: 500 },
    );
  }

  // Stats globales
  const all = (mandataires ?? []) as Array<{
    mandataire_id: string;
    pct_completion: number | null;
    days_since_last_activity: number | null;
    ready_for_first_mandate: boolean | null;
    blocked_steps: number | null;
  }>;

  const stats = {
    total: all.length,
    avg_completion: all.length
      ? Math.round(
          all.reduce((a, b) => a + (b.pct_completion ?? 0), 0) / all.length,
        )
      : 0,
    ready_count: all.filter((m) => m.ready_for_first_mandate).length,
    stagnant_count: all.filter((m) => (m.days_since_last_activity ?? 0) >= 7).length,
    blocked_count: all.filter((m) => (m.blocked_steps ?? 0) > 0).length,
  };

  return NextResponse.json({ ok: true, mandataires: all, stats });
}
