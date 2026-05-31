/**
 * POST /api/cabinets/[slug]/billing/checkout
 *
 * Crée une session Stripe Checkout pour souscrire au plan DATAMERRY Pro 39€/mo.
 *
 * Auth : cookie session admin du cabinet (ou body.email correspondant).
 *
 * Réponse :
 *   - 200 { url } : URL de redirection vers Stripe Checkout
 *   - 401 : non authentifié
 *   - 500 : erreur Stripe
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createCheckoutSession } from "@/lib/stripe";
import { getAdminSession } from "@/lib/admin-auth";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  // Vérifie session admin (ou laisse passer si on a un token public ?)
  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  // Récupère le cabinet pour le branding + email contact
  const sb = getSupabase();
  const { data: cabinet } = await sb
    .from("dim_cabinets_white_label")
    .select("slug, contact_email, brand_name")
    .eq("slug", slug)
    .maybeSingle();

  if (!cabinet) {
    return NextResponse.json({ ok: false, error: "cabinet_not_found" }, { status: 404 });
  }

  const c = cabinet as { slug: string; contact_email: string; brand_name: string };

  // Base URL pour les return URLs
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL?.startsWith("http")
      ? process.env.VERCEL_URL
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

  try {
    const checkoutSession = await createCheckoutSession({
      cabinet_slug: c.slug,
      customer_email: c.contact_email,
      customer_name: c.brand_name,
      return_url_success: `${baseUrl}/cabinets/${c.slug}/admin/billing?status=success&session={CHECKOUT_SESSION_ID}`,
      return_url_cancel: `${baseUrl}/cabinets/${c.slug}/admin/billing?status=cancel`,
    });

    return NextResponse.json({
      ok: true,
      url: checkoutSession.url,
      session_id: checkoutSession.id,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[billing/checkout] error:", msg);
    return NextResponse.json(
      {
        ok: false,
        error: "stripe_error",
        detail: msg,
        hint: msg.includes("STRIPE_")
          ? "Configurer STRIPE_SECRET_KEY et STRIPE_PRICE_DATAMERRY_PRO dans Vercel env vars."
          : undefined,
      },
      { status: 500 },
    );
  }
}
