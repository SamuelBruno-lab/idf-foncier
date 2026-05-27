/**
 * GET /api/cabinets/{slug}/admin/leads
 *
 * Liste les leads du cabinet (auth admin requise via cookie session).
 * Query params optionnels :
 *   ?status=new,contacted   (filtre statuts, multi-séparé virgule)
 *   ?search=texte           (search visitor_name, email, address)
 *   ?limit=50&offset=0      (pagination)
 *
 * Renvoie :
 *   { leads: [...], counts_by_status: {...}, total: 42 }
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

  // Auth : la session doit matcher ce cabinet
  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const statusFilter = sp.get("status");
  const search = sp.get("search")?.trim() ?? "";
  const limit = Math.min(Number(sp.get("limit")) || 100, 500);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);

  const sb = getSupabase();

  // Counts by status (pour les badges du kanban)
  const { data: countsRaw } = await sb
    .from("dim_cabinet_leads")
    .select("status")
    .eq("cabinet_slug", slug);
  const counts_by_status: Record<string, number> = {};
  for (const row of countsRaw ?? []) {
    const s = (row as { status: string }).status;
    counts_by_status[s] = (counts_by_status[s] ?? 0) + 1;
  }

  // Query principale
  let query = sb
    .from("dim_cabinet_leads")
    .select(
      "id, visitor_name, visitor_email, visitor_phone, intent, type_bien, address, surface, prix_total_median, prix_m2_median, status, created_at, updated_at",
      { count: "exact" },
    )
    .eq("cabinet_slug", slug)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (statusFilter) {
    const statuses = statusFilter.split(",").map((s) => s.trim()).filter(Boolean);
    if (statuses.length > 0) query = query.in("status", statuses);
  }

  if (search.length >= 2) {
    // ILIKE OR sur nom/email/adresse
    const pattern = `%${search}%`;
    query = query.or(
      `visitor_name.ilike.${pattern},visitor_email.ilike.${pattern},address.ilike.${pattern}`,
    );
  }

  const { data: leads, count, error } = await query;

  if (error) {
    console.error("[admin/leads] query error:", error);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  return NextResponse.json({
    leads: leads ?? [],
    counts_by_status,
    total: count ?? 0,
    offset,
    limit,
  });
}
