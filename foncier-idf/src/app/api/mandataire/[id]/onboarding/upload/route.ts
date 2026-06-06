/**
 * POST /api/mandataire/[id]/onboarding/upload
 *
 * Upload direct d'un justificatif PDF (RCP, ALUR, CCI…) pour une étape
 * d'onboarding. Stocke dans Supabase Storage (bucket privé) et renvoie une
 * URL signée à utiliser comme evidence_url de l'étape.
 *
 * Body : multipart/form-data { file: PDF, step_key?: string }
 * Réponse : { ok, path, signed_url }
 *
 * Accès : via l'id mandataire en URL (même modèle que /onboarding/step).
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

const BUCKET = "mandataire-documents";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 10 * 1024 * 1024; // 10 Mo
const SIGNED_URL_TTL = 60 * 60 * 24 * 365; // 1 an

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  let file: File;
  let stepKey = "document";
  try {
    const form = await req.formData();
    const f = form.get("file");
    const sk = form.get("step_key");
    if (typeof sk === "string" && sk.trim()) {
      stepKey = sk.trim().replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
    }
    if (!(f instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "missing_file", message: "Champ 'file' requis (PDF)." },
        { status: 400 },
      );
    }
    file = f;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_form_data" }, { status: 400 });
  }

  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return NextResponse.json(
      { ok: false, error: "not_a_pdf", message: "Le fichier doit être un PDF." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { ok: false, error: "too_large", message: "PDF trop volumineux (max 10 Mo)." },
      { status: 400 },
    );
  }

  const sb = getSupabase();

  // Vérifie que le mandataire existe
  const { data: m } = await sb
    .from("eurealimmo_mandataires")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  if (!m) {
    return NextResponse.json({ ok: false, error: "mandataire_not_found" }, { status: 404 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_").slice(0, 120);
  const path = `${id}/${stepKey}/${Date.now()}-${safeName}`;

  const { error: upErr } = await sb.storage.from(BUCKET).upload(path, buffer, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upErr) {
    console.error("[onboarding/upload] storage:", upErr);
    return NextResponse.json(
      {
        ok: false,
        error: "storage_failed",
        detail: upErr.message,
        hint: `Vérifier que le bucket privé "${BUCKET}" existe (cf. sql/48).`,
      },
      { status: 500 },
    );
  }

  const { data: signed } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);

  return NextResponse.json({
    ok: true,
    path,
    signed_url: signed?.signedUrl ?? null,
  });
}
