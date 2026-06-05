/**
 * POST /api/mandataire/[id]/onboarding/step
 *
 * Met à jour le statut d'une étape pour un mandataire :
 *   - status : pending | in_progress | completed | skipped | blocked
 *   - evidence_url : URL d'un doc uploadé (RCP, ALUR, CCI…)
 *   - notes : commentaire libre
 *   - blocker_reason : raison du blocage
 *
 * Body : { step_key: string, status: string, evidence_url?: string, notes?: string, blocker_reason?: string }
 *
 * Règle anti-cheat : un mandataire ne peut PAS auto-valider les étapes
 * dont validation_type = 'admin_validation' (ex: signature contrat, CCI).
 * Ces étapes nécessitent l'endpoint admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ensureMandatGenerated } from "@/lib/contracts/store-mandat";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUS = new Set(["pending", "in_progress", "completed", "skipped", "blocked"]);

type Payload = {
  step_key?: string;
  status?: string;
  evidence_url?: string;
  notes?: string;
  blocker_reason?: string;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const step_key = (body.step_key ?? "").trim();
  const status = (body.status ?? "").trim();
  if (!step_key) {
    return NextResponse.json({ ok: false, error: "step_key_required" }, { status: 400 });
  }
  if (!VALID_STATUS.has(status)) {
    return NextResponse.json({ ok: false, error: "invalid_status" }, { status: 400 });
  }

  const sb = getSupabase();

  // 1. Récupère l'étape (vérifie validation_type)
  const { data: step } = await sb
    .from("eurealimmo_onboarding_steps")
    .select("id, step_key, validation_type, is_required")
    .eq("step_key", step_key)
    .maybeSingle();

  if (!step) {
    return NextResponse.json({ ok: false, error: "step_not_found" }, { status: 404 });
  }

  const s = step as { id: string; step_key: string; validation_type: string; is_required: boolean };

  // 2. Règle anti-cheat : mandataire ne peut pas auto-valider 'admin_validation'
  if (status === "completed" && s.validation_type === "admin_validation") {
    return NextResponse.json(
      {
        ok: false,
        error: "requires_admin_validation",
        detail:
          "Cette étape nécessite la validation de Samuel BRUNO. Vous pouvez la marquer 'en cours' mais pas 'complétée'.",
      },
      { status: 403 },
    );
  }

  // 3. Pour les étapes 'document_upload', exige un evidence_url si status=completed
  if (
    status === "completed" &&
    s.validation_type === "document_upload" &&
    !body.evidence_url
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: "evidence_required",
        detail:
          "Cette étape nécessite l'upload d'un document. Veuillez uploader votre attestation avant de marquer 'complété'.",
      },
      { status: 400 },
    );
  }

  // 4. Vérifie que le mandataire existe
  const { data: m } = await sb
    .from("eurealimmo_mandataires")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!m) {
    return NextResponse.json({ ok: false, error: "mandataire_not_found" }, { status: 404 });
  }

  // 5. Upsert la progression
  const updateRow: Record<string, unknown> = {
    mandataire_id: id,
    step_id: s.id,
    status,
    updated_at: new Date().toISOString(),
  };
  if (status === "completed") updateRow.completed_at = new Date().toISOString();
  if (body.evidence_url) updateRow.evidence_url = body.evidence_url.trim().slice(0, 500);
  if (body.notes) updateRow.notes = body.notes.trim().slice(0, 1000);
  if (body.blocker_reason) updateRow.blocker_reason = body.blocker_reason.trim().slice(0, 500);

  const { error: upsertErr } = await sb
    .from("eurealimmo_onboarding_progress")
    .upsert(updateRow, { onConflict: "mandataire_id,step_id" });

  if (upsertErr) {
    console.error("[onboarding/step] upsert error:", upsertErr);
    return NextResponse.json(
      { ok: false, error: "db_error", detail: upsertErr.message },
      { status: 500 },
    );
  }

  // 6. Auto-génération du contrat dès que le mandataire ATTAQUE l'étape contrat
  //    (status in_progress), afin qu'il soit prêt à envoyer en signature.
  //    Best-effort, non bloquant : n'altère jamais la réponse onboarding.
  //    (Nécessite founder_number renseigné ; ignoré silencieusement sinon.)
  let contract_generated: boolean | undefined;
  if (step_key === "contrat_signe" && status === "in_progress") {
    try {
      const res = await ensureMandatGenerated(sb, id);
      contract_generated = res.ok;
      if (!res.ok) console.warn("[onboarding/step] contrat non généré:", res.reason);
    } catch (e) {
      console.warn("[onboarding/step] ensureMandatGenerated exception:", e);
    }
  }

  return NextResponse.json({ ok: true, step_key, status, ...(contract_generated !== undefined ? { contract_generated } : {}) });
}
