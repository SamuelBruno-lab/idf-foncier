/**
 * POST /api/webhooks/stripe
 *
 * Reçoit les événements Stripe et met à jour la BDD :
 *   - customer.subscription.created / updated / deleted
 *   - invoice.paid / payment_failed
 *   - checkout.session.completed
 *
 * Sécurité : vérification de la signature Stripe via STRIPE_WEBHOOK_SECRET.
 *
 * Idempotence : on log chaque event dans dim_stripe_webhook_events avec son
 * stripe_event_id (UNIQUE), donc les retries ne dupliquent pas les updates.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { getStripe, STRIPE_WEBHOOK_SECRET } from "@/lib/stripe";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { ok: false, error: "webhook_secret_missing" },
      { status: 503 },
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ ok: false, error: "no_signature" }, { status: 400 });
  }

  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[webhooks/stripe] signature verification failed:", msg);
    return NextResponse.json(
      { ok: false, error: "invalid_signature", detail: msg },
      { status: 400 },
    );
  }

  const sb = getSupabase();

  // Log l'event (idempotence via ON CONFLICT)
  const cabinet_slug =
    (event.data.object as { metadata?: { cabinet_slug?: string } })?.metadata
      ?.cabinet_slug ?? null;

  const obj = event.data.object as {
    customer?: string | { id: string };
    subscription?: string | { id: string };
    id?: string;
  };

  const customer_id =
    typeof obj.customer === "string" ? obj.customer : obj.customer?.id ?? null;
  const subscription_id =
    typeof obj.subscription === "string"
      ? obj.subscription
      : obj.subscription?.id ?? (event.type.startsWith("customer.subscription") ? obj.id : null);

  await sb.from("dim_stripe_webhook_events").upsert(
    {
      stripe_event_id: event.id,
      event_type: event.type,
      api_version: event.api_version,
      cabinet_slug,
      subscription_id,
      customer_id,
      raw_payload: event,
    },
    { onConflict: "stripe_event_id" },
  );

  // Traitement event-type spécifique
  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await handleSubscriptionEvent(sb, event.data.object as Stripe.Subscription, cabinet_slug);
        break;

      case "checkout.session.completed":
        await handleCheckoutCompleted(sb, event.data.object as Stripe.Checkout.Session);
        break;

      case "invoice.paid":
      case "invoice.payment_failed":
        // Met à jour le statut de la subscription liée si présente
        await handleInvoiceEvent(sb, event.data.object as Stripe.Invoice, event.type);
        break;

      default:
        // Event non géré explicitement (mais loggé)
        break;
    }

    // Marque comme processé
    await sb
      .from("dim_stripe_webhook_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("stripe_event_id", event.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[webhooks/stripe] processing error for ${event.type}:`, msg);
    await sb
      .from("dim_stripe_webhook_events")
      .update({ processing_error: msg })
      .eq("stripe_event_id", event.id);
    return NextResponse.json(
      { ok: false, error: "processing_failed", detail: msg },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}

// ──────────────────────────────────────────────────────────────────────────
// Handlers
// ──────────────────────────────────────────────────────────────────────────

type SB = ReturnType<typeof getSupabase>;

async function handleSubscriptionEvent(
  sb: SB,
  sub: Stripe.Subscription,
  cabinet_slug: string | null,
) {
  const slug = cabinet_slug ?? sub.metadata?.cabinet_slug ?? null;
  if (!slug) {
    console.warn("[webhooks/stripe] subscription without cabinet_slug:", sub.id);
    return;
  }

  const item = sub.items?.data?.[0];
  const price = item?.price;
  const subAny = sub as unknown as {
    current_period_start?: number;
    current_period_end?: number;
  };

  const row = {
    cabinet_slug: slug,
    stripe_customer_id:
      typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    stripe_subscription_id: sub.id,
    stripe_price_id: price?.id ?? null,
    stripe_product_id:
      typeof price?.product === "string" ? price.product : price?.product?.id ?? null,
    plan_name: "DATAMERRY Pro",
    plan_amount_eur: price?.unit_amount ?? 3900,
    plan_interval: price?.recurring?.interval ?? "month",
    plan_currency: price?.currency ?? "eur",
    status: sub.status,
    trial_end: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    current_period_start: subAny.current_period_start
      ? new Date(subAny.current_period_start * 1000).toISOString()
      : null,
    current_period_end: subAny.current_period_end
      ? new Date(subAny.current_period_end * 1000).toISOString()
      : null,
    canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    ended_at: sub.ended_at ? new Date(sub.ended_at * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
  };

  await sb
    .from("dim_cabinet_subscriptions")
    .upsert(row, { onConflict: "stripe_subscription_id" });
}

async function handleCheckoutCompleted(sb: SB, session: Stripe.Checkout.Session) {
  // En général déjà géré par customer.subscription.created, mais on récupère
  // l'email + nom pour enrichir si pas encore présent.
  const slug = session.metadata?.cabinet_slug;
  const subscription_id =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id;
  if (!slug || !subscription_id) return;

  await sb
    .from("dim_cabinet_subscriptions")
    .update({
      customer_email: session.customer_details?.email ?? null,
      customer_name: session.customer_details?.name ?? null,
    })
    .eq("stripe_subscription_id", subscription_id);
}

async function handleInvoiceEvent(sb: SB, invoice: Stripe.Invoice, eventType: string) {
  const inv = invoice as unknown as { subscription?: string | { id: string } };
  const subscription_id =
    typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
  if (!subscription_id) return;

  // Sur payment_failed on flag past_due localement (Stripe le fera aussi via subscription.updated)
  if (eventType === "invoice.payment_failed") {
    await sb
      .from("dim_cabinet_subscriptions")
      .update({ status: "past_due" })
      .eq("stripe_subscription_id", subscription_id);
  }
}
