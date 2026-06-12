/**
 * GET /api/mandataire/[id]/referral-codes
 *
 * Retourne les codes referral d'un mandataire (par email) :
 *   - Code founder (si Diara ou Samuel)
 *   - Code standard (créé auto à l'inscription)
 *   - Compteur global fondateurs réseau (X/60)
 *
 * Auth : UUID en URL (même pattern que /onboarding).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.eurealimmo.com";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  const sb = getSupabase();

  // Récupère l'email du mandataire pour matcher les codes
  const { data: m, error: mErr } = await sb
    .from("eurealimmo_mandataires")
    .select("id, first_name, last_name, email")
    .eq("id", id)
    .maybeSingle();

  if (mErr || !m) {
    return NextResponse.json({ ok: false, error: "mandataire_not_found" }, { status: 404 });
  }

  // Récupère les codes referral de cet owner
  const { data: codes, error: cErr } = await sb
    .from("v_referral_codes_by_owner")
    .select("*")
    .ilike("owner_email", m.email);

  if (cErr) {
    return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 });
  }

  // Enrichit avec l'URL complète
  const enriched = (codes ?? []).map((c) => ({
    ...c,
    full_url: `${BASE_URL}/onboarding?ref=${c.code}`,
    qr_code_url: `https://quickchart.io/qr?text=${encodeURIComponent(
      `${BASE_URL}/onboarding?ref=${c.code}`,
    )}&size=200&margin=1`,
  }));

  // Sépare founder et standard
  const founderCodes = enriched.filter((c) => c.tier === "founder");
  const standardCodes = enriched.filter((c) => c.tier === "standard");

  const networkFounder = enriched[0]?.network_founder_count ?? 0;
  const networkCap = enriched[0]?.network_founder_cap ?? 60;

  return NextResponse.json({
    ok: true,
    mandataire: {
      id: m.id,
      first_name: m.first_name,
      last_name: m.last_name,
      email: m.email,
    },
    founder_codes: founderCodes,
    standard_codes: standardCodes,
    network: {
      founder_count: networkFounder,
      founder_cap: networkCap,
      founder_remaining: Math.max(0, networkCap - networkFounder),
    },
  });
}
