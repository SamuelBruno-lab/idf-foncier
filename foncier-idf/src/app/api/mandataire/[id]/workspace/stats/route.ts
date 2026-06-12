/**
 * GET /api/mandataire/[id]/workspace/stats
 *
 * Retourne les KPIs dashboard mandataire :
 *   - stats globales (leads, ventes, CA, retro estimée)
 *   - 5 leads les plus récents
 *   - 5 dernières commissions
 *   - palier prime cession courant
 *
 * Auth : UUID en URL (même pattern que /onboarding).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function paliersPrimeCession(nbFilleulsActifs: number) {
  if (nbFilleulsActifs >= 50) return { label: "Palier 4 — Réseau", pct: 25, next: null };
  if (nbFilleulsActifs >= 20) return { label: "Palier 3 — Senior", pct: 22, next: { at: 50, pct: 25 } };
  if (nbFilleulsActifs >= 10) return { label: "Palier 2 — Confirmé", pct: 20, next: { at: 20, pct: 22 } };
  if (nbFilleulsActifs >= 5) return { label: "Palier 1 — Établi", pct: 18, next: { at: 10, pct: 20 } };
  return { label: "Palier 0 — Démarrage", pct: 15, next: { at: 5, pct: 18 } };
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

  // Stats agrégées
  const { data: stats, error: statsErr } = await sb
    .from("v_mandataire_stats")
    .select("*")
    .eq("mandataire_id", id)
    .maybeSingle();

  if (statsErr) {
    return NextResponse.json({ ok: false, error: statsErr.message }, { status: 500 });
  }

  // 5 leads récents
  const { data: recentLeads } = await sb
    .from("dim_cabinet_leads")
    .select("id, visitor_name, address, status, created_at, mandat_signe_at, vente_prix_final")
    .eq("mandataire_id", id)
    .order("created_at", { ascending: false })
    .limit(5);

  // 5 commissions récentes
  const { data: recentCommissions } = await sb
    .from("v_mandataire_commissions")
    .select("*")
    .eq("mandataire_id", id)
    .limit(5);

  const nbFilleuls = stats?.nb_filleuls_actifs ?? 0;
  const palier = paliersPrimeCession(nbFilleuls);

  return NextResponse.json({
    ok: true,
    stats: stats ?? {
      total_leads: 0,
      leads_actifs: 0,
      leads_mandat_signe: 0,
      leads_vendus: 0,
      ca_eurealimmo_total: 0,
      retrocession_estimee_total: 0,
      nb_filleuls_total: 0,
      nb_filleuls_actifs: 0,
    },
    palier,
    recentLeads: recentLeads ?? [],
    recentCommissions: recentCommissions ?? [],
  });
}
