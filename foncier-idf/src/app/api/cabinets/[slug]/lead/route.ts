/**
 * POST /api/cabinets/{slug}/lead
 *
 * Capture finale d'un lead sur la page white-label /cabinets/{slug}/estimer.
 * Appelé par EstimWizard à la dernière étape (formulaire nom/email/téléphone).
 *
 * Pipeline :
 *   1. Valide l'identité visiteur + consentement RGPD
 *   2. Insère dans dim_cabinet_leads (Stripe billing material)
 *   3. Génère un PDF brandé cabinet via CabinetLeadReportPDF
 *   4. Envoie 2 emails Resend non-bloquants :
 *      - Au visiteur : confirmation + PDF rapport joint
 *      - Au cabinet  : notification lead + PDF rapport joint
 *   5. Renvoie { ok, lead_id, cta_url } pour rediriger côté client
 *
 * Le PDF est rendu en mémoire (renderToBuffer) puis encodé en base64 pour
 * Resend. Coût Vercel : ~300-500ms / lead, ~5 Mo RAM pic.
 */

import { NextRequest, NextResponse } from "next/server";
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createHash } from "crypto";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

import {
  CabinetLeadReportPDF,
  type CabinetLeadReportData,
} from "@/lib/pdf/cabinet-lead-report";

// ──────────────────────────────────────────────────────────────────────────────
// Supabase (service_role : on insère + on lit le branding cabinet)
// ──────────────────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Validation entrée
// ──────────────────────────────────────────────────────────────────────────────

type LeadBody = {
  visitor_name?: string;
  visitor_email?: string;
  visitor_phone?: string;
  consentement?: boolean;

  // Snapshot complet du wizard (issu de l'état EstimWizard)
  wizard_answers?: Record<string, unknown>;

  // Résultat de l'estimation déjà calculée côté client
  estimation?: {
    address?: string;
    prix_m2_median?: number | null;
    prix_m2_p10?: number | null;
    prix_m2_p90?: number | null;
    prix_total_median?: number | null;
    nb_ventes?: number | null;
  };
};

