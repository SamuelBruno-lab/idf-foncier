/**
 * DATAMERRY API — Authentification par clé API
 *
 * Format de clé : dmk_live_<32 chars base32>  (ex: dmk_live_a7k9p2x4m1n8q3r5s6t7u8v9w0xyz123)
 *                dmk_test_<32 chars base32>  pour les clés de test
 *
 * Stockage : on stocke SHA-256(clé) + les 8 premiers chars comme prefix pour debug.
 * La clé en clair n'apparaît qu'une seule fois : à la création, on la renvoie
 * au cabinet par email. Elle n'est ensuite jamais récupérable.
 */

import { createHash, randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type ApiKeyRecord = {
  id: string;
  cabinet_name: string;
  contact_email: string;
  plan: "pilot" | "pro" | "enterprise" | "internal" | "widget";
  monthly_quota: number;
  active: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  stripe_subscription_item_id: string | null;
  first_month_free: boolean;
  /** Pour les clés widget : liste de domaines autorisés (lowercase, sans schéma). */
  allowed_referrers: string[] | null;
};

export type AuthSuccess = {
  ok: true;
  key: ApiKeyRecord;
};

export type AuthFailure = {
  ok: false;
  status: number;
  error: string;
  hint?: string;
};

export type AuthResult = AuthSuccess | AuthFailure;

// ──────────────────────────────────────────────────────────────────────────────
// Génération & hashing
// ──────────────────────────────────────────────────────────────────────────────

const BASE32_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"; // pas de 0/1/l/o pour lisibilité

/**
 * Génère une clé API au format `dmk_live_<32 chars>`.
 * Entropie ≈ 32 * 5 = 160 bits (équivalent UUID v4).
 */
export function generateApiKey(env: "live" | "test" = "live"): string {
  const bytes = randomBytes(20);
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += BASE32_ALPHABET[bytes[i % bytes.length] % BASE32_ALPHABET.length];
  }
  return `dmk_${env}_${out}`;
}

/** SHA-256 hex (lowercase) de la clé. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** Les 8 premiers chars pour identification visuelle. */
export function keyPrefix(key: string): string {
  return key.slice(0, 8); // 'dmk_live' / 'dmk_test' / 'wdmk_liv' / 'wdmk_tes'
}

/**
 * Génère une clé widget — préfixe `wdmk_` pour la distinguer d'une clé serveur.
 * Format : wdmk_live_<32 base32>.
 */
export function generateWidgetKey(env: "live" | "test" = "live"): string {
  const bytes = randomBytes(20);
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += BASE32_ALPHABET[bytes[i % bytes.length] % BASE32_ALPHABET.length];
  }
  return `wdmk_${env}_${out}`;
}

/**
 * Extrait le domaine d'un header Referer/Origin.
 * "https://www.collabimmo.fr/biens/abc" → "www.collabimmo.fr"
 * Retourne null si le header est absent ou malformé.
 */
