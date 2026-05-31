/**
 * POST /api/cabinets/eurealimmo/admin/onboarding/relance
 *
 * Envoie un email de relance manuelle à un mandataire qui stagne.
 *
 * Body : { mandataire_id: string, custom_message?: string }
 *
 * Effet :
 *   - Envoie email Resend personnalisé "Samuel persona"
 *   - Log la relance dans eurealimmo_onboarding_reminders (type=admin_manual)
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
  mandataire_id?: string;
  custom_message?: string;
};

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug } = await ctx.params;
  if (slug !== "eurealimmo") {
    return NextResponse.json({ ok: false, error: "not_available" }, { status: 404 });
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

  const mandataire_id = (body.mandataire_id ?? "").trim();
  if (!UUID_RE.test(mandataire_id)) {
    return NextResponse.json({ ok: false, error: "invalid_mandataire_id" }, { status: 400 });
  }

  const sb = getSupabase();

  // Récupère mandataire + son étape courante
  const { data: summary } = await sb
    .from("v_eurealimmo_onboarding_summary")
    .select("mandataire_id, first_name, last_name, email, pct_completion, days_since_last_activity")
    .eq("mandataire_id", mandataire_id)
    .maybeSingle();

  if (!summary) {
    return NextResponse.json({ ok: false, error: "mandataire_not_found" }, { status: 404 });
  }

  const m = summary as {
    mandataire_id: string;
    first_name: string;
    last_name: string;
    email: string;
    pct_completion: number;
    days_since_last_activity: number;
  };

  // Détermine l'étape qui bloque
  const { data: nextStep } = await sb
    .from("eurealimmo_onboarding_progress")
    .select("step_id, status, eurealimmo_onboarding_steps(step_key, title)")
    .eq("mandataire_id", mandataire_id)
    .neq("status", "completed")
    .neq("status", "skipped")
    .order("step_id")
    .limit(1)
    .maybeSingle();

  const nextStepTitle = (nextStep as { eurealimmo_onboarding_steps?: { title?: string } } | null)
    ?.eurealimmo_onboarding_steps?.title ?? "votre étape suivante";

  // Envoie email Resend
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json(
      { ok: false, error: "resend_not_configured" },
      { status: 503 },
    );
  }

  const resend = new Resend(resendKey);
  const fromDomain = process.env.MAIL_FROM_DOMAIN ?? "resend.dev";
  const fromAddress =
    fromDomain === "resend.dev" ? "onboarding@resend.dev" : `samuel@${fromDomain}`;

  const onboardingUrl = `https://www.datamerry.com/mandataire/${mandataire_id}/onboarding`;
  const subject = `${m.first_name}, on continue ton onboarding Eurealimmo ?`;

  const html = buildEmailHtml({
    first_name: m.first_name,
    pct_completion: m.pct_completion,
    next_step_title: nextStepTitle,
    onboarding_url: onboardingUrl,
    custom_message: body.custom_message?.trim() ?? null,
  });

  try {
    const emailRes = await resend.emails.send({
      from: `Samuel BRUNO (Eurealimmo) <${fromAddress}>`,
      to: m.email,
      replyTo: "contact@datamerry.com",
      subject,
      html,
    } as Parameters<typeof resend.emails.send>[0]);

    // Log la relance
    await sb.from("eurealimmo_onboarding_reminders").insert({
      mandataire_id,
      reminder_type: "admin_manual",
      email_sent_to: m.email,
      email_subject: subject,
      resend_message_id: (emailRes as { data?: { id?: string } }).data?.id ?? null,
      succeeded: true,
    });

    return NextResponse.json({
      ok: true,
      sent_to: m.email,
      resend_id: (emailRes as { data?: { id?: string } }).data?.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    await sb.from("eurealimmo_onboarding_reminders").insert({
      mandataire_id,
      reminder_type: "admin_manual",
      email_sent_to: m.email,
      email_subject: subject,
      succeeded: false,
      error_detail: msg,
    });
    return NextResponse.json(
      { ok: false, error: "send_failed", detail: msg },
      { status: 500 },
    );
  }
}

function buildEmailHtml(args: {
  first_name: string;
  pct_completion: number;
  next_step_title: string;
  onboarding_url: string;
  custom_message: string | null;
}): string {
  return `
<!DOCTYPE html>
<html><body style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; padding: 0; background: #fafafa;">
  <div style="background: #0f172a; padding: 30px; text-align: center;">
    <div style="display: inline-block; padding: 12px 20px; background: #c8a25d; color: #0f172a; font-weight: 700; font-size: 14px; letter-spacing: 0.1em;">
      EUREALIMMO RÉSEAU
    </div>
  </div>

  <div style="padding: 40px 30px; background: white;">
    <h2 style="color: #0f172a; font-family: Georgia, serif; margin-top: 0;">Bonjour ${args.first_name},</h2>

    <p style="color: #475569; line-height: 1.7; font-size: 15px; font-family: Arial, sans-serif;">
      Tu en es à <strong>${args.pct_completion}%</strong> de ton onboarding Eurealimmo. Plus que quelques étapes
      pour activer ton accès carte T et commencer à signer tes premiers mandats.
    </p>

    <div style="background: #f8fafc; padding: 20px; border-left: 3px solid #c8a25d; margin: 24px 0; font-family: Arial, sans-serif;">
      <p style="margin: 0 0 8px; color: #94a3b8; font-size: 12px; letter-spacing: 0.05em;">PROCHAINE ÉTAPE</p>
      <p style="margin: 0; color: #0f172a; font-size: 16px; font-weight: 700;">${args.next_step_title}</p>
    </div>

    ${
      args.custom_message
        ? `<div style="background: #fef3c7; padding: 16px; border-left: 3px solid #d97706; margin: 24px 0; font-family: Arial, sans-serif; color: #78350f;">
             ${args.custom_message.replace(/\n/g, "<br>")}
           </div>`
        : ""
    }

    <div style="text-align: center; margin: 32px 0;">
      <a href="${args.onboarding_url}"
         style="display: inline-block; background: #c8a25d; color: #0f172a; padding: 14px 32px; border-radius: 4px; font-weight: 700; text-decoration: none; font-family: Arial, sans-serif; letter-spacing: 0.02em;">
        Reprendre mon onboarding →
      </a>
    </div>

    <p style="color: #475569; line-height: 1.7; font-size: 14px; font-family: Arial, sans-serif;">
      Si tu rencontres un blocage (un document que tu n'arrives pas à obtenir, une question juridique, etc.),
      réponds directement à cet email — je te débloque sous 24h.
    </p>

    <p style="color: #475569; line-height: 1.7; font-size: 15px; font-family: Arial, sans-serif; margin-top: 30px;">
      À bientôt,<br>
      <strong>Samuel BRUNO</strong><br>
      Président, Eurealimmo SARL
    </p>
  </div>

  <div style="background: #020617; color: #94a3b8; padding: 20px 30px; font-size: 11px; text-align: center; font-family: Arial, sans-serif;">
    <p style="margin: 0 0 8px;">
      <strong style="color: white;">EUREALIMMO</strong> · SARL · SIREN 984 449 470 · RCS Paris
      <br>Carte T n° CPI 7501 2024 000 219 · Sans maniement de fonds
    </p>
  </div>
</body></html>`;
}
