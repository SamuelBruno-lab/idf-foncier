/**
 * Page admin cabinet : sous-densite fonciere (PLU reel + DPE passoire + persona).
 *
 * URL : /cabinets/[slug]/admin/foncier
 *
 * Auth : cookie session admin (verifySession + slug match), MEME PATTERN que
 * billing/page.tsx. Reservee aux abonnes DATAMERRY Pro actifs
 * (trialing/active/past_due) -- mur de paiement sinon (reutilise
 * BillingActions, meme composant que la page billing).
 *
 * Server component (pas "use client") : evite un flash de contenu non
 * autorise avant la redirection/le mur de paiement.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { verifySession, ADMIN_SESSION_COOKIE } from "@/lib/admin-auth";
import { BillingActions } from "../billing/BillingActions";
import FoncierSousDensiteClient from "./FoncierSousDensiteClient";

export const metadata: Metadata = {
  title: "Sous-densite fonciere — DATAMERRY Pro",
  robots: { index: false, follow: false },
};

const DARK = "#0f172a";
const PRIMARY = "#1f3a8a";
const ACTIVE_STATUSES = ["active", "trialing", "past_due"];

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export default async function AdminFoncierPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Auth check -- identique a billing/page.tsx
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const session = verifySession(sessionCookie);
  if (!session || session.slug !== slug) {
    redirect(`/cabinets/${slug}/admin/login`);
  }

  const sb = getSupabase();
  const { data: subData } = await sb
    .from("v_cabinet_billing_status")
    .select("status")
    .eq("cabinet_slug", slug)
    .maybeSingle();

  const hasActiveSub =
    subData && ACTIVE_STATUSES.includes((subData as { status: string }).status);

  const { data: cabinet } = await sb
    .from("dim_cabinets_white_label")
    .select("cabinet_name, primary_color")
    .eq("slug", slug)
    .maybeSingle();
  const c = cabinet as { cabinet_name: string; primary_color: string | null } | null;
  const brandColor = c?.primary_color ?? PRIMARY;

  return (
    <main style={{ background: "#fafafa", color: DARK, minHeight: "100vh" }}>
      <header style={{ background: DARK, padding: "18px 24px" }}>
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div>
            <div style={{ color: "white", fontWeight: 700, fontSize: 14, letterSpacing: "0.05em" }}>
              {c?.cabinet_name ?? slug.toUpperCase()}
            </div>
            <div style={{ color: brandColor, fontSize: 10, letterSpacing: "0.1em" }}>
              SOUS-DENSITE FONCIERE
            </div>
          </div>
          <nav style={{ display: "flex", gap: 16, fontSize: 13 }}>
            <Link href={`/cabinets/${slug}/admin`} style={{ color: "#cbd5e1" }}>
              ← Dashboard
            </Link>
            <span style={{ color: brandColor, fontWeight: 700 }}>Sous-densite</span>
          </nav>
        </div>
      </header>

      {hasActiveSub ? (
        <FoncierSousDensiteClient slug={slug} />
      ) : (
        <section style={{ padding: "40px 24px" }}>
          <div
            style={{
              maxWidth: 560,
              margin: "0 auto",
              background: "white",
              border: `2px solid ${brandColor}`,
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.15em",
                color: brandColor,
                fontWeight: 700,
                marginBottom: 12,
              }}
            >
              DATAMERRY PRO
            </div>
            <h1 style={{ fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 700, margin: "0 0 12px" }}>
              Detection de sous-densite fonciere
            </h1>
            <p style={{ color: "#475569", marginBottom: 24, fontSize: 14 }}>
              Croisement du vrai plafond de densite PLU/PLUi (CES, hauteur, bande
              constructible), du DPE passoire thermique (copropriete ou maison) et
              du filtre par destination (logement, commerce, sante...) -- reserve
              aux abonnes DATAMERRY Pro.
            </p>
            <BillingActions slug={slug} action="checkout" brandColor={brandColor} />
          </div>
        </section>
      )}
    </main>
  );
}