export function extractDomain(headerValue: string | null): string | null {
  if (!headerValue) return null;
  try {
    return new URL(headerValue).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Vérifie qu'un domaine matche la liste des referrers autorisés.
 * Match exact OU sous-domaine (collabimmo.fr autorise app.collabimmo.fr si déclaré comme "*.collabimmo.fr").
 */
export function isDomainAllowed(
  domain: string,
  allowed: string[] | null,
): boolean {
  if (!allowed || allowed.length === 0) return true; // pas de restriction
  const d = domain.toLowerCase();
  for (const entry of allowed) {
    const e = entry.toLowerCase();
    if (e === d) return true;
    if (e.startsWith("*.") && d.endsWith(e.slice(1))) return true;
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// Extraction de la clé depuis la requête
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Accepte les clés via :
 *   - Header `X-API-Key: dmk_live_...`
 *   - Header `Authorization: Bearer dmk_live_...`
 *   - Query param `?api_key=dmk_live_...`  (déconseillé — uniquement pour debug)
 */
export function extractApiKey(req: NextRequest): string | null {
  const xKey = req.headers.get("x-api-key");
  if (xKey && xKey.startsWith("dmk_")) return xKey.trim();

  const auth = req.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token.startsWith("dmk_")) return token;
  }

  const qs = req.nextUrl.searchParams.get("api_key");
  if (qs && qs.startsWith("dmk_")) return qs.trim();

  return null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Vérification
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Vérifie la clé contre `dim_api_keys`.
 * Retourne le record si tout est OK, sinon AuthFailure prêt à être renvoyé.
 *
 * NB: on NE vérifie PAS le quota ici (pas de hard cap : overage prend le relais).
 * Le quota sert uniquement au calcul de l'overage côté `v_api_usage_monthly`.
 */
export async function verifyApiKey(rawKey: string): Promise<AuthResult> {
  if (!rawKey || !rawKey.startsWith("dmk_")) {
    return {
      ok: false,
      status: 401,
      error: "invalid_api_key_format",
      hint: "La clé doit commencer par dmk_live_ ou dmk_test_",
    };
  }

  const hash = hashApiKey(rawKey);
  const sb = getSupabaseServerClient();

  const { data, error } = await sb
    .from("dim_api_keys")
    .select(
      "id, cabinet_name, contact_email, plan, monthly_quota, active, expires_at, revoked_at, stripe_subscription_item_id, first_month_free, allowed_referrers"
    )
    .eq("key_hash", hash)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      status: 500,
      error: "auth_lookup_failed",
      hint: error.message,
    };
  }
  if (!data) {
    return {
      ok: false,
      status: 401,
      error: "unknown_api_key",
      hint: "Clé inconnue ou révoquée. Contact: support@datamerry.com",
    };
  }

  const k = data as ApiKeyRecord;

  if (!k.active || k.revoked_at) {
    return {
      ok: false,
      status: 403,
      error: "api_key_revoked",
      hint: "Clé désactivée. Contact: billing@datamerry.com",
    };
  }
  if (k.expires_at && new Date(k.expires_at).getTime() < Date.now()) {
    return {
      ok: false,
      status: 403,
      error: "api_key_expired",
      hint: `Clé expirée le ${k.expires_at}.`,
    };
  }

  return { ok: true, key: k };
}

// ──────────────────────────────────────────────────────────────────────────────
// Logging usage (fire-and-forget — ne doit JAMAIS bloquer la réponse)
// ──────────────────────────────────────────────────────────────────────────────

export type UsageLogPayload = {
  api_key_id: string;
  endpoint: string;
  method: string;
  status: number;
  latency_ms: number;
  ip: string | null;
  user_agent: string | null;
  address_searched?: string | null;
  insee_commune?: string | null;
  surface?: number | null;
  /** false si erreur 5xx côté nous (on ne facture pas). */
  billable: boolean;
};

export async function logApiUsage(payload: UsageLogPayload): Promise<void> {
  try {
    const sb = getSupabaseServerClient();
    await sb.from("api_usage_log").insert(payload);
    // Update last_used_at de façon non bloquante
    await sb
      .from("dim_api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", payload.api_key_id);
  } catch (err) {
    // On log mais on ne propage jamais — la réponse au client doit partir.
    console.error("[api_usage_log] insert failed:", err);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Wrapper réutilisable pour les routes API Next.js
// ──────────────────────────────────────────────────────────────────────────────

export type Handler = (
  req: NextRequest,
  ctx: { key: ApiKeyRecord }
) => Promise<NextResponse>;

export type WithApiKeyOptions = {
  /** Tag fonctionnel inscrit dans le log (ex: 'estimate'). Par défaut = pathname. */
  endpoint?: string;
  /** Si false, on logge même quand status >= 500. Default: true (5xx = non billable). */
  skipBillingOn5xx?: boolean;
};

/**
 * Wrapper d'auth pour les routes App Router.
 *
 * Usage:
 *   export const GET = withApiKey(async (req, { key }) => {
 *     // ... logique métier
 *     return NextResponse.json({ ... });
 *   }, { endpoint: 'estimate' });
 */
export function withApiKey(
  handler: Handler,
  opts: WithApiKeyOptions = {}
): (req: NextRequest) => Promise<NextResponse> {
  const skipBillingOn5xx = opts.skipBillingOn5xx ?? true;

  return async (req: NextRequest) => {
    const t0 = Date.now();
    const rawKey = extractApiKey(req);

    if (!rawKey) {
      return NextResponse.json(
        {
          error: "missing_api_key",
          hint:
            "Envoyez votre clé via le header `X-API-Key: dmk_live_...` ou " +
            "`Authorization: Bearer dmk_live_...`. " +
            "Pas encore de clé ? Souscrivez sur https://datamerry.com/api (39€ TTC/mo, 1er mois offert).",
        },
        { status: 401 }
      );
    }

    const auth = await verifyApiKey(rawKey);
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, hint: auth.hint },
        { status: auth.status }
      );
    }

    // Pour les clés widget : vérifier le domaine d'origine.
    // Origin > Referer car Origin est obligatoire sur les requêtes CORS cross-origin.
    if (auth.key.plan === "widget" || auth.key.allowed_referrers) {
      const originDomain =
        extractDomain(req.headers.get("origin")) ??
        extractDomain(req.headers.get("referer"));
      if (!originDomain) {
        return NextResponse.json(
          {
            error: "missing_origin",
            hint:
              "Les clés widget exigent un header Origin ou Referer valide. " +
              "Si tu testes en local, utilise une clé serveur (dmk_live_…) à la place.",
          },
          { status: 403 }
        );
      }
      if (!isDomainAllowed(originDomain, auth.key.allowed_referrers)) {
        return NextResponse.json(
          {
            error: "referrer_not_allowed",
            hint: `Le domaine ${originDomain} n'est pas autorisé pour cette clé widget. Mets à jour allowed_referrers via support@datamerry.com.`,
          },
          { status: 403 }
        );
      }
    }

    let response: NextResponse;
    let threw = false;
    try {
      response = await handler(req, { key: auth.key });
    } catch (err) {
      threw = true;
      console.error("[withApiKey] handler threw:", err);
      response = NextResponse.json(
        { error: "internal_server_error" },
        { status: 500 }
      );
    }

    const status = response.status;
    const billable = !(threw || (skipBillingOn5xx && status >= 500));
    const endpoint = opts.endpoint ?? req.nextUrl.pathname;
    const url = req.nextUrl;

    // Fire-and-forget (sans await) — ne pas bloquer la réponse client.
    void logApiUsage({
      api_key_id: auth.key.id,
      endpoint,
      method: req.method,
      status,
      latency_ms: Date.now() - t0,
      ip:
        req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        req.headers.get("x-real-ip") ??
        null,
      user_agent: req.headers.get("user-agent"),
      address_searched: url.searchParams.get("address"),
      insee_commune: url.searchParams.get("insee") ?? url.searchParams.get("code_commune"),
      surface: url.searchParams.get("surface")
        ? Number(url.searchParams.get("surface"))
        : null,
      billable,
    });

    return response;
  };
}
