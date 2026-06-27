/**
 * POST /api/cabinets/eurealimmo/admin/mandataires/[id]/activate
 *
 * Active un mandataire (= signe son contrat) ET envoie l'email d'activation
 * avec les URLs workspace. Action en une seule transaction côté UI admin.
 *
 * Body : { confirm: true, note?: string }
 *   - confirm : sécurité contre clic accidentel
 *   - note    : optionnel, ajouté en bas du mail
 *
 * Effets :
 *   1. UPDATE eurealimmo_mandataires SET contract_signed_at = now()
 *   2. Envoie email Resend "Activation Eurealimmo" avec 5 URLs workspace
 *   3. Insert log dans eurealimmo_activation_log (best-effort)
 *
 * Idempotence : si contract_signed_at déjà rempli, refuse (409).
 *
 * Auth : cookie session admin Eurealimmo.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { getAdminSession } from "@/lib/admin-auth";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Payload = {
  confirm?: boolean;
  note?: string;
};

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.eurealimmo.com";
const MAIL_FROM = process.env.MAIL_FROM ?? "Samuel BRUNO <samuel@datamerry.com>";

function buildActivationEmail(args: {
  firstName: string;
  lastName: string;
  mandataireId: string;
  note?: string;
}): { subject: string; text: string; html: string } {
  const { firstName, lastName, mandataireId, note } = args;
  const url = (path: string) => `${BASE_URL}/mandataire/${mandataireId}${path}`;

  const subject = `Ton espace mandataire Eurealimmo est activé ${firstName} 🎉`;

  const text = [
    `Bonjour ${firstName},`,
    "",
    "C'est officiel — ton contrat de mandataire commercial Eurealimmo est",
    "désormais signé et ton espace est pleinement opérationnel.",
    "",
    "Ton point d'entrée unique (bookmark-le) :",
    `  → ${url("/workspace")}`,
    "",
    "Les 4 vues :",
    `  • Tableau de bord — ${url("/workspace")}`,
    `  • Mes leads       — ${url("/workspace/leads")}`,
    `  • Commissions     — ${url("/workspace/commissions")}`,
    `  • Registre Hoguet — ${url("/workspace/registre")}`,
    "",
    `Et ta checklist d'onboarding : ${url("/onboarding")}`,
    "",
    "Tu peux désormais recevoir des leads attribués via le matching Collabimo,",
    "et générer des mandats Hoguet depuis le détail d'un lead. Les commissions",
    "(rétro 95 %) seront versées 7 j ouvrés après encaissement notaire,",
    "conformément à l'art. 6.2 du contrat.",
    "",
    "⚠️ Garde le lien confidentiel — l'UUID dans l'URL fait office de clé d'accès.",
    "",
    note ? `\n${note}\n` : "",
    "Bienvenue officiellement dans le réseau,",
    "Samuel",
    "",
    "—",
    "EUREALIMMO SARL · SIREN 984 449 470 · CPI 7501 2024 000 219 · Sans maniement de fonds",
  ].join("\n");

  const html = `
<div style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; color: #0f172a; line-height: 1.6;">
  <p>Bonjour <strong>${firstName}</strong>,</p>
  <p>C'est officiel — ton contrat de mandataire commercial Eurealimmo est désormais signé et ton espace est pleinement opérationnel.</p>

  <div style="background: #c8a25d; color: #0f172a; padding: 16px 20px; border-radius: 6px; margin: 20px 0;">
    <div style="font-size: 11px; letter-spacing: 0.1em; font-weight: 700; margin-bottom: 6px;">TON POINT D'ENTRÉE UNIQUE</div>
    <a href="${url("/workspace")}" style="color: #0f172a; font-weight: 700; text-decoration: none; font-size: 16px;">${url("/workspace")} →</a>
  </div>

  <p><strong>Les 4 vues</strong> :</p>
  <ul style="padding-left: 20px;">
    <li>Tableau de bord — <a href="${url("/workspace")}" style="color: #c8a25d;">ouvrir</a></li>
    <li>Mes leads — <a href="${url("/workspace/leads")}" style="color: #c8a25d;">ouvrir</a></li>
    <li>Commissions — <a href="${url("/workspace/commissions")}" style="color: #c8a25d;">ouvrir</a></li>
    <li>Registre Hoguet — <a href="${url("/workspace/registre")}" style="color: #c8a25d;">ouvrir</a></li>
  </ul>

  <p>Et ta <a href="${url("/onboarding")}" style="color: #c8a25d;">checklist d'onboarding</a> reste accessible.</p>

  <p>Tu peux désormais recevoir des leads attribués via le matching Collabimo, et générer des mandats Hoguet depuis le détail d'un lead. Les commissions (rétro 95 %) seront versées 7 j ouvrés après encaissement notaire, conformément à l'art. 6.2 du contrat.</p>

  <p style="background: #fef3c7; border-left: 3px solid #f59e0b; padding: 12px; font-size: 13px;">
    ⚠️ Garde le lien confidentiel — l'UUID dans l'URL fait office de clé d'accès.
  </p>

  ${note ? `<p style="background: #f1f5f9; padding: 12px; border-radius: 4px; font-size: 13px;">${note}</p>` : ""}

  <p>Bienvenue officiellement dans le réseau,<br><strong>Samuel</strong></p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
  <p style="font-size: 11px; color: #94a3b8;">EUREALIMMO SARL · SIREN 984 449 470 · CPI 7501 2024 000 219 · Sans maniement de fonds</p>
</div>
  `.trim();

  return { subject, text, html };
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string; id: string }> },
): Promise<NextResponse> {
  const { slug, id } = await ctx.params;

  // Restriction : cet endpoint n'est dispo que pour le cabinet "eurealimmo"
  if (slug !== "eurealimmo") {
    return NextResponse.json({ ok: false, error: "not_available" }, { status: 404 });
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  const session = getAdminSession(req);
  if (!session || session.slug !== "eurealimmo") {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  if (body.confirm !== true) {
    return NextResponse.json(
      { ok: false, error: "confirm_required" },
      { status: 400 },
    );
  }

  const sb = getSupabase();

  // Récup fiche
  const { data: m, error: mErr } = await sb
    .from("eurealimmo_mandataires")
    .select("id, first_name, last_name, email, contract_signed_at, is_blocked")
    .eq("id", id)
    .maybeSingle();

  if (mErr || !m) {
    return NextResponse.json(
      { ok: false, error: "mandataire_not_found" },
      { status: 404 },
    );
  }

  if (m.is_blocked === true) {
    return NextResponse.json({ ok: false, error: "mandataire_blocked" }, { status: 409 });
  }

  if (m.contract_signed_at) {
    return NextResponse.json(
      {
        ok: false,
        error: "already_activated",
        contract_signed_at: m.contract_signed_at,
      },
      { status: 409 },
    );
  }

  // Activation
  const { error: updateErr } = await sb
    .from("eurealimmo_mandataires")
    .update({
      contract_signed_at: new Date().toISOString(),
      is_active: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (updateErr) {
    return NextResponse.json(
      { ok: false, error: "update_failed", detail: updateErr.message },
      { status: 500 },
    );
  }

  // Envoi email Resend (best-effort — si échec, on n'annule pas l'activation)
  let emailStatus: "sent" | "skipped" | "failed" = "skipped";
  let emailError: string | undefined;

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey && m.email) {
    try {
      const resend = new Resend(resendKey);
      const { subject, text, html } = buildActivationEmail({
        firstName: m.first_name,
        lastName: m.last_name,
        mandataireId: m.id,
        note: body.note,
      });
      const sendRes = await resend.emails.send({
        from: MAIL_FROM,
        to: m.email,
        subject,
        text,
        html,
        replyTo: "samuel@datamerry.com",
      });
      if ("error" in sendRes && sendRes.error) {
        emailStatus = "failed";
        emailError = String(sendRes.error.message ?? sendRes.error);
      } else {
        emailStatus = "sent";
      }
    } catch (err) {
      emailStatus = "failed";
      emailError = err instanceof Error ? err.message : String(err);
    }
  }

  // Log best-effort
  try {
    await sb.from("eurealimmo_activation_log").insert({
      mandataire_id: id,
      activated_by_admin: session.slug ?? "eurealimmo",
      email_status: emailStatus,
      email_error: emailError ?? null,
      note: body.note ?? null,
    });
  } catch {
    /* la table peut ne pas exister encore, on ne bloque pas */
  }

  return NextResponse.json({
    ok: true,
    mandataire_id: id,
    contract_signed_at: new Date().toISOString(),
    email_status: emailStatus,
    email_error: emailError,
  });
}
