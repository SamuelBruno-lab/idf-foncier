/**
 * POST /api/cabinets/{slug}/admin/leads/{lead_id}/signature/upload
 *
 * Upload d'un PDF mandat papier signé (chemin B du pipeline signature).
 *
 * Pipeline :
 *   1. Multipart form-data : field "file" = PDF binaire
 *   2. Sauvegarde dans Supabase Storage (bucket : mandate-signed-pdfs)
 *   3. Exécute le pdf-matcher pour extraire les champs et comparer avec le CRM
 *   4a. Si match_ok = true :
 *       - signature_status = matched_ok
 *       - mandat_signe_at = date_signature extraite (si présente) ou now()
 *       - Déclenche l'ancrage blockchain auto
 *   4b. Si mismatch :
 *       - signature_status = mismatch_pending_review
 *       - signature_mismatch_alerts = JSONB array détaillé
 *       - mandat_signe_at reste null (à valider manuellement par l'agent)
 *   5. Renvoie le résultat complet pour affichage immédiat
 *
 * Conformité :
 *   - Décret 72-678 art. 73 — mentions obligatoires vérifiées
 *   - RGPD : on stocke le PDF dans un bucket privé, accès via signed URL
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminSession } from "@/lib/admin-auth";
import { matchMandatPdf, type ExpectedFields } from "@/lib/mandate/pdf-matcher";
import { computeMandatHash } from "@/lib/mandate/canonical-hash";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const BUCKET = "mandate-signed-pdfs";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; lead_id: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug, lead_id } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  // Auth
  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Récupère le fichier uploadé
  let pdfBuffer: Buffer;
  let originalName = "mandat-signe.pdf";
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: "missing_file", message: "Field 'file' requis (multipart form-data)" },
        { status: 400 },
      );
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      return NextResponse.json(
        { error: "not_a_pdf", message: "Fichier doit être un PDF" },
        { status: 400 },
      );
    }
    if (file.size > 20 * 1024 * 1024) {
      return NextResponse.json(
        { error: "too_large", message: "PDF trop gros (max 20 Mo)" },
        { status: 400 },
      );
    }
    pdfBuffer = Buffer.from(await file.arrayBuffer());
    originalName = file.name;
  } catch (e) {
    console.error("[admin/signature/upload] formData parse error:", e);
    return NextResponse.json({ error: "invalid_form_data" }, { status: 400 });
  }

  const sb = getSupabase();

  // Récupère le lead pour les expected fields du matcher
  const { data: leadRaw, error: leadErr } = await sb
    .from("dim_cabinet_leads")
    .select(
      "id, cabinet_slug, visitor_name, address, type_bien, surface, " +
        "mandat_type, mandat_modalite, mandat_signe_at, mandat_numero_registre, " +
        "mandat_duree_mois, mandat_commission_pct, " +
        "mandat_prix_net_vendeur, mandat_prix_max, " +
        "signature_match_attempts",
    )
    .eq("id", lead_id)
    .eq("cabinet_slug", slug)
    .maybeSingle();

  if (leadErr) {
    console.error("[admin/signature/upload] lead query:", leadErr);
    return NextResponse.json({ error: "db_error", detail: leadErr.message }, { status: 500 });
  }
  if (!leadRaw) {
    return NextResponse.json({ error: "lead_not_found" }, { status: 404 });
  }

  const lead = leadRaw as unknown as {
    id: string;
    cabinet_slug: string;
    visitor_name: string;
    address: string;
    type_bien: string;
    surface: number | null;
    mandat_type: "vente" | "recherche" | "location" | null;
    mandat_modalite: "simple" | "exclusif" | "semi_exclusif" | null;
    mandat_signe_at: string | null;
    mandat_numero_registre: string | null;
    mandat_duree_mois: number | null;
    mandat_commission_pct: number | null;
    mandat_prix_net_vendeur: number | null;
    mandat_prix_max: number | null;
    signature_match_attempts: number | null;
  };

  // Upload PDF dans Supabase Storage
  const storagePath = `${slug}/${lead_id}/${Date.now()}-${originalName.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  let signedPdfUrl: string | null = null;
  try {
    const { error: uploadErr } = await sb.storage.from(BUCKET).upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadErr) {
      // Bucket peut ne pas exister — on continue quand même avec le matcher
      console.warn("[admin/signature/upload] storage upload failed:", uploadErr);
    } else {
      // Signed URL valable 1h pour affichage immédiat (l'agent ouvrira le PDF)
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
      signedPdfUrl = signed?.signedUrl ?? null;
    }
  } catch (e) {
    console.warn("[admin/signature/upload] storage exception:", e);
  }

  // Exécute le matcher
  const expected: ExpectedFields = {
    mandat_type: lead.mandat_type,
    mandat_modalite: lead.mandat_modalite,
    mandat_signe_at: lead.mandat_signe_at,
    mandat_duree_mois: lead.mandat_duree_mois,
    mandat_commission_pct: lead.mandat_commission_pct,
    mandat_prix_net_vendeur: lead.mandat_prix_net_vendeur,
    mandat_prix_max: lead.mandat_prix_max,
    address: lead.address,
    surface: lead.surface,
    type_bien: lead.type_bien,
    visitor_name: lead.visitor_name,
  };

  let matchResult;
  try {
    matchResult = await matchMandatPdf(pdfBuffer, expected);
  } catch (e) {
    console.error("[admin/signature/upload] matcher error:", e);
    return NextResponse.json(
      {
        error: "matcher_failed",
        message: "Impossible d'extraire le texte du PDF (probablement scanné/OCR nécessaire)",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 422 },
    );
  }

  const newAttempts = (lead.signature_match_attempts ?? 0) + 1;
  const status = matchResult.match_ok ? "matched_ok" : "mismatch_pending_review";
  const dateFromPdf = matchResult.extracted.date_signature;

  // Update lead avec résultats matcher
  const patch: Record<string, unknown> = {
    signature_provider: "paper_upload",
    signature_status: status,
    signed_pdf_url: signedPdfUrl,
    signature_mismatch_alerts: matchResult.alerts.length > 0 ? matchResult.alerts : null,
    signature_match_attempts: newAttempts,
    signed_at_provider: dateFromPdf ?? null,
    // Enrichit avec les champs extraits si non encore présents en CRM
    ...(matchResult.extracted.bien_consistance && !lead.address.includes("[")
      ? { bien_consistance: matchResult.extracted.bien_consistance }
      : {}),
    ...(matchResult.extracted.bien_references_cadastrales
      ? { bien_references_cadastrales: matchResult.extracted.bien_references_cadastrales }
      : {}),
    ...(matchResult.extracted.bien_dpe_classe
      ? { bien_dpe_classe: matchResult.extracted.bien_dpe_classe }
      : {}),
    ...(matchResult.extracted.bien_dpe_annee
      ? { bien_dpe_annee: matchResult.extracted.bien_dpe_annee }
      : {}),
    ...(matchResult.extracted.mandant_nom_complet
      ? { mandant_nom_complet: matchResult.extracted.mandant_nom_complet }
      : {}),
    ...(matchResult.extracted.mandant_adresse_complete
      ? { mandant_adresse_complete: matchResult.extracted.mandant_adresse_complete }
      : {}),
    ...(matchResult.extracted.mandat_lieu_signature
      ? { mandat_lieu_signature: matchResult.extracted.mandat_lieu_signature }
      : {}),
    ...(matchResult.extracted.mandat_prix_presentation_public
      ? { mandat_prix_presentation_public: matchResult.extracted.mandat_prix_presentation_public }
      : {}),
    ...(matchResult.extracted.mandat_fourchette_negociation_pct
      ? { mandat_fourchette_negociation_pct: matchResult.extracted.mandat_fourchette_negociation_pct }
      : {}),
  };

  // Si match OK ET pas encore signé → set mandat_signe_at (= chemin papier validé)
  if (matchResult.match_ok && !lead.mandat_signe_at) {
    patch.mandat_signe_at = dateFromPdf ?? new Date().toISOString();
    patch.status = "mandat_signe";
  }

  const { data: updated, error: updateErr } = await sb
    .from("dim_cabinet_leads")
    .update(patch)
    .eq("id", lead_id)
    .select("*")
    .maybeSingle();

  if (updateErr) {
    console.error("[admin/signature/upload] update error:", updateErr);
    return NextResponse.json(
      { error: "update_failed", detail: updateErr.message },
      { status: 500 },
    );
  }

  // Si match OK, déclenche l'ancrage blockchain automatique
  let anchor_triggered = false;
  if (matchResult.match_ok && updated) {
    const u = updated as unknown as ExpectedFields & {
      id: string;
      cabinet_slug: string;
      mandat_numero_registre: string | null;
    };
    if (u.mandat_signe_at && u.mandat_type) {
      try {
        const { hash, payload } = computeMandatHash({
          lead_id: u.id,
          cabinet_slug: u.cabinet_slug,
          mandat_type: u.mandat_type,
          mandat_modalite: u.mandat_modalite,
          mandat_signe_at: u.mandat_signe_at,
          mandat_numero_registre: u.mandat_numero_registre,
          mandat_duree_mois: u.mandat_duree_mois,
          mandat_commission_pct: u.mandat_commission_pct,
          mandat_prix_net_vendeur: u.mandat_prix_net_vendeur,
          mandat_prix_max: u.mandat_prix_max,
          visitor_name: u.visitor_name,
          address: u.address,
          type_bien: u.type_bien,
          surface: u.surface,
        });
        const { error: anchorErr } = await sb.rpc("queue_mandate_anchor", {
          p_lead_id: lead_id,
          p_mandate_hash: hash,
          p_canonical_payload: payload,
          p_triggered_by_email: session.email,
        });
        if (!anchorErr) anchor_triggered = true;
      } catch {
        // Best-effort
      }
    }
  }

  return NextResponse.json({
    ok: true,
    match_ok: matchResult.match_ok,
    match_score: matchResult.match_score,
    alerts: matchResult.alerts,
    extracted: matchResult.extracted,
    signed_pdf_url: signedPdfUrl,
    signature_status: status,
    anchor_triggered,
    attempts: newAttempts,
  });
}
