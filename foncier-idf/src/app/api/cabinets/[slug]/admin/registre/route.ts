/**
 * GET /api/cabinets/{slug}/admin/registre
 *
 * Liste les mandats signés du cabinet (= registre carte T) avec leur
 * status d'ancrage blockchain. Source : vue v_cabinet_registre_mandats_extended.
 *
 * Auth : session admin cabinet (cookie dm_admin_session).
 *
 * Query params optionnels :
 *   - ?status=pending|batched|anchored|all → filtre sur anchor_status
 *   - ?type=vente|recherche|location|all → filtre sur mandat_type
 *   - ?limit=50 (default 50, max 200)
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

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const statusFilter = sp.get("status") ?? "all";
  const typeFilter = sp.get("type") ?? "all";
  const limit = Math.min(Math.max(Number(sp.get("limit") ?? "50"), 1), 200);

  const sb = getSupabase();

  let query = sb
    .from("v_cabinet_registre_mandats_extended")
    .select("*")
    .eq("cabinet_slug", slug)
    .order("mandat_signe_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (statusFilter !== "all") {
    if (statusFilter === "not_anchored") {
      // Mandats signés sans ancrage (anchor_status null)
      query = query.is("anchor_status", null);
    } else {
      query = query.eq("anchor_status", statusFilter);
    }
  }
  if (typeFilter !== "all") {
    query = query.eq("mandat_type", typeFilter);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[admin/registre] query error:", error);
    return NextResponse.json({ error: "db_error", detail: error.message }, { status: 500 });
  }

  // Stats agrégées en un seul aller-retour (count par status)
  const { data: stats } = await sb
    .from("v_cabinet_registre_mandats_extended")
    .select("anchor_status, mandat_type")
    .eq("cabinet_slug", slug);

  const counters = {
    total: stats?.length ?? 0,
    by_status: {
      not_anchored: 0,
      pending: 0,
      batched: 0,
      anchored: 0,
      failed: 0,
      opted_out: 0,
    } as Record<string, number>,
    by_type: { vente: 0, recherche: 0, location: 0, autre: 0 } as Record<string, number>,
  };

  const statsRows = (stats ?? []) as unknown as Array<{
    anchor_status: string | null;
    mandat_type: string | null;
  }>;
  for (const row of statsRows) {
    const k = row.anchor_status ?? "not_anchored";
    counters.by_status[k] = (counters.by_status[k] ?? 0) + 1;
    const t = row.mandat_type ?? "autre";
    counters.by_type[t] = (counters.by_type[t] ?? 0) + 1;
  }

  return NextResponse.json({
    mandates: data ?? [],
    counters,
    filters: { status: statusFilter, type: typeFilter, limit },
  });
}
