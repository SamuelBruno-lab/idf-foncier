/**
 * DATAMERRY — Auth magic link pour les dashboards admin cabinet.
 *
 * Flow :
 *   1. Diara va sur /cabinets/collabimo/admin/login
 *   2. Elle entre son email (qui doit matcher contact_email du cabinet)
 *   3. Backend génère un token aléatoire 32 bytes hex, stocke son hash
 *      sha256 dans dim_cabinet_admin_tokens avec TTL 7 jours
 *   4. Resend envoie l'email avec le lien magique
 *      https://datamerry.com/api/cabinets/collabimo/admin/verify?token=XXX
 *   5. Au clic, l'endpoint /verify :
 *      - vérifie le hash matche un row valide (not used, not expired)
 *      - marque used_at
 *      - set un cookie HttpOnly Secure SameSite=Lax `dm_admin_session`
 *        contenant un JWT-like signé : {cabinet_slug, email, exp}
 *      - redirige vers /cabinets/{slug}/admin (dashboard)
 *   6. Toutes les routes admin (GET/PATCH /leads) lisent le cookie pour
 *      identifier le cabinet et autoriser l'accès.
 *
 * Sécurité :
 *   - Token jamais stocké en clair (sha256 hash)
 *   - Single-use (used_at)
 *   - TTL 7 jours
 *   - Cookie session HttpOnly Secure (anti XSS)
 *   - Vérification stricte email == contact_email du cabinet (pas de phishing)
 */

import { randomBytes, createHash, createHmac } from "crypto";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const TOKEN_TTL_DAYS = 7;
const SESSION_TTL_DAYS = 7;
const COOKIE_NAME = "dm_admin_session";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function getSigningSecret(): string {
  // Réutilise une env var existante OU clé de service comme fallback raisonnable.
  // En prod il vaut mieux dédier ADMIN_SESSION_SECRET (random 32 bytes).
  const s = process.env.ADMIN_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("ADMIN_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY required");
  return s;
}

// ──────────────────────────────────────────────────────────────────────────────
// Génération + envoi du magic link
// ──────────────────────────────────────────────────────────────────────────────

export async function createMagicLinkToken(args: {
  cabinet_slug: string;
  email: string;
  ip_hash?: string;
  user_agent?: string;
}): Promise<{ token: string; expires_at: Date } | null> {
  // 1. Vérifie que le cabinet existe et que l'email correspond
  const sb = getSupabase();
  const { data: cabinet } = await sb
    .from("dim_cabinets_white_label")
    .select("slug, contact_email, active")
    .eq("slug", args.cabinet_slug)
    .eq("active", true)
    .maybeSingle();

  if (!cabinet) return null;

  // L'email doit matcher (insensible à la casse)
  if (
    !cabinet.contact_email ||
    cabinet.contact_email.toLowerCase() !== args.email.toLowerCase()
  ) {
    return null;
  }

  // 2. Génère un token aléatoire 32 bytes hex (64 chars)
  const token = randomBytes(32).toString("hex");
  const token_hash = createHash("sha256").update(token).digest("hex");
  const expires_at = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000);

  // 3. Stocke le hash (pas le token en clair)
  const { error } = await sb.from("dim_cabinet_admin_tokens").insert({
    token_hash,
    cabinet_slug: args.cabinet_slug,
    email: args.email.toLowerCase(),
    expires_at: expires_at.toISOString(),
    ip_hash: args.ip_hash ?? null,
    user_agent: args.user_agent ?? null,
  });

  if (error) {
    console.error("[admin-auth] insert token failed:", error);
    return null;
  }

  return { token, expires_at };
}

// ──────────────────────────────────────────────────────────────────────────────
// Validation du token au clic
// ──────────────────────────────────────────────────────────────────────────────

export async function consumeMagicLinkToken(
  token: string,
): Promise<{ cabinet_slug: string; email: string } | null> {
  if (!token || token.length < 32) return null;

  const token_hash = createHash("sha256").update(token).digest("hex");
  const sb = getSupabase();

  // Vérifie + marque used en une fois
  const { data: row } = await sb
    .from("dim_cabinet_admin_tokens")
    .select("id, cabinet_slug, email, expires_at, used_at")
    .eq("token_hash", token_hash)
    .maybeSingle();

  if (!row) return null;
  if (row.used_at) return null; // déjà utilisé
  if (new Date(row.expires_at) < new Date()) return null; // expiré

  // Marque le token comme utilisé
  await sb
    .from("dim_cabinet_admin_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("id", row.id);

  return { cabinet_slug: row.cabinet_slug, email: row.email };
}

// ──────────────────────────────────────────────────────────────────────────────
// Signature de cookie session
// ──────────────────────────────────────────────────────────────────────────────

type SessionPayload = {
  slug: string;
  email: string;
  exp: number; // epoch seconds
};

/** Crée un cookie session signé HMAC-SHA256, encodé base64url. */
export function signSession(slug: string, email: string): string {
  const payload: SessionPayload = {
    slug,
    email,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_DAYS * 86400,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getSigningSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Vérifie + parse un cookie session. Retourne null si invalide/expiré. */
export function verifySession(cookie: string | undefined | null): SessionPayload | null {
  if (!cookie) return null;
  const parts = cookie.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = createHmac("sha256", getSigningSecret()).update(body).digest("base64url");
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Helper pour récupérer la session admin d'une requête. */
export function getAdminSession(req: NextRequest): SessionPayload | null {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  return verifySession(cookie);
}

/** Nom du cookie utilisé partout. */
export const ADMIN_SESSION_COOKIE = COOKIE_NAME;
export const ADMIN_SESSION_TTL_SECONDS = SESSION_TTL_DAYS * 86400;
