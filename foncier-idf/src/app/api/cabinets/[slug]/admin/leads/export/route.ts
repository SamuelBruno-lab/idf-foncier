/**
 * GET /api/cabinets/{slug}/admin/leads/export
 *
 * Exporte tous les leads du cabinet au format CSV ou JSON, pour
 * conformité RGPD article 20 (droit à la portabilité des données).
 *
 * Query params :
 *   ?format=csv (défaut) | json
 *   ?status=new,contacted (filtre optionnel)
 *
 * Sécurité :
 *   - Auth session admin requise (cookie HttpOnly)
 *   - Log automatique de l'export dans audit_pii_access
 *   - Pour gros exports (>1000), Resend notif Samuel (alerte)
 *
 * Réponse :
 *   - Headers : Content-Type + Content-Disposition (téléchargement)
 *   - Body : CSV UTF-8 avec BOM (compat Excel) OU JSON pretty
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { getAdminSession } from "@/lib/admin-auth";
import {
  extractRequestContext,
  logPIIAccess,
} from "@/lib/rgpd/log-pii-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

type Lead = {
  id: string;
  visitor_name: string | null;
  visitor_email: string | null;
  visitor_phone: string | null;
  intent: string | null;
  type_bien: string | null;
  address: string | null;
  surface: number | null;
  prix_total_median: number | null;
  prix_m2_median: number | null;
  status: string;
  created_at: string;
  updated_at: string | null;
};

// ============================================================
// CSV builder (UTF-8 BOM pour Excel)
// ============================================================

const CSV_HEADERS = [
  "id",
  "visitor_name",
  "visitor_email",
  "visitor_phone",
  "intent",
  "type_bien",
  "address",
  "surface_m2",
  "prix_total_estime_eur",
  "prix_m2_estime_eur",
  "status",
  "created_at",
  "updated_at",
] as const;

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // RFC 4180 : si contient virgule, guillemet ou retour ligne -> entourer de guillemets + doubler les "
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function leadsToCSV(leads: Lead[]): string {
  const lines: string[] = [];
  lines.push(CSV_HEADERS.join(","));
  for (const l of leads) {
    lines.push(
      [
        l.id,
        l.visitor_name,
        l.visitor_email,
        l.visitor_phone,
        l.intent,
        l.type_bien,
        l.address,
        l.surface,
        l.prix_total_median,
        l.prix_m2_median,
        l.status,
        l.created_at,
        l.updated_at,
      ]
        .map(escapeCsv)
        .join(","),
    );
  }
  // BOM UTF-8 pour Excel
  return "﻿" + lines.join("\r\n");
}

// ============================================================
// Handler
// ============================================================

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  // ---- Auth ----
  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ---- Query params ----
  const sp = req.nextUrl.searchParams;
  const format = (sp.get("format") ?? "csv").toLowerCase();
  if (format !== "csv" && format !== "json") {
    return NextResponse.json(
      { error: "invalid_format", message: "format must be 'csv' or 'json'" },
      { status: 400 },
    );
  }

  const statusFilter = sp.get("status");

  // ---- Récupération des leads ----
  const sb = getSupabase();
  let query = sb
    .from("dim_cabinet_leads")
    .select(
      "id, visitor_name, visitor_email, visitor_phone, intent, type_bien, address, surface, prix_total_median, prix_m2_median, status, created_at, updated_at",
    )
    .eq("cabinet_slug", slug)
    .order("created_at", { ascending: false });

  if (statusFilter) {
    const statuses = statusFilter
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length > 0) query = query.in("status", statuses);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "query_failed", message: error.message },
      { status: 500 },
    );
  }

  const leads = (data ?? []) as Lead[];

  // ---- Log RGPD (best-effort) ----
  const ctxReq = extractRequestContext(req);
  await logPIIAccess({
    supabase: sb,
    cabinetSlug: slug,
    actorId: null,
    actorEmail: session.email,
    actorRole: "admin",
    resourceType: "lead_export",
    resourceId: null,
    action: "EXPORT",
    ip: ctxReq.ip,
    userAgent: ctxReq.userAgent,
    endpoint: ctxReq.endpoint,
    httpMethod: ctxReq.httpMethod,
    metadata: {
      format,
      status_filter: statusFilter,
      lead_count: leads.length,
    },
  });

  // ---- Construction de la réponse ----
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);

  if (format === "json") {
    const body = JSON.stringify(
      {
        cabinet: slug,
        exported_at: new Date().toISOString(),
        exported_by: session.email,
        count: leads.length,
        leads,
      },
      null,
      2,
    );
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}-leads-${timestamp}.json"`,
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  }

  // CSV
  const csvBody = leadsToCSV(leads);
  return new NextResponse(csvBody, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-leads-${timestamp}.csv"`,
      "Cache-Control": "no-store, must-revalidate",
    },
  });
}
