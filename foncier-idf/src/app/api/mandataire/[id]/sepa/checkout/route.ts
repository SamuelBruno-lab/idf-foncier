/**
 * POST /api/mandataire/[id]/sepa/checkout
 *
 * Crée une session Stripe Checkout (SEPA Direct Debit) pour que le mandataire
 * autorise le prélèvement de son abonnement réseau et démarre l'abonnement
 * (essai 6 mois pour les fondateurs). Renvoie l'URL Stripe à ouvrir.
 *
 * Accès : via l'id mandataire en URL (même modèle que /onboarding/step).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { resolveTier, type MandataireRow } from "@/lib/contracts/generate-mandat";
import { createMandataireSepaCheckout, isSepaConfigured } from "@/lib/contracts/sepa";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  const sb = getSupabase();
  const { data: m, error } = await sb
    .from("eurealimmo_mandataires")
    .select("id, first_name, last_name, email, company_name, founder_number, description, commission_eurealimmo_pct")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: "db_error", detail: error.message }, { status: 500 });
  }
  if (!m) {
    return NextResponse.json({ ok: false, error: "mandataire_not_found" }, { status: 404 });
  }

  const row = m as MandataireRow;

  let tier;
  try {
    tier = resolveTier(row);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "tier_undetermined", message: e instanceof Error ? e.message : String(e) },
      { status: 422 },
    );
  }

  if (!isSepaConfigured(tier)) {
    return NextResponse.json(
      {
        ok: false,
        error: "sepa_not_configured",
        hint: `Configurer STRIPE_SECRET_KEY et STRIPE_PRICE_MANDATAIRE_${tier.toUpperCase()} en env.`,
      },
      { status: 503 },
    );
  }

  const base =
    process.env.NEXT_PUBLIC_APP_URL ??
    `https://${req.headers.get("host") ?? "www.datamerry.com"}`;
  const onboardingUrl = `${base}/mandataire/${id}/onboarding`;

  let session;
  try {
    session = await createMandataireSepaCheckout({
      mandataire_id: id,
      email: row.email,
      name: `${row.first_name} ${row.last_name}`.trim(),
      tier,
      success_url: `${onboardingUrl}?sepa=ok`,
      cancel_url: `${onboardingUrl}?sepa=cancel`,
    });
  } catch (e) {
    console.error("[sepa/checkout] stripe error:", e);
    return NextResponse.json(
      { ok: false, error: "stripe_error", message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }

  // Marque l'intention (pending) — confirmé en 'active'/'trialing' par le webhook
  await sb
    .from("eurealimmo_mandataires")
    .update({ sepa_status: "pending" })
    .eq("id", id);

  return NextResponse.json({ ok: true, url: session.url, tier });
}