function s(v: unknown, max = 200): string {
  return String(v ?? "").trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ──────────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  let body: LeadBody;
  try {
    body = (await req.json()) as LeadBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // 1) Validation
  const visitor_name = s(body.visitor_name, 120);
  const visitor_email = s(body.visitor_email, 160).toLowerCase();
  const visitor_phone = s(body.visitor_phone, 40);
  const consentement = body.consentement === true;
  const wizard = (body.wizard_answers ?? {}) as Record<string, unknown>;
  const estim = body.estimation ?? {};

  if (visitor_name.length < 2) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (!EMAIL_RE.test(visitor_email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (!consentement) {
    return NextResponse.json({ error: "consent_required" }, { status: 400 });
  }
  const address = s(wizard.address, 240) || s(estim.address, 240);
  if (address.length < 5) {
    return NextResponse.json({ error: "address_required" }, { status: 400 });
  }

  // 2) Récupère le cabinet (branding + email destinataire)
  const sb = getSupabase();
  const { data: cabinet, error: cabErr } = await sb
    .from("dim_cabinets_white_label")
    .select(
      "slug, cabinet_name, primary_color, secondary_color, contact_email, legal_mention, cta_contact_url, cta_contact_label",
    )
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (cabErr || !cabinet) {
    return NextResponse.json({ error: "cabinet_not_found" }, { status: 404 });
  }

  // 3) Insertion du lead
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ip_hash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
  const user_agent = req.headers.get("user-agent")?.slice(0, 400) ?? null;

  const surface = Number(wizard.surface);
  const type_bien = s(wizard.type_bien, 60) || "Appartement";
  const intent = s(wizard.intent, 30) || null;

  const insertPayload = {
    cabinet_slug: slug,
    visitor_name,
    visitor_email,
    visitor_phone: visitor_phone || null,
    consentement,
    intent,
    type_bien,
    address,
    surface: Number.isFinite(surface) && surface > 0 ? surface : null,
    wizard_answers: wizard,
    prix_m2_median: estim.prix_m2_median ?? null,
    prix_m2_p10: estim.prix_m2_p10 ?? null,
    prix_m2_p90: estim.prix_m2_p90 ?? null,
    prix_total_median: estim.prix_total_median ?? null,
    nb_ventes: estim.nb_ventes ?? null,
    ip_hash,
    user_agent,
  };

  const { data: inserted, error: insErr } = await sb
    .from("dim_cabinet_leads")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insErr || !inserted) {
    console.error("[/api/cabinets/lead] insert error:", insErr);
    return NextResponse.json({ error: "db_insert_failed" }, { status: 500 });
  }

  const leadId = (inserted as { id: string }).id;

  // 4) Génération PDF
  const pdfData: CabinetLeadReportData = {
    cabinet_name: cabinet.cabinet_name,
    cabinet_legal: cabinet.legal_mention ?? null,
    primary_color: cabinet.primary_color ?? "#1f3a8a",
    secondary_color: cabinet.secondary_color ?? null,
    visitor_name,
    visitor_email,
    address,
    type_bien,
    surface: insertPayload.surface,
    prix_m2_median: estim.prix_m2_median ?? null,
    prix_m2_p10: estim.prix_m2_p10 ?? null,
    prix_m2_p90: estim.prix_m2_p90 ?? null,
    prix_total_median: estim.prix_total_median ?? null,
    nb_ventes: estim.nb_ventes ?? null,
    wizard_answers: wizard,
    generated_at: new Date(),
  };

  let pdfBuffer: Buffer | null = null;
  try {
    pdfBuffer = await renderToBuffer(
      createElement(CabinetLeadReportPDF, { data: pdfData }) as unknown as ReactElement<DocumentProps>,
    );
  } catch (err) {
    console.error("[/api/cabinets/lead] pdf render failed:", err);
    // Pas bloquant : on continue, on enverra les emails sans PDF.
  }

  const pdfBase64 = pdfBuffer ? pdfBuffer.toString("base64") : null;
  const pdfFilename = `Estimation-${cabinet.cabinet_name}-${Date.now()}.pdf`;

  // 5) Envoi des 2 emails Resend (non-bloquants pour la réponse)
  const updates: Partial<{ email_to_visitor_sent: boolean; email_to_cabinet_sent: boolean }> = {};

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const cabinetName = cabinet.cabinet_name;
    const primary = cabinet.primary_color ?? "#1f3a8a";
    const ctaUrl = cabinet.cta_contact_url ?? "#";
    const ctaLabel = cabinet.cta_contact_label ?? "En savoir plus";

    // ── EMAIL #1 : Au visiteur ──────────────────────────────────────────────
    const visitorHtml = `
<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f8fafc; padding:20px;">
<div style="max-width:560px; margin:0 auto; background:white; border-radius:12px; overflow:hidden; border:1px solid #e2e8f0;">
  <div style="background:${primary}; color:white; padding:24px;">
    <h1 style="margin:0; font-size:22px;">${cabinetName}</h1>
    <p style="margin:6px 0 0; opacity:0.9; font-size:13px;">Votre estimation immobilière</p>
  </div>
  <div style="padding:24px; color:#0f172a;">
    <p>Bonjour <strong>${visitor_name}</strong>,</p>
    <p>Merci pour votre demande d'estimation pour le bien situé <strong>${address}</strong>.</p>
    ${estim.prix_total_median ? `
    <div style="background:#f1f5f9; padding:16px; border-radius:8px; text-align:center; margin:16px 0; border:1px solid ${primary}40;">
      <div style="font-size:11px; text-transform:uppercase; color:${primary}; font-weight:700; letter-spacing:1px;">Estimation marché</div>
      <div style="font-size:28px; font-weight:800; color:${primary}; margin-top:6px;">${new Intl.NumberFormat("fr-FR").format(estim.prix_total_median)} €</div>
      ${estim.prix_m2_median ? `<div style="font-size:12px; color:#475569; margin-top:4px;">${new Intl.NumberFormat("fr-FR").format(Math.round(estim.prix_m2_median))} €/m²</div>` : ""}
    </div>
    ` : ""}
    <p>Vous trouverez ci-joint un rapport PDF récapitulant cette estimation indicative et les caractéristiques que vous nous avez communiquées.</p>
    <p><strong>Un expert ${cabinetName} vous recontactera sous 24h ouvrées</strong> pour affiner cette estimation avec une visite physique (état réel, étage exact, exposition, prestations) et vous accompagner dans votre projet.</p>
    <p style="margin-top:24px;">
      <a href="${ctaUrl}" style="display:inline-block; background:${primary}; color:white; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:700; font-size:14px;">${ctaLabel} →</a>
    </p>
    <p style="font-size:12px; color:#64748b; margin-top:24px; padding-top:16px; border-top:1px solid #e2e8f0;">
      Cette estimation est <strong>indicative</strong>, calculée à partir des ventes notariées DVF du micro-marché. Elle ne se substitue pas à un avis de valeur professionnel d'un expert immobilier.
    </p>
  </div>
  <div style="background:#f8fafc; padding:14px 24px; font-size:11px; color:#94a3b8; text-align:center; border-top:1px solid #e2e8f0;">
    ${cabinet.legal_mention ?? ""}<br/>
    Estimation propulsée par <strong>DATAMERRY®</strong>
  </div>
</div>
</body></html>`;

    const visitorSend = await resend.emails
      .send({
        from: `${cabinetName} <no-reply@datamerry.com>`,
        to: visitor_email,
        subject: `Votre estimation pour ${address} — ${cabinetName}`,
        html: visitorHtml,
        ...(pdfBase64
          ? {
              attachments: [
                { filename: pdfFilename, content: pdfBase64 },
              ],
            }
          : {}),
      })
      .catch((err: unknown) => {
        console.error("[/api/cabinets/lead] visitor email failed:", err);
        return null;
      });
    if (visitorSend && !("error" in visitorSend && visitorSend.error)) {
      updates.email_to_visitor_sent = true;
    }

    // ── EMAIL #2 : Au cabinet ───────────────────────────────────────────────
    if (cabinet.contact_email) {
      const intentDisplay =
        intent === "vendeur" ? "🏷️ Vendeur" :
        intent === "acheteur" ? "🔑 Acheteur" :
        intent === "curieux" ? "👀 Renseignement" : "—";

      const cabinetHtml = `
<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f8fafc; padding:20px;">
<div style="max-width:600px; margin:0 auto; background:white; border-radius:12px; overflow:hidden; border:1px solid #e2e8f0;">
  <div style="background:${primary}; color:white; padding:20px;">
    <h1 style="margin:0; font-size:18px;">🎯 Nouveau lead — ${cabinetName}</h1>
    <p style="margin:6px 0 0; opacity:0.9; font-size:12px;">Capturé via DATAMERRY · ${new Date().toLocaleString("fr-FR")}</p>
  </div>
  <div style="padding:20px; color:#0f172a; font-size:14px;">
    <h2 style="color:${primary}; font-size:14px; text-transform:uppercase; letter-spacing:1px; margin-top:0;">Contact visiteur</h2>
    <table style="width:100%; font-size:13px; border-collapse:collapse;">
      <tr><td style="padding:6px 0; color:#64748b;">Nom</td><td style="padding:6px 0; font-weight:700;">${visitor_name}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Email</td><td style="padding:6px 0;"><a href="mailto:${visitor_email}" style="color:${primary};">${visitor_email}</a></td></tr>
      ${visitor_phone ? `<tr><td style="padding:6px 0; color:#64748b;">Téléphone</td><td style="padding:6px 0;"><a href="tel:${visitor_phone}" style="color:${primary};">${visitor_phone}</a></td></tr>` : ""}
      <tr><td style="padding:6px 0; color:#64748b;">Intention</td><td style="padding:6px 0;">${intentDisplay}</td></tr>
    </table>

    <h2 style="color:${primary}; font-size:14px; text-transform:uppercase; letter-spacing:1px; margin-top:24px;">Bien</h2>
    <table style="width:100%; font-size:13px; border-collapse:collapse;">
      <tr><td style="padding:6px 0; color:#64748b;">Adresse</td><td style="padding:6px 0; font-weight:700;">${address}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Type</td><td style="padding:6px 0;">${type_bien}</td></tr>
      ${insertPayload.surface ? `<tr><td style="padding:6px 0; color:#64748b;">Surface</td><td style="padding:6px 0;">${insertPayload.surface} m²</td></tr>` : ""}
      ${wizard.pieces ? `<tr><td style="padding:6px 0; color:#64748b;">Pièces</td><td style="padding:6px 0;">T${wizard.pieces}</td></tr>` : ""}
      ${wizard.etage ? `<tr><td style="padding:6px 0; color:#64748b;">Étage</td><td style="padding:6px 0;">${wizard.etage}</td></tr>` : ""}
      ${wizard.annee_construction ? `<tr><td style="padding:6px 0; color:#64748b;">Année</td><td style="padding:6px 0;">${wizard.annee_construction}</td></tr>` : ""}
      ${wizard.dpe && wizard.dpe !== "inconnu" ? `<tr><td style="padding:6px 0; color:#64748b;">DPE</td><td style="padding:6px 0;">Classe ${String(wizard.dpe).toUpperCase()}</td></tr>` : ""}
      ${wizard.etat ? `<tr><td style="padding:6px 0; color:#64748b;">État</td><td style="padding:6px 0;">${wizard.etat}</td></tr>` : ""}
      ${Array.isArray(wizard.exterieurs) && wizard.exterieurs.length ? `<tr><td style="padding:6px 0; color:#64748b;">Extérieurs</td><td style="padding:6px 0;">${(wizard.exterieurs as string[]).join(", ")}</td></tr>` : ""}
    </table>

    ${estim.prix_total_median ? `
    <h2 style="color:${primary}; font-size:14px; text-transform:uppercase; letter-spacing:1px; margin-top:24px;">Estimation DATAMERRY</h2>
    <div style="background:#f1f5f9; padding:14px; border-radius:8px; text-align:center; border:1px solid ${primary}40;">
      <div style="font-size:24px; font-weight:800; color:${primary};">${new Intl.NumberFormat("fr-FR").format(estim.prix_total_median)} €</div>
      ${estim.prix_m2_median ? `<div style="font-size:12px; color:#475569; margin-top:4px;">${new Intl.NumberFormat("fr-FR").format(Math.round(estim.prix_m2_median))} €/m² · ${estim.nb_ventes ?? "?"} ventes DVF</div>` : ""}
    </div>
    ` : ""}

    <p style="margin-top:20px; padding:12px; background:#fef9c3; border-radius:6px; font-size:12px; color:#713f12;">
      💡 Le rapport PDF complet est joint à cet email. Le visiteur l'a aussi reçu.<br/>
      <strong>Rappelez ce lead sous 24h pour maximiser la conversion.</strong>
    </p>
  </div>
  <div style="background:#f8fafc; padding:12px 20px; font-size:11px; color:#94a3b8; text-align:center; border-top:1px solid #e2e8f0;">
    Lead ID : ${leadId}<br/>
    Notification automatique DATAMERRY · vous recevez cet email parce que vous êtes le cabinet propriétaire du slug "${slug}"
  </div>
</div>
</body></html>`;

      const cabinetSend = await resend.emails
        .send({
          from: `DATAMERRY <no-reply@datamerry.com>`,
          to: cabinet.contact_email,
          replyTo: visitor_email, // Diara peut répondre direct au visiteur
          subject: `🎯 Nouveau lead ${cabinetName} · ${visitor_name} · ${address}`,
          html: cabinetHtml,
          ...(pdfBase64
            ? {
                attachments: [
                  { filename: pdfFilename, content: pdfBase64 },
                ],
              }
            : {}),
        })
        .catch((err: unknown) => {
          console.error("[/api/cabinets/lead] cabinet email failed:", err);
          return null;
        });
      if (cabinetSend && !("error" in cabinetSend && cabinetSend.error)) {
        updates.email_to_cabinet_sent = true;
      }
    }
  } else {
    console.warn("[/api/cabinets/lead] RESEND_API_KEY missing — emails skipped");
  }

  // 6) Met à jour les flags d'envoi email (non-bloquant)
  if (Object.keys(updates).length > 0) {
    void sb.from("dim_cabinet_leads").update(updates).eq("id", leadId);
  }

  return NextResponse.json({
    ok: true,
    lead_id: leadId,
    cta_url: cabinet.cta_contact_url,
    cta_label: cabinet.cta_contact_label,
  });
}
