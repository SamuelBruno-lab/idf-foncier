/**
 * SOURCE UNIQUE DE VÉRITÉ — conditions économiques des tiers mandataire
 * Eurealimmo Réseau (Fondateur vs Standard).
 *
 * Toute évolution tarifaire se fait ICI (et se répercute sur la génération
 * de contrat, l'affichage, et les contrôles). Ne pas dupliquer ces chiffres
 * ailleurs.
 *
 * Détermination du tier en base : eurealimmo_mandataires.commission_eurealimmo_pct
 *   5  → founder
 *   8  → standard
 * (convention déjà utilisée dans l'app : onboarding route + vue admin).
 */

export type Tier = "founder" | "standard";

export type TierConfig = {
  key: Tier;
  /** Libellé désignation dans le contrat. */
  designation: string;
  /** Abonnement réseau mensuel HT (€). */
  monthly_subscription_eur: number;
  /** % retenu par Eurealimmo sur la commission encaissée. */
  retention_pct: number;
  /** % rétrocédé au mandataire (= 100 - retention_pct). */
  retrocession_pct: number;
  /** Mois d'abonnement offerts à l'entrée. */
  free_months: number;
  /** Verrouillage / durée ferme en mois (0 = mensuel résiliable). */
  lock_months: number;
  /** Préavis de résiliation en mois. */
  notice_months: number;
  /** Parrainage 1 niveau. */
  referral: {
    enabled: boolean;
    /** % HT sur les commissions retenues des référés directs. */
    pct: number;
    /** Durée de versement en mois (0 = à vie). */
    duration_months: number;
    /** Toujours 1 niveau (anti-MLM). */
    levels: 1;
  };
  /** Avantages réservés (prime de cession, préemption, bonus fidélité). */
  has_cession_premium: boolean;
  has_preemption_right: boolean;
  has_loyalty_bonus: boolean;
  /** Place fondateur requise (numéro 1..60). */
  requires_founder_number: boolean;
};

export const TIERS: Record<Tier, TierConfig> = {
  founder: {
    key: "founder",
    designation: "Associé(e) Fondateur(trice)",
    monthly_subscription_eur: 59,
    retention_pct: 5,
    retrocession_pct: 95,
    free_months: 6,
    lock_months: 36,
    notice_months: 3,
    referral: { enabled: true, pct: 20, duration_months: 0, levels: 1 }, // 20% HNWI à vie / 15% std 12 mois (détail dans le contrat)
    has_cession_premium: true,
    has_preemption_right: true,
    has_loyalty_bonus: true,
    requires_founder_number: true,
  },
  standard: {
    key: "standard",
    designation: "Mandataire",
    monthly_subscription_eur: 79,
    retention_pct: 8,
    retrocession_pct: 92,
    free_months: 0,
    lock_months: 0, // mensuel résiliable
    notice_months: 1,
    referral: { enabled: true, pct: 10, duration_months: 12, levels: 1 },
    has_cession_premium: false,
    has_preemption_right: false,
    has_loyalty_bonus: false,
    requires_founder_number: false,
  },
};

/** 60 places fondateur maximum sur le réseau. */
export const FOUNDER_CAP = 60;

/** Déduit le tier depuis la commission retenue stockée. */
export function tierFromCommissionPct(pct: number | null | undefined): Tier | null {
  if (pct === 5) return "founder";
  if (pct === 8) return "standard";
  return null;
}
