/**
 * Helpers métier — radar de sous-exploitation foncière V1
 */

/** Rendement SDP → surface habitable (collectif neuf) */
export const RENDEMENT_HABITABLE = 0.85;

/** Surface moyenne par logement (m² habitables) */
export const SURFACE_MOY_LOGEMENT = 65;

/** Prix neuf estimé par défaut (€/m² habitable) — VLG */
export const PRIX_NEUF_DEFAUT = 5000;

export function computeResidualGfa(
  estimatedGfa: number | null,
  existingGfa: number | null
): number {
  if (estimatedGfa == null) return 0;
  return Math.max(0, estimatedGfa - (existingGfa ?? 0));
}

export function computeUnderusePct(
  existingGfa: number | null,
  estimatedGfa: number | null
): number {
  if (estimatedGfa == null || estimatedGfa <= 0) return 0;
  return Math.round((1 - (existingGfa ?? 0) / estimatedGfa) * 100);
}

export function computeResidualHabitable(residualGfa: number): number {
  return Math.round(residualGfa * RENDEMENT_HABITABLE);
}

export function computeTheoreticalUnits(residualHabitable: number): number {
  return Math.round(residualHabitable / SURFACE_MOY_LOGEMENT);
}

export function computeDeltaNeufAncien(
  prixNeuf: number | null,
  prixAncien: number | null
): number | null {
  if (prixNeuf == null || prixAncien == null || prixAncien <= 0) return null;
  return Math.round(((prixNeuf / prixAncien) - 1) * 100);
}

export type OperationBadge =
  | "Petite densification"
  | "Petite operation"
  | "Cible promoteur"
  | "Operation importante";

export function getOperationBadge(units: number): OperationBadge {
  if (units >= 25) return "Operation importante";
  if (units >= 15) return "Cible promoteur";
  if (units >= 10) return "Petite operation";
  return "Petite densification";
}

export function getBadgeColor(badge: OperationBadge): string {
  switch (badge) {
    case "Operation importante":
      return "bg-red-600";
    case "Cible promoteur":
      return "bg-orange-500";
    case "Petite operation":
      return "bg-amber-500";
    default:
      return "bg-neutral-600";
  }
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: digits,
  }).format(value);
}
