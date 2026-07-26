/**
 * POST /api/mandataire/login
 *
 * Permet à un mandataire de récupérer son lien d'accès personnel
 * au workspace par email.
 *
 * Body JSON : { email: string }
 *
 * Comportement :
 *   - Si email correspond à un mandataire existant : envoie un mail Resend
 *     avec le lien /mandataire/{uuid}/workspace (le UUID = token, 122 bits).
 *   - Si email inconnu : ne révèle rien (anti-enumeration). Renvoie 200.
 *
 * Toujours réponse 200 avec message générique.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.eurealimmo.com";
const MAIL_FROM = process.env.MAIL_FROM ?? "Eurealimmo <samuel@datamerry.com>";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function buildLoginEmail(args: {
  firstName: string;
  lastName: string;
  workspaceUrl: string;
  onboardingUrl: string;
}): { subject: string; text: string; html: string } {
  const { firstName, lastName, workspaceUrl, onboardingUrl } = args;
  const subject = "Eurealimmo · votre lien d'accès personnel";

  const text = `Bonjour ${firstName},

Voici votre lien d'accès personnel à votre espace mandataire Eurealimmo :

→ ${workspaceUrl}

Onboarding (checklist) : ${onboardingUrl}

Conservez ce lien : il est unique et personnel. Bookmark recommandé.

Pour toute question : contact@eurealimmo.com

Cordialement,
Eurealimmo SARL
Carte T CPI 7501 2024 000 000 219`;

  const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"/><title>${subject}</title></head>
<body style="font-family: Segoe UI, Arial, sans-serif; color: #0f172a; background: #fafafa; padding: 24px;">
  <div style="max-width: 600px; margin: 0 auto; background: white; padding: 32px; border-radius: 8px;">
    <div style="text-align: center; margin-bottom: 24px;">
      <div style="font-size: 24px; font-weight: 700; color: #c8a25d; letter-spacing: 0.05em;">EUREALIMMO</div>
      <div style="font-size: 11px; color: #64748b; letter-spacing: 0.1em; margin-top: 2px;">ESPACE MANDATAIRE</div>
    </div>

    <h1 style="font-family: Georgia, serif; font-size: 22px; color: #0f172a; margin: 0 0 16px;">
      Bonjour ${firstName} 👋
    </h1>

    <p style="font-size: 14px; line-height: 1.6; color: #334155;">
      Voici votre lien d'accès personnel à votre espace mandataire Eurealimmo.
      Il est unique et personnel — gardez-le précieusement (bookmark recommandé).
    </p>

    <div style="text-align: center; margin: 28px 0;">
      <a href="${workspaceUrl}"
         style="display: inline-block; background: #064e3b; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: 14px;">
        Accéder à mon espace →
      </a>
    </div>

    <div style="border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 24px; font-size: 12px; color: #64748b;">
      <strong>Onboarding (checklist)</strong> :<br/>
      <a href="${onboardingUrl}" style="color: #c8a25d; word-break: break-all;">${onboardingUrl}</a>
    </div>

    <div style="margin-top: 24px; font-size: 11px; color: #94a3b8; line-height: 1.6;">
      Pour toute question : <a href="mailto:contact@eurealimmo.com" style="color: #c8a25d;">contact@eurealimmo.com</a><br/>
      <br/>
      Eurealimmo SARL · SIREN 984 449 470 · Carte T CPI 7501 2024 000 000 219
    </div>
  </div>
</body></html>`;

  return { subject, text, html };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: { email?: string } = {};
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid_json" },
      { status: 400 },
    );
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { ok: false, error: "invalid_email" },
      { status: 400 },
    );
  }

  const supabase = getSupabase();

  // 1. Chercher le mandataire
  const { data: mandataire } = await supabase
    .from("eurealimmo_mandataires")
    .select("id, first_name, last_name, email")
    .ilike("email", email)
    .maybeSingle();

  // 2. Si trouvé, envoyer le mail. Si pas trouvé, on ignore (anti-enumeration).
  if (mandataire) {
    const workspaceUrl = `${BASE_URL}/mandataire/${mandataire.id}/workspace`;
    const onboardingUrl = `${BASE_URL}/mandataire/${mandataire.id}/onboarding`;
    const { subject, text, html } = buildLoginEmail({
      firstName: mandataire.first_name,
      lastName: mandataire.last_name,
      workspaceUrl,
      onboardingUrl,
    });

    try {
      const resendKey = process.env.RESEND_API_KEY;
      if (resendKey) {
        const resend = new Resend(resendKey);
        await resend.emails.send({
          from: MAIL_FROM,
          to: [mandataire.email],
          subject,
          text,
          html,
        });
        console.log(`[mandataire/login] mail envoyé à ${mandataire.email}`);
      } else {
        console.warn("[mandataire/login] RESEND_API_KEY manquant — pas d'envoi");
      }
    } catch (err) {
      console.error("[mandataire/login] erreur Resend:", err);
      // On n'expose pas l'erreur côté UI (anti-enumeration)
    }
  } else {
    console.log(`[mandataire/login] aucun mandataire pour ${email}`);
  }

  // 3. Réponse générique
  return NextResponse.json({
    ok: true,
    message:
      "Si cet email correspond à un mandataire Eurealimmo, un lien d'accès personnel vient d'être envoyé. Vérifiez votre boîte de réception (et vos spams).",
  });
}
