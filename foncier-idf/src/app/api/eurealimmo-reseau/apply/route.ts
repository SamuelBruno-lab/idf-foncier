/**
 * POST /api/eurealimmo-reseau/apply
 *
 * Reçoit une candidature mandataire depuis reseau.eurealimmo.com :
 *   1. Validation des champs (anti-spam basique)
 *   2. Insertion Supabase (eurealimmo_applications)
 *   3. Email Resend → contact@datamerry.com (notification interne)
 *   4. Email Resend → candidat (confirmation 48h)
 *
 * Idempotence : pas de strict idempotence — si le candidat soumet 2x,
 * 2 entrées sont créées (audit trail). La review manuelle dédoublonne.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { Resend } from "resend";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_STATUS = new Set([
  "mandataire_actif",
  "agent_commercial",
  "ex_banque_privee",
  "reconversion",
  "independant_carte_t",
  "autre",
]);
const VALID_EXPERIENCE = new Set(["0-1", "1-3", "3-7", "7-15", "15+"]);
const VALID_CARTE_T = new Set(["non", "oui", "transition"]);
const VALID_SPECIALTY = new Set([
  "hnwi",
  "ancien_standing",
  "standard",
  "commercial",
  "location",
  "mixte",
]);

type Payload = {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  current_status?: string;
  current_network?: string;
  years_experience?: string;
  has_carte_t?: string;
  specialty?: string;
  motivation?: string;
  consent?: boolean;
  referred_by_email?: string;
  // Form simplifié V2 :
  preferred_contact?: "call" | "email";
  referral_code?: string;
  tier_requested?: "founder" | "standard" | "partner";
};

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // ─── 1. Parse + validate ────────────────────────────────────────
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const first_name = (body.first_name ?? "").trim().slice(0, 100);
  const last_name = (body.last_name ?? "").trim().slice(0, 100);
  const email = (body.email ?? "").trim().toLowerCase().slice(0, 200);
  const phone = (body.phone ?? "").trim().slice(0, 30);
  // Champs optionnels (formulaire V2 simplifié)
  const current_status = (body.current_status ?? "autre").trim();
  const current_network = (body.current_network ?? "").trim().slice(0, 200) || null;
  const years_experience = (body.years_experience ?? "3-7").trim();
  const has_carte_t = (body.has_carte_t ?? "non").trim();
  const specialty = (body.specialty ?? "mixte").trim();
  const motivation = (body.motivation ?? "").trim().slice(0, 1000);
  const consent = Boolean(body.consent);
  const referred_by_email =
    (body.referred_by_email ?? "").trim().toLowerCase().slice(0, 200) || null;
  const preferred_contact = body.preferred_contact === "email" ? "email" : "call";
  const referral_code_raw = (body.referral_code ?? "").trim().toUpperCase();
  const referral_code = /^[A-Z0-9-]{2,30}$/.test(referral_code_raw) ? referral_code_raw : null;
  const tier_requested = body.tier_requested === "founder" ? "founder" : "standard";

  // Validations strictes des champs essentiels uniquement
  if (!first_name || !last_name) {
    return NextResponse.json({ ok: false, error: "name_required" }, { status: 400 });
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }
  if (phone.length < 6) {
    return NextResponse.json({ ok: false, error: "invalid_phone" }, { status: 400 });
  }
  // Validations fallback enums (avec valeurs par défaut, donc toujours valides)
  if (!VALID_STATUS.has(current_status)) {
    return NextResponse.json({ ok: false, error: "invalid_status" }, { status: 400 });
  }
  if (!VALID_EXPERIENCE.has(years_experience)) {
    return NextResponse.json({ ok: false, error: "invalid_experience" }, { status: 400 });
  }
  if (!VALID_CARTE_T.has(has_carte_t)) {
    return NextResponse.json({ ok: false, error: "invalid_carte_t" }, { status: 400 });
  }
  if (!VALID_SPECIALTY.has(specialty)) {
    return NextResponse.json({ ok: false, error: "invalid_specialty" }, { status: 400 });
  }
  if (!consent) {
    return NextResponse.json({ ok: false, error: "consent_required" }, { status: 400 });
  }

  // Anti-spam : check honeypot keywords (motivation libre)
  const spamKeywords = /viagra|casino|crypto.*invest|seo.*service|backlinks/i;
  if (spamKeywords.test(motivation) || spamKeywords.test(current_network ?? "")) {
    return NextResponse.json({ ok: false, error: "rejected" }, { status: 400 });
  }

  // ─── 2. Hash IP + UA pour audit ─────────────────────────────────
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const ip_hash = createHash("sha256").update(ip).digest("hex").slice(0, 24);
  const user_agent = req.headers.get("user-agent")?.slice(0, 400) ?? "";

  // ─── 3. Si code referral fourni : valider et récupérer l'owner ──
  const sb = getSupabase();
  let referrerInfo: { code: string; referrer_name: string; owner_email: string; tier: string } | null = null;
  if (referral_code) {
    const { data: codeRow } = await sb
      .from("eurealimmo_referral_codes")
      .select("code, owner_name, owner_email, tier, max_uses, current_uses, is_active, expires_at")
      .eq("code", referral_code)
      .eq("is_active", true)
      .maybeSingle();
    const row = codeRow as
      | {
          code: string;
          owner_name: string;
          owner_email: string;
          tier: string;
          max_uses: number;
          current_uses: number;
          expires_at: string | null;
        }
      | null;
    if (row && row.current_uses < row.max_uses) {
      const notExpired = !row.expires_at || new Date(row.expires_at) > new Date();
      if (notExpired) {
        referrerInfo = {
          code: row.code,
          referrer_name: row.owner_name,
          owner_email: row.owner_email,
          tier: row.tier,
        };
      }
    }
  }

  // ─── 4. Insert Supabase ─────────────────────────────────────────
  const { data: inserted, error: insertErr } = await sb
    .from("eurealimmo_applications")
    .insert({
      first_name,
      last_name,
      email,
      phone,
      current_status,
      current_network,
      years_experience,
      has_carte_t,
      specialty,
      motivation: motivation || `Contact préféré : ${preferred_contact}`,
      consent_given: true,
      consent_given_at: new Date().toISOString(),
      ip_hash,
      user_agent,
      source: referrerInfo ? "referral" : referred_by_email ? "referral" : "website",
      referred_by_email: referrerInfo?.owner_email ?? referred_by_email,
    })
    .select("id")
    .maybeSingle();

  if (insertErr) {
    console.error("[apply] insert error:", insertErr);
    return NextResponse.json(
      { ok: false, error: "db_error", detail: insertErr.message },
      { status: 500 },
    );
  }

  const application_id = (inserted as { id?: string } | null)?.id ?? "unknown";

  // ─── 5. Emails Resend (non-bloquants) ───────────────────────────
  void sendNotificationEmails({
    application_id,
    first_name,
    last_name,
    email,
    phone,
    current_status,
    current_network,
    years_experience,
    has_carte_t,
    specialty,
    motivation,
    referred_by_email: referrerInfo?.owner_email ?? referred_by_email,
    referrer_name: referrerInfo?.referrer_name ?? null,
    tier_requested: referrerInfo?.tier ?? tier_requested,
    preferred_contact,
  });

  return NextResponse.json({
    ok: true,
    application_id,
    tier_applied: referrerInfo?.tier ?? "standard",
  });
}

// ──────────────────────────────────────────────────────────────────────────
// Email senders
// ──────────────────────────────────────────────────────────────────────────

type EmailContext = {
  application_id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  current_status: string;
  current_network: string | null;
  years_experience: string;
  has_carte_t: string;
  specialty: string;
  motivation: string;
  referred_by_email: string | null;
  referrer_name: string | null;
  tier_requested: string;
  preferred_contact: "call" | "email";
};

async function sendNotificationEmails(ctx: EmailContext) {
  if (!process.env.RESEND_API_KEY) {
    console.warn("[apply] RESEND_API_KEY absent — emails non envoyés");
    return;
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromDomain = process.env.MAIL_FROM_DOMAIN ?? "resend.dev";
  const fromAddress =
    fromDomain === "resend.dev" ? "onboarding@resend.dev" : `no-reply@${fromDomain}`;

  // Email 1 : notification interne à Samuel
  try {
    await resend.emails.send({
      from: `Eurealimmo Réseau <${fromAddress}>`,
      to: "contact@datamerry.com",
      replyTo: ctx.email,
      subject: `[Eurealimmo] Nouvelle candidature : ${ctx.first_name} ${ctx.last_name}`,
      html: buildAdminEmail(ctx),
    } as Parameters<typeof resend.emails.send>[0]);
  } catch (err) {
    console.error("[apply] admin email failed:", err);
  }

  // Email 2 : confirmation au candidat
  try {
    await resend.emails.send({
      from: `Eurealimmo Réseau <${fromAddress}>`,
      to: ctx.email,
      replyTo: "contact@datamerry.com",
      subject: "Votre candidature Eurealimmo Réseau a bien été reçue",
      html: buildCandidateEmail(ctx),
    } as Parameters<typeof resend.emails.send>[0]);
  } catch (err) {
    console.error("[apply] candidate email failed:", err);
  }
}

function buildAdminEmail(ctx: EmailContext): string {
  const tierBadge =
    ctx.tier_requested === "founder"
      ? `<span style="background:#c8a25d;color:#0f172a;padding:4px 10px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.1em;">FONDATEUR</span>`
      : "";
  return `
<!DOCTYPE html>
<html><body style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #0f172a;">Nouvelle candidature ${tierBadge}</h2>
  <p style="color: #475569;">Reçue le ${new Date().toLocaleString("fr-FR")} via reseau.eurealimmo.com</p>
  ${
    ctx.referrer_name
      ? `<p style="background:#fef3c7;padding:10px 14px;border-left:3px solid #c8a25d;color:#78350f;">
           ✨ <strong>Recommandé par ${ctx.referrer_name}</strong> (programme Fondateur — referral 18% à vie)
         </p>`
      : ""
  }
  <p style="color: #475569;"><strong>Contact préféré :</strong> ${ctx.preferred_contact === "call" ? "📞 Appel" : "📧 Email"}</p>

  <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
    <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Nom</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${ctx.first_name} ${ctx.last_name}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Email</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><a href="mailto:${ctx.email}">${ctx.email}</a></td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Téléphone</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><a href="tel:${ctx.phone}">${ctx.phone}</a></td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Statut actuel</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${ctx.current_status}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Réseau actuel</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${ctx.current_network ?? "—"}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Expérience</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${ctx.years_experience}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Carte T</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${ctx.has_carte_t}</td></tr>
    <tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Spécialité</strong></td>
        <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${ctx.specialty}</td></tr>
    ${
      ctx.referred_by_email
        ? `<tr><td style="padding: 8px; border-bottom: 1px solid #e2e8f0;"><strong>Recommandé par</strong></td>
           <td style="padding: 8px; border-bottom: 1px solid #e2e8f0;">${ctx.referred_by_email}</td></tr>`
        : ""
    }
  </table>

  <h3 style="color: #0f172a;">Motivation</h3>
  <p style="background: #f8fafc; padding: 16px; border-left: 3px solid #c8a25d; color: #475569; line-height: 1.6;">
    ${ctx.motivation.replace(/\n/g, "<br>")}
  </p>

  <p style="color: #94a3b8; font-size: 12px; margin-top: 30px;">
    Application ID : ${ctx.application_id}<br>
    À répondre sous 48h ouvrées.
  </p>
</body></html>`;
}

function buildCandidateEmail(ctx: EmailContext): string {
  return `
<!DOCTYPE html>
<html><body style="font-family: Georgia, serif; max-width: 640px; margin: 0 auto; padding: 0; background: #fafafa;">
  <div style="background: #0f172a; padding: 30px; text-align: center;">
    <div style="display: inline-block; padding: 12px 20px; background: #c8a25d; color: #0f172a; font-weight: 700; font-size: 14px; letter-spacing: 0.1em;">
      EUREALIMMO RÉSEAU
    </div>
  </div>

  <div style="padding: 40px 30px; background: white;">
    <h2 style="color: #0f172a; font-family: Georgia, serif; margin-top: 0;">Bonjour ${ctx.first_name},</h2>

    <p style="color: #475569; line-height: 1.7; font-size: 15px; font-family: Arial, sans-serif;">
      Nous avons bien reçu votre candidature pour rejoindre <strong>Eurealimmo Réseau</strong>.
    </p>

    <p style="color: #475569; line-height: 1.7; font-size: 15px; font-family: Arial, sans-serif;">
      Notre équipe étudie votre dossier et vous reviendra <strong>sous 48 heures ouvrées</strong>
      pour planifier un premier échange téléphonique (30 minutes).
    </p>

    <div style="background: #f8fafc; padding: 20px; border-left: 3px solid #c8a25d; margin: 30px 0; font-family: Arial, sans-serif;">
      <p style="margin: 0; color: #475569; font-size: 14px;">
        <strong>En attendant :</strong> nous vous invitons à parcourir notre site
        <a href="https://reseau.eurealimmo.com" style="color: #c8a25d;">reseau.eurealimmo.com</a>
        et à préparer vos questions sur les modalités du contrat (carte T sous couverture,
        commission 5 %, registre blockchain, etc.).
      </p>
    </div>

    <p style="color: #475569; line-height: 1.7; font-size: 15px; font-family: Arial, sans-serif;">
      Pour toute question urgente, vous pouvez répondre directement à cet email ou nous écrire
      à <a href="mailto:contact@datamerry.com" style="color: #c8a25d;">contact@datamerry.com</a>.
    </p>

    <p style="color: #475569; line-height: 1.7; font-size: 15px; font-family: Arial, sans-serif; margin-top: 30px;">
      Cordialement,<br>
      <strong>Samuel BRUNO</strong><br>
      Président, Eurealimmo
    </p>
  </div>

  <div style="background: #020617; color: #94a3b8; padding: 20px 30px; font-size: 11px; text-align: center; font-family: Arial, sans-serif;">
    <p style="margin: 0 0 8px;">
      <strong style="color: white;">EUREALIMMO</strong> · SARL au capital social
      <br>SIREN 984 449 470 · RCS Paris
      <br>Carte professionnelle T n° CPI 7501 2024 000 219 (CCI Paris)
    </p>
    <p style="margin: 12px 0 0; color: #475569;">
      Conforme loi Hoguet n° 70-9 et décret 72-678 · RGPD conforme · Application ${ctx.application_id.slice(0, 8)}
    </p>
  </div>
</body></html>`;
}
