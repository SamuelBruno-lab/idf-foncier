/**
 * GET /api/dev/test-resend?to=email@example.com&key=DM_DEV_BYPASS_KEY
 *
 * Endpoint de diagnostic : tente d'envoyer un email de test via Resend
 * et retourne EN CLAIR le succès ou l'erreur exacte (au lieu du try/catch
 * silencieux de l'API apply).
 *
 * Protection : nécessite DM_DEV_BYPASS_KEY pour éviter d'être utilisé en spam.
 *
 * Cas typiques d'erreur Resend :
 *   - 401 unauthorized → clé invalide
 *   - 403 forbidden → domaine d'envoi non vérifié
 *   - 422 validation → from address malformée
 *   - rate limit → quota free dépassé (100/jour)
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const to = url.searchParams.get("to") ?? "";

  // Protection minimale
  const bypassKey = process.env.DM_DEV_BYPASS_KEY ?? "";
  if (!bypassKey || key !== bypassKey) {
    return NextResponse.json(
      { ok: false, error: "unauthorized — pass ?key=DM_DEV_BYPASS_KEY in URL" },
      { status: 401 },
    );
  }

  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json(
      { ok: false, error: "invalid_to — pass ?to=email@example.com" },
      { status: 400 },
    );
  }

  // Diagnostic env vars
  const envDiagnostic = {
    RESEND_API_KEY_present: !!process.env.RESEND_API_KEY,
    RESEND_API_KEY_prefix: process.env.RESEND_API_KEY?.slice(0, 8) ?? "(missing)",
    RESEND_API_KEY_length: process.env.RESEND_API_KEY?.length ?? 0,
    MAIL_FROM_DOMAIN: process.env.MAIL_FROM_DOMAIN ?? "(unset — using resend.dev default)",
    NODE_ENV: process.env.NODE_ENV,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_URL: process.env.VERCEL_URL,
  };

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({
      ok: false,
      error: "RESEND_API_KEY missing in env",
      env: envDiagnostic,
    });
  }

  // Tente l'envoi
  const fromDomain = process.env.MAIL_FROM_DOMAIN ?? "resend.dev";
  const fromAddress =
    fromDomain === "resend.dev" ? "onboarding@resend.dev" : `no-reply@${fromDomain}`;

  const resend = new Resend(process.env.RESEND_API_KEY);

  try {
    const result = await resend.emails.send({
      from: `Eurealimmo Diagnostic <${fromAddress}>`,
      to,
      subject: `[TEST] Diagnostic Resend Eurealimmo — ${new Date().toISOString()}`,
      html: `<html><body style="font-family: Arial, sans-serif; padding: 20px;">
        <h2>✓ Email diagnostic envoyé avec succès</h2>
        <p>Si tu reçois ce mail, Resend est correctement configuré.</p>
        <ul>
          <li>From : <code>${fromAddress}</code></li>
          <li>To : <code>${to}</code></li>
          <li>Timestamp : ${new Date().toLocaleString("fr-FR")}</li>
          <li>Resend message ID : visible dans la réponse JSON</li>
        </ul>
        <p style="color: #94a3b8; font-size: 12px;">Endpoint : /api/dev/test-resend</p>
      </body></html>`,
    });

    // Résultat Resend
    const data = (result as { data?: { id?: string }; error?: unknown }).data;
    const error = (result as { data?: unknown; error?: unknown }).error;

    return NextResponse.json({
      ok: !error,
      env: envDiagnostic,
      from: fromAddress,
      to,
      resend_response: { data, error },
      hint: error
        ? "Resend a renvoyé une erreur. Le 'error' field ci-dessus dit pourquoi."
        : "Email envoyé. Vérifie ta boîte (inbox + spam) ET le dashboard Resend (resend.com/emails).",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json(
      {
        ok: false,
        error: "exception_thrown",
        message: msg,
        stack: stack?.split("\n").slice(0, 5).join("\n"),
        env: envDiagnostic,
        from: fromAddress,
        to,
        hint:
          msg.includes("401") || msg.includes("unauthorized")
            ? "Clé Resend INVALIDE. Régénère sur resend.com/api-keys et remplace dans Vercel."
            : msg.includes("403") || msg.includes("domain")
              ? "Domaine d'envoi NON VÉRIFIÉ dans Resend. Soit utilise resend.dev (set MAIL_FROM_DOMAIN vide), soit vérifie ton domaine."
              : msg.includes("rate")
                ? "Quota Resend dépassé (100/jour en free)."
                : "Erreur inconnue — copie-colle le message à Samuel.",
      },
      { status: 500 },
    );
  }
}
