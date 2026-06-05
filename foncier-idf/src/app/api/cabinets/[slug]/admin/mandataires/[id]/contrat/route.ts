/**
 * POST /api/cabinets/{slug}/admin/mandataires/{id}/contrat
 *
 * Génère (à la demande) le contrat de mandat « Associé(e) Fondateur(trice) »
 * pour un mandataire, le stocke dans Supabase Storage et renvoie une URL signée.
 *
 * Body JSON optionnel :
 *   { "marque"?: string, "parcours"?: string, "send_for_signature"?: boolean }
 *
 * Réponse : { ok, filename, storage_path, signed_url, tags, signature? }
 *
 * Auth : session admin (cookie dm_admin_session) du même cabinet (slug).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminSession } from "@/lib/admin-auth";
import {
  generateMandatFromMandataire,
  type MandataireRow,
} from "@/lib/contracts/generate-mandat";
import { sendForSignature, isEsignConfigured } from "@/lib/contracts/esign";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const BUCKET = "mandats-fondateurs";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MANDATAIRE_COLS =
  "id, first_name, last_name, email, company_name, founder_number, description";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; id: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug, id } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  let body: { marque?: string; parcours?: string; send_for_signature?: boolean } = {};
  try {
    const txt = await req.text();
    if (txt) body = JSON.parse(txt);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sb = getSupabase();

  const { data: m, error: mErr } = await sb
    .from("eurealimmo_mandataires")
    .select(MANDATAIRE_COLS)
    .eq("id", id)
    .maybeSingle();

  if (mErr) {
    console.error("[contrat/POST] mandataire fetch:", mErr);
    return NextResponse.json({ error: "db_error", detail: mErr.message }, { status: 500 });
  }
  if (!m) {
    return NextResponse.json({ error: "mandataire_not_found" }, { status: 404 });
  }

  // Génération du .docx rempli
  let generated;
  try {
    generated = generateMandatFromMandataire(m as MandataireRow, {
      marque: body.marque,
      parcours: body.parcours,
    });
  } catch (e) {
    // founder_number manquant / = 1 → 422 explicite
    return NextResponse.json(
      { error: "generation_failed", message: e instanceof Error ? e.message : String(e) },
      { status: 422 },
    );
  }

  const { buffer, filename, tags } = generated;

  // Stockage Supabase (bucket privé)
  const storagePath = `${id}/${filename}`;
  let signedUrl: string | null = null;
  const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
  if (upErr) {
    console.error("[contrat/POST] storage upload:", upErr);
    return NextResponse.json(
      {
        error: "storage_failed",
        detail: upErr.message,
        hint: `Vérifier que le bucket privé "${BUCKET}" existe (cf. sql/39).`,
      },
      { status: 500 },
    );
  }
  const { data: signed } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600);
  signedUrl = signed?.signedUrl ?? null;

  // Trace en base (best-effort)
  await sb
    .from("eurealimmo_mandataires")
    .update({ contract_generated_at: new Date().toISOString() })
    .eq("id", id);

  // Envoi e-signature optionnel
  let signature: unknown = undefined;
  if (body.send_for_signature) {
    if (!isEsignConfigured()) {
      signature = { ok: false, error: "esign_not_configured" };
    } else {
      try {
        signature = await sendForSignature({
          docxBuffer: buffer,
          filename,
          signerEmail: tags.email,
          signerFirstName: tags.prenom,
          signerLastName: tags.nom,
          subject: `Contrat de mandat fondateur n° ${tags.numero_fondateur} — Eurealimmo Réseau`,
        });
      } catch (e) {
        signature = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  }

  return NextResponse.json({
    ok: true,
    filename,
    storage_path: storagePath,
    signed_url: signedUrl,
    tags,
    ...(signature !== undefined ? { signature } : {}),
  });
}
