/**
 * Stripe billing helpers — DATAMERRY Pro 39 €/mo HT.
 *
 * Env vars requises :
 *   - STRIPE_SECRET_KEY              : sk_live_... ou sk_test_...
 *   - STRIPE_WEBHOOK_SECRET          : whsec_... (du webhook endpoint)
 *   - STRIPE_PRICE_DATAMERRY_PRO     : price_... (créé dans Stripe Dashboard)
 *   - NEXT_PUBLIC_BASE_URL           : https://www.datamerry.com (pour return_url)
 *
 * Setup Stripe Dashboard (à faire UNE fois par Samuel) :
 *   1. Créer compte Stripe → vérifier identité société (SIREN 984 449 470)
 *   2. Products → New : "DATAMERRY Pro" 39 € / mois HT EUR
 *   3. Activer mode TVA automatique (France, 20 %)
 *   4. Récupérer le price_xxx → coller dans STRIPE_PRICE_DATAMERRY_PRO
 *   5. Webhooks → New endpoint : https://www.datamerry.com/api/webhooks/stripe
 *      Events : customer.subscription.created / updated / deleted, invoice.paid,
 *               invoice.payment_failed, checkout.session.completed
 *      Récupérer whsec_xxx → coller dans STRIPE_WEBHOOK_SECRET
 */

import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY missing — configure in Vercel env vars");
  }
  _stripe = new Stripe(key, {
    apiVersion: "2025-09-30.clover" as Stripe.StripeConfig["apiVersion"],
    typescript: true,
  });
  return _stripe;
}

export function getStripeOrNull(): Stripe | null {
  try {
    return getStripe();
  } catch {
    return null;
  }
}

export const STRIPE_PRICE_DATAMERRY_PRO =
  process.env.STRIPE_PRICE_DATAMERRY_PRO ?? "";

export const STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET ?? "";

/**
 * Récupère ou crée un Stripe Customer pour un cabinet donné.
 * On déduplique par email pour éviter de créer 2 customers pour le même cabinet.
 */
export async function getOrCreateCustomer(args: {
  cabinet_slug: string;
  email: string;
  name?: string;
}): Promise<Stripe.Customer> {
  const stripe = getStripe();

  // 1. Cherche un customer existant par email + metadata.cabinet_slug
  const existing = await stripe.customers.search({
    query: `email:"${args.email}" AND metadata['cabinet_slug']:"${args.cabinet_slug}"`,
    limit: 1,
  });

  if (existing.data.length > 0) {
    return existing.data[0];
  }

  // 2. Crée un nouveau customer
  return stripe.customers.create({
    email: args.email,
    name: args.name,
    metadata: { cabinet_slug: args.cabinet_slug },
  });
}

/**
 * Crée une session Stripe Checkout pour souscrire au plan DATAMERRY Pro.
 */
export async function createCheckoutSession(args: {
  cabinet_slug: string;
  customer_email: string;
  customer_name?: string;
  return_url_success: string;
  return_url_cancel: string;
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  if (!STRIPE_PRICE_DATAMERRY_PRO) {
    throw new Error(
      "STRIPE_PRICE_DATAMERRY_PRO missing — configure in Vercel env vars after creating the price in Stripe Dashboard",
    );
  }

  const customer = await getOrCreateCustomer({
    cabinet_slug: args.cabinet_slug,
    email: args.customer_email,
    name: args.customer_name,
  });

  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customer.id,
    line_items: [
      {
        price: STRIPE_PRICE_DATAMERRY_PRO,
        quantity: 1,
      },
    ],
    success_url: args.return_url_success,
    cancel_url: args.return_url_cancel,
    locale: "fr",
    automatic_tax: { enabled: true },
    customer_update: { address: "auto", name: "auto" },
    tax_id_collection: { enabled: true }, // collecte numéro TVA si pro
    metadata: { cabinet_slug: args.cabinet_slug },
    subscription_data: {
      metadata: { cabinet_slug: args.cabinet_slug },
    },
  });
}

/**
 * Crée une session de portail client Stripe pour qu'un cabinet gère son
 * abonnement (changement de méthode de paiement, annulation, factures...).
 */
export async function createBillingPortalSession(args: {
  stripe_customer_id: string;
  return_url: string;
}): Promise<Stripe.BillingPortal.Session> {
  const stripe = getStripe();
  return stripe.billingPortal.sessions.create({
    customer: args.stripe_customer_id,
    return_url: args.return_url,
  });
}
