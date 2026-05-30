/**
 * POST /api/cabinets/{slug}/admin/login
 *
 * Reçoit { email } et envoie un magic link à cette adresse pour accéder au
 * dashboard admin du cabinet. L'email doit correspondre au contact_email
 * enregistré du cabinet (sinon 403 silencieux pour ne pas leaker l'info).
 *
 * Renvoie toujours { ok: true } qu'il y ait eu envoi ou pas, pour ne pas
 * permettre l'énumération des cabinets / emails (defense anti-phishing).
 */

import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { Resend } from "resend";
import { createMagicLinkToken } from "@/lib/admin-auth";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return NextResponse.json({ ok: true }); // ne leak rien
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: true }); // ne leak rien
  }

  // Hash IP pour audit
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ip_hash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
  const user_agent = req.headers.get("user-agent")?.slice(0, 400) ?? "";

  // Génère le token (renvoie null si email != contact_email du cabinet)
  const created = await createMagicLinkToken({
    cabinet_slug: slug,
    email,
    ip_hash,
    user_agent,
  });

  // Toujours répondre OK (même si email mismatch) pour ne pas leaker
  if (!created) {
    return NextResponse.json({ ok: true });
  }

  // Récupère le branding du cabinet pour l'email
  const sb = getSupabase();
  const { data: cabinet } = await sb
    .from("dim_cabinets_white_label")
    .select("cabinet_name, primary_color")
    .eq("slug", slug)
    .maybeSingle();

  const cabinetName = cabinet?.cabinet_name ?? "votre cabinet";
  const primary = cabinet?.primary_color ?? "#1f3a8a";

  // Construit l'URL absolue du verify
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    `https://${req.headers.get("host") ?? "www.datamerry.com"}`;
  const verifyUrl = `${baseUrl}/api/cabinets/${slug}/admin/verify?token=${encodeURIComponent(created.token)}`;

  // Envoi email Resend (non-bloquant)
  // FROM : on utilise par défaut onboarding@resend.dev (toujours autorisé,
  // pas besoin de vérification domaine) — ça permet l'envoi à n'importe
  // quel destinataire sans config DNS. Quand le domaine datamerry.com sera
  // vérifié dans Resend, set MAIL_FROM_DOMAIN=datamerry.com pour basculer.
  const fromDomain = process.env.MAIL_FROM_DOMAIN ?? "resend.dev";
  const fromAddress =
    fromDomain === "resend.dev" ? "onboarding@resend.dev" : `no-reply@${fromDomain}`;

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const html = `
<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f8fafc; padding:20px;">
<div style="max-width:560px; margin:0 auto; background:white; border-radius:12px; overflow:hidden; border:1px solid #e2e8f0;">
  <div style="background:${primary}; color:white; padding:24px;">
    <h1 style="margin:0; font-size:22px;">${cabinetName} — Dashboard</h1>
    <p style="margin:6px 0 0; opacity:0.9; font-size:13px;">Lien de connexion sécurisé</p>
  </div>
  <div style="padding:24px; color:#0f172a;">
    <p>Bonjour,</p>
    <p>Cliquez sur le lien ci-dessous pour accéder au dashboard de gestion des leads de votre cabinet. Le lien est valable <strong>7 jours</strong> et à <strong>usage unique</strong>.</p>
    <p style="margin-top:20px;">
      <a href="${verifyUrl}" style="display:inline-block; background:${primary}; color:white; padding:14px 28px; border-radius:10px; text-decoration:none; font-weight:700; font-size:14px;">Accéder au dashboard →</a>
    </p>
    <p style="font-size:11px; color:#64748b; margin-top:24px; padding-top:16px; border-top:1px solid #e2e8f0;">
      Si vous n'avez pas demandé ce lien, ignorez cet email — votre compte reste protégé. Le lien ne fonctionne qu'une seule fois et expire automatiquement.
    </p>
  </div>
  <div style="background:#f8fafc; padding:12px 24px; font-size:11px; color:#94a3b8; text-align:center; border-top:1px solid #e2e8f0;">
    Envoyé automatiquement par <strong>DATAMERRY®</strong>
  </div>
</div>
</body></html>`;

    const payload: Record<string, unknown> = {
      from: `${cabinetName} via DATAMERRY <${fromAddress}>`,
      to: email,
      reply_to: "contact@datamerry.com",
      subject: `Accès dashboard ${cabinetName} — DATAMERRY`,
      html,
    };

    try {
      const result = await resend.emails.send(
        payload as unknown as Parameters<typeof resend.emails.send>[0],
      );
      // Log explicite pour debug en prod (visible Vercel Runtime Logs)
      console.log(
        "[admin/login] resend response:",
        JSON.stringify({
          to: email,
          from: payload.from,
          result_id: (result as { data?: { id?: string }; error?: unknown })?.data?.id,
          error: (result as { error?: unknown })?.error,
        }),
      );
    } catch (err: unknown) {
      console.error("[admin/login] resend exception:", err);
    }
  } else {
    console.warn("[admin/login] RESEND_API_KEY absent — magic link non envoyé");
  }

  return NextResponse.json({ ok: true });
}
