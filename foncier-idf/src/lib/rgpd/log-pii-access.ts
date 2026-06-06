/**
 * Helper RGPD — logging systématique des accès aux données personnelles.
 *
 * À appeler depuis chaque API route qui lit/exporte/modifie/supprime
 * une donnée personnelle (PII).
 *
 * Best-effort : un échec d'écriture du log NE DOIT PAS faire échouer
 * la requête métier — sinon on bloque tout en cas de panne Supabase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type PIIResourceType =
  | "lead"
  | "lead_list"
  | "lead_export"
  | "mandataire"
  | "mandataire_list"
  | "mandataire_contrat"
  | "collabimo_member"
  | "collabimo_member_list"
  | "lead_match_history";

export type PIIAction =
  | "READ"
  | "LIST"
  | "EXPORT"
  | "UPDATE"
  | "DELETE";

export interface LogPIIAccessArgs {
  supabase: SupabaseClient;
  cabinetSlug: string;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: "admin" | "mandataire" | "system" | "cron";
  resourceType: PIIResourceType;
  resourceId?: string | null;
  action: PIIAction;
  ip?: string | null;
  userAgent?: string | null;
  endpoint?: string | null;
  httpMethod?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Enregistre un accès PII dans audit_pii_access.
 *
 * Best-effort : log l'erreur dans la console serveur en cas d'échec,
 * mais ne throw pas (sinon la requête métier échoue alors qu'elle
 * a déjà été exécutée).
 */
export async function logPIIAccess(args: LogPIIAccessArgs): Promise<void> {
  try {
    const { error } = await args.supabase.rpc("log_pii_access", {
      p_cabinet_slug: args.cabinetSlug,
      p_actor_id: args.actorId ?? null,
      p_actor_email: args.actorEmail ?? null,
      p_actor_role: args.actorRole ?? "admin",
      p_resource_type: args.resourceType,
      p_resource_id: args.resourceId ?? null,
      p_action: args.action,
      p_ip: args.ip ?? null,
      p_user_agent: args.userAgent ?? null,
      p_endpoint: args.endpoint ?? null,
      p_http_method: args.httpMethod ?? null,
      p_metadata: (args.metadata ?? {}) as Record<string, unknown>,
    });
    if (error) {
      console.error("[RGPD] log_pii_access failed:", error);
    }
  } catch (err) {
    console.error("[RGPD] log_pii_access exception:", err);
  }
}

/**
 * Extrait IP + user-agent depuis les headers de la requête.
 */
export function extractRequestContext(req: Request): {
  ip: string | null;
  userAgent: string | null;
  endpoint: string;
  httpMethod: string;
} {
  const url = new URL(req.url);
  return {
    ip:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      req.headers.get("x-real-ip") ??
      null,
    userAgent: req.headers.get("user-agent") ?? null,
    endpoint: url.pathname,
    httpMethod: req.method,
  };
}
