"use client";

/**
 * Composant NEUTRALISÉ.
 *
 * Ce composant contenait des CTAs commerciaux (Découvrir l'offre Pro,
 * badges Historique 5 ans, Export PDF, Alertes ventes, etc.). Il a été
 * neutralisé pour la surface publique datamerry.com dans le cadre du
 * cumul déontologique DEAL. Voir memory feedback_cumul_deal.
 *
 * Retourne null pour ne rien afficher sur les pages publiques
 * /analyse/[code] et /marche-immobilier/[code].
 */

interface Props {
  commune: { code: string; nom: string };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function AnalyseLeadSection(_props: Props) {
  return null;
}
