/**
 * GET /api/cabinets/{slug}/admin/leads/{lead_id}
 *
 * Détail complet d'un lead avec son historique de statuts.
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
  ctx: { params: Promise<{ slug: string; lead_id: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug, lead_id } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const sb = getSupabase();

  const { data: lead, error } = await sb
    .from("dim_cabinet_leads")
    .select(
      "id, cabinet_slug, visitor_name, visitor_email, visitor_phone, " +
        "intent, type_bien, address, surface, wizard_answers, " +
        "prix_m2_median, prix_m2_p10, prix_m2_p90, prix_total_median, nb_ventes, " +
        "email_to_cabinet_sent, email_to_visitor_sent, status, " +
        "cabinet_notes, created_at, updated_at",
    )
    .eq("id", lead_id)
    .eq("cabinet_slug", slug)
    .maybeSingle();

  if (error) {
    console.error("[admin/leads/detail] query error:", error);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  if (!lead) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  // Historique des statuts
  const { data: history } = await sb
    .from("dim_lead_status_history")
    .select("from_status, to_status, changed_at, changed_by_email, note")
    .eq("lead_id", lead_id)
    .order("changed_at", { ascending: false });

  return NextResponse.json({ lead, history: history ?? [] });
}
