/**
 * GET /api/mandataire/[id]/onboarding
 *
 * Retourne la checklist d'onboarding d'un mandataire :
 *   - 10 étapes du référentiel
 *   - statut de chaque étape pour ce mandataire
 *   - métadonnées (% complétion, étape courante, ready_for_first_mandate)
 *
 * MVP : accès via id en URL (UUID = secret modéré). À renforcer en Y2
 * avec un signed token + Supabase Auth Magic Link.
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

type StepRow = {
  id: string;
  step_order: number;
  step_key: string;
  title: string;
  description: string;
  resource_url: string | null;
  estimated_days: number;
  is_required: boolean;
  validation_type: string;
  category: string;
};

type ProgressRow = {
  step_id: string;
  status: string;
  completed_at: string | null;
  evidence_url: string | null;
  notes: string | null;
  blocker_reason: string | null;
  updated_at: string;
};

type MandataireRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  specialty: string | null;
  commission_eurealimmo_pct: number | null;
  contract_signed_at: string | null;
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  const sb = getSupabase();

  // 1. Récupère le mandataire (vérifie qu'il existe)
  const { data: mandataire, error: mErr } = await sb
    .from("eurealimmo_mandataires")
    .select("id, first_name, last_name, email, specialty, commission_eurealimmo_pct, contract_signed_at")
    .eq("id", id)
    .maybeSingle();

  if (mErr) {
    console.error("[onboarding/GET] mandataire fetch error:", mErr);
    return NextResponse.json(
      { ok: false, error: "db_error", detail: mErr.message },
      { status: 500 },
    );
  }
  if (!mandataire) {
    return NextResponse.json({ ok: false, error: "mandataire_not_found" }, { status: 404 });
  }

  const m = mandataire as MandataireRow;

  // 2. Récupère les 10 étapes du référentiel
  const { data: steps } = await sb
    .from("eurealimmo_onboarding_steps")
    .select("id, step_order, step_key, title, description, resource_url, estimated_days, is_required, validation_type, category")
    .order("step_order", { ascending: true });

  const stepsRows = (steps ?? []) as StepRow[];

  // 3. Récupère la progression du mandataire
  const { data: progress } = await sb
    .from("eurealimmo_onboarding_progress")
    .select("step_id, status, completed_at, evidence_url, notes, blocker_reason, updated_at")
    .eq("mandataire_id", id);

  const progressMap = new Map<string, ProgressRow>();
  for (const p of (progress ?? []) as ProgressRow[]) {
    progressMap.set(p.step_id, p);
  }

  // 4. Si aucune progression existe encore, initialise les 10 étapes
  if (progressMap.size === 0 && stepsRows.length > 0) {
    await sb.rpc("init_onboarding_for_mandataire", { p_mandataire_id: id });
    // Recharge la progression
    const { data: progress2 } = await sb
      .from("eurealimmo_onboarding_progress")
      .select("step_id, status, completed_at, evidence_url, notes, blocker_reason, updated_at")
      .eq("mandataire_id", id);
    for (const p of (progress2 ?? []) as ProgressRow[]) {
      progressMap.set(p.step_id, p);
    }
  }

  // 5. Assemble la checklist
  const checklist = stepsRows.map((s) => {
    const p = progressMap.get(s.id);
    return {
      ...s,
      progress: p
        ? {
            status: p.status,
            completed_at: p.completed_at,
            evidence_url: p.evidence_url,
            notes: p.notes,
            blocker_reason: p.blocker_reason,
            updated_at: p.updated_at,
          }
        : { status: "pending" },
    };
  });

  const requiredSteps = stepsRows.filter((s) => s.is_required);
  const completedRequired = requiredSteps.filter(
    (s) => progressMap.get(s.id)?.status === "completed",
  ).length;
  const pctCompletion = requiredSteps.length
    ? Math.round((100 * completedRequired) / requiredSteps.length)
    : 0;

  // Étape courante = première non complétée et non skipped
  const currentStep = checklist.find(
    (s) =>
      s.is_required && !["completed", "skipped"].includes(s.progress.status),
  );

  return NextResponse.json({
    ok: true,
    mandataire: {
      id: m.id,
      first_name: m.first_name,
      last_name: m.last_name,
      email: m.email,
      specialty: m.specialty,
      tier:
        m.commission_eurealimmo_pct === 5
          ? "founder"
          : m.commission_eurealimmo_pct === 8
            ? "standard"
            : "pending",
      contract_signed_at: m.contract_signed_at,
    },
    checklist,
    summary: {
      total_required: requiredSteps.length,
      completed_required: completedRequired,
      pct_completion: pctCompletion,
      current_step_key: currentStep?.step_key ?? null,
      current_step_title: currentStep?.title ?? null,
    },
  });
}
