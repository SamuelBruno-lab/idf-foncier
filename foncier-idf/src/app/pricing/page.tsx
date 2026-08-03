/**
 * Page /pricing DÉSACTIVÉE.
 *
 * Cette page est neutralisée pour la surface publique datamerry.com afin
 * d'éviter toute apparence d'activité commerciale rémunérée (cumul avec
 * fonction publique — DEAL). Voir memory feedback_cumul_deal.
 *
 * Les offres B2B restent gérées via des contrats écrits directement avec
 * les cabinets partenaires (Collabimo, Eurealimmo, futurs). Elles ne sont
 * plus exposées publiquement sur le site.
 */

import { notFound } from "next/navigation";

export const dynamic = "force-static";

export default function PricingPage() {
  notFound();
}
