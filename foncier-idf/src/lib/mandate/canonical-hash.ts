/**
 * DATAMERRY × Eurealimmo Réseau — Hash canonique du mandat pour ancrage blockchain.
 *
 * Calcule un SHA256 stable sur les champs essentiels du mandat, à partir d'un
 * payload JSON canonique (clés triées alphabétiquement, valeurs normalisées).
 *
 * Pourquoi canonique :
 *   - Garantir que le même mandat produit toujours le même hash, peu importe
 *     l'ordre des champs JSON, les espaces blancs, etc.
 *   - Permet à un tiers de vérifier l'authenticité d'un mandat en recalculant
 *     son hash et en le comparant à celui ancré on-chain.
 *
 * RGPD-safe :
 *   - On n'inclut PAS les coordonnées complètes (email, téléphone).
 *   - On utilise des initiales pour le visitor_name.
 *   - On garde l'adresse du bien (info publique cadastrale).
 *
 * Référence : RFC 8785 (JSON Canonicalization Scheme) — implémentation
 * simplifiée suffisante pour notre usage interne.
 */

import { createHash } from "crypto";

export type MandatCanonicalInput = {
  lead_id: string;
  cabinet_slug: string;
  mandat_type: "vente" | "recherche" | "location";
  mandat_modalite: "simple" | "exclusif" | "semi_exclusif" | null;
  mandat_signe_at: string; // ISO timestamp
  mandat_numero_registre: string | null;
  mandat_duree_mois: number | null;
  mandat_commission_pct: number | null;
  mandat_prix_net_vendeur: number | null;
  mandat_prix_max: number | null;
  visitor_name: string;
  address: string;
  type_bien: string;
  surface: number | null;
};

export type MandatCanonicalPayload = {
  // L'ordre des champs ici sera respecté par JSON.stringify avec replacer trié.
  cabinet_slug: string;
  lead_id: string;
  mandat_commission_pct: number | null;
  mandat_duree_mois: number | null;
  mandat_modalite: string | null;
  mandat_numero_registre: string | null;
  mandat_prix_max: number | null;
  mandat_prix_net_vendeur: number | null;
  mandat_signe_at: string;
  mandat_type: string;
  property_address_norm: string;
  property_surface_m2: number | null;
  property_type: string;
  visitor_initials: string;
};

/**
 * Convertit "Diara CAMARA" en "DC" ; "Jean-Pierre Dupont" en "JD" ;
 * conserve la confidentialité même si le hash est rendu public.
 */
function extractInitials(name: string): string {
  if (!name) return "";
  return name
    .split(/[\s-]+/)
    .filter((p) => p.length > 0)
    .map((p) => p[0]!.toUpperCase())
    .slice(0, 4) // max 4 initiales (compose / particules)
    .join("");
}

/**
 * Normalise une adresse pour limiter les écarts de casse/espaces sans
 * altérer son identité. Conserve l'adresse pour vérifiabilité publique
 * (cadastre).
 */
function normalizeAddress(addr: string): string {
  return addr.trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * Construit le payload canonique à hasher.
 */
export function buildMandatCanonicalPayload(
  input: MandatCanonicalInput,
): MandatCanonicalPayload {
  return {
    cabinet_slug: input.cabinet_slug.toLowerCase().trim(),
    lead_id: input.lead_id,
    mandat_commission_pct: input.mandat_commission_pct,
    mandat_duree_mois: input.mandat_duree_mois,
    mandat_modalite: input.mandat_modalite,
    mandat_numero_registre: input.mandat_numero_registre,
    mandat_prix_max: input.mandat_prix_max,
    mandat_prix_net_vendeur: input.mandat_prix_net_vendeur,
    // ISO 8601, secondes UTC (on évite les ms qui peuvent varier)
    mandat_signe_at: new Date(input.mandat_signe_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
    mandat_type: input.mandat_type,
    property_address_norm: normalizeAddress(input.address),
    property_surface_m2: input.surface,
    property_type: input.type_bien,
    visitor_initials: extractInitials(input.visitor_name),
  };
}

/**
 * Sérialisation JSON canonique simple :
 *   - clés triées alphabétiquement (récursif)
 *   - pas d'espaces blancs superflus
 *   - null/numbers/strings sérialisés standard
 */
function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return "[" + obj.map(canonicalJsonStringify).join(",") + "]";
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const parts = keys.map((k) => {
    const v = (obj as Record<string, unknown>)[k];
    return JSON.stringify(k) + ":" + canonicalJsonStringify(v);
  });
  return "{" + parts.join(",") + "}";
}

/**
 * Calcule le SHA256 hex (64 chars) du payload canonique.
 */
export function computeMandatHash(input: MandatCanonicalInput): {
  hash: string;
  payload: MandatCanonicalPayload;
  canonical_json: string;
} {
  const payload = buildMandatCanonicalPayload(input);
  const canonical_json = canonicalJsonStringify(payload);
  const hash = createHash("sha256").update(canonical_json).digest("hex");
  return { hash, payload, canonical_json };
}
