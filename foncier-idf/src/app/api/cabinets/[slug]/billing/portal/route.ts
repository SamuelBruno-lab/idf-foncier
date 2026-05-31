/**
 * POST /api/cabinets/[slug]/billing/portal
 *
 * Crée une session de portail client Stripe pour qu'un cabinet abonné gère
 * son abonnement (méthode de paiement, factures, annulation).
 *
 * Auth : cookie session admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createBillingPortalSession } from "@/lib/stripe";
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

  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const sb = getSupabase();
  const { data: subData } = await sb
    .from("v_cabinet_billing_status")
    .select("stripe_customer_id")
    .eq("cabinet_slug", slug)
    .maybeSingle();

  const customerId = (subData as { stripe_customer_id?: string } | null)?.stripe_customer_id;
  if (!customerId) {
    return NextResponse.json(
      { ok: false, error: "no_subscription", detail: "Aucun abonnement actif trouvé." },
      { status: 404 },
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL?.startsWith("http")
      ? process.env.VERCEL_URL
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

  try {
    const portal = await createBillingPortalSession({
      stripe_customer_id: customerId,
      return_url: `${baseUrl}/cabinets/${slug}/admin/billing`,
    });

    return NextResponse.json({ ok: true, url: portal.url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json(
      { ok: false, error: "stripe_error", detail: msg },
      { status: 500 },
    );
  }
}
