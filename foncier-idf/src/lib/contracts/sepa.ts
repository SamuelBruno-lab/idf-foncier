/**
 * Prélèvement SEPA de l'abonnement réseau mandataire via Stripe Billing.
 *
 * Stripe agit comme créancier SEPA (pas besoin d'ICS propre). Le mandataire
 * autorise le mandat SEPA via Stripe Checkout (mode subscription) ; Stripe gère
 * ensuite le prélèvement récurrent + les relances (dunning).
 *
 * Prix par tier (à créer dans Stripe Dashboard, puis coller les price_… en env) :
 *   STRIPE_PRICE_MANDATAIRE_FOUNDER   → 59 €/mois HT
 *   STRIPE_PRICE_MANDATAIRE_STANDARD  → 79 €/mois HT
 *
 * Founder : essai 6 mois (1er prélèvement au mois 7). Standard : sans essai.
 */

import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { TIERS, type Tier } from "./tiers";

const FOUNDER_TRIAL_DAYS = 183; // ~6 mois

export function mandatairePriceId(tier: Tier): string {
  const id =
    tier === "founder"
      ? process.env.STRIPE_PRICE_MANDATAIRE_FOUNDER
      : process.env.STRIPE_PRICE_MANDATAIRE_STANDARD;
  if (!id) {
    throw new Error(
      `Prix Stripe manquant pour le tier ${tier} — configurer STRIPE_PRICE_MANDATAIRE_${tier.toUpperCase()} en env.`,
    );
  }
  return id;
}

export function isSepaConfigured(tier: Tier): boolean {
  if (!process.env.STRIPE_SECRET_KEY) return false;
  return tier === "founder"
    ? Boolean(process.env.STRIPE_PRICE_MANDATAIRE_FOUNDER)
    : Boolean(process.env.STRIPE_PRICE_MANDATAIRE_STANDARD);
}

async function getOrCreateMandataireCustomer(args: {
  mandataire_id: string;
  email: string;
  name?: string;
}): Promise<Stripe.Customer> {
  const stripe = getStripe();
  const existing = await stripe.customers.search({
    query: `email:"${args.email}" AND metadata['mandataire_id']:"${args.mandataire_id}"`,
    limit: 1,
  });
  if (existing.data.length > 0) return existing.data[0];
  return stripe.customers.create({
    email: args.email,
    name: args.name,
    metadata: { mandataire_id: args.mandataire_id, kind: "eurealimmo_mandataire" },
  });
}

/**
 * Crée une session Stripe Checkout (SEPA Direct Debit) pour autoriser le
 * prélèvement de l'abonnement réseau et démarrer l'abonnement.
 */
export async function createMandataireSepaCheckout(args: {
  mandataire_id: string;
  email: string;
  name?: string;
  tier: Tier;
  success_url: string;
  cancel_url: string;
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  const price = mandatairePriceId(args.tier);
  const customer = await getOrCreateMandataireCustomer({
    mandataire_id: args.mandataire_id,
    email: args.email,
    name: args.name,
  });

  const subscription_data: Stripe.Checkout.SessionCreateParams.SubscriptionData = {
    metadata: { mandataire_id: args.mandataire_id, tier: args.tier },
  };
  if (TIERS[args.tier].free_months > 0) {
    subscription_data.trial_period_days = FOUNDER_TRIAL_DAYS;
  }

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customer.id,
    payment_method_types: ["sepa_debit"],
    line_items: [{ price, quantity: 1 }],
    success_url: args.success_url,
    cancel_url: args.cancel_url,
    locale: "fr",
    metadata: { mandataire_id: args.mandataire_id, tier: args.tier, kind: "mandataire_sepa" },
    subscription_data,
  });
}
