/**
 * Page parrainage côté admin cabinet (ex: Collabimo).
 *
 * URL : /cabinets/[slug]/admin/parrainage
 *
 * Affiche les codes referral du responsable de traitement (par email de la
 * session admin). Réutilise le composant ReferralLinksCard du workspace.
 *
 * Branding : header Collabimo distinct (vert/blanc) si slug = "collabimo",
 * sinon header neutre.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { verifySession, ADMIN_SESSION_COOKIE } from "@/lib/admin-auth";
import { ReferralLinksCard } from "@/app/mandataire/[id]/workspace/parrainage/ReferralLinksCard";

export const metadata: Metadata = {
  title: "Parrainage — Espace propriétaire",
  robots: { index: false, follow: false },
};

const BASE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://app.eurealimmo.com";

// Charte Collabimo (différenciée d'Eurealimmo doré/noir)
const COLLABIMO_GREEN = "#0f7a4d";
const COLLABIMO_DARK = "#053824";
const NEUTRAL_DARK = "#0f172a";

function getBrand(slug: string) {
  if (slug === "collabimo") {
    return {
      primary: COLLABIMO_GREEN,
      dark: COLLABIMO_DARK,
      name: "COLLABIMO",
      label: "Espace responsable de traitement",
      logo: "C",
    };
  }
  return {
    primary: "#c8a25d",
    dark: NEUTRAL_DARK,
    name: slug.toUpperCase(),
    label: "Espace administrateur",
    logo: slug[0]?.toUpperCase() ?? "?",
  };
}

async function fetchReferralCodesByEmail(email: string) {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: codes, error } = await sb
    .from("v_referral_codes_by_owner")
    .select("*")
    .ilike("owner_email", email);

  if (error) return null;

  const enriched = (codes ?? []).map((c) => ({
    ...c,
    full_url: `${BASE_URL}/onboarding?ref=${c.code}`,
    qr_code_url: `https://quickchart.io/qr?text=${encodeURIComponent(
      `${BASE_URL}/onboarding?ref=${c.code}`,
    )}&size=200&margin=1`,
  }));

  return {
    founder_codes: enriched.filter((c) => c.tier === "founder"),
    standard_codes: enriched.filter((c) => c.tier === "standard"),
    network: {
      founder_count: enriched[0]?.network_founder_count ?? 0,
      founder_cap: enriched[0]?.network_founder_cap ?? 60,
      founder_remaining: Math.max(
        0,
        (enriched[0]?.network_founder_cap ?? 60) -
          (enriched[0]?.network_founder_count ?? 0),
      ),
    },
  };
}

export default async function AdminParrainagePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const brand = getBrand(slug);

  // Auth admin
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const session = verifySession(sessionCookie);
  if (!session || session.slug !== slug) {
    redirect(`/cabinets/${slug}/admin/login`);
  }

  // Récupère les codes referral du owner par email
  const data = await fetchReferralCodesByEmail(session.email);
  if (!data) notFound();

  return (
    <main style={{ background: "#fafafa", color: brand.dark, minHeight: "100vh" }}>
      {/* ─── Header brandé ────────────────────────────────────────────── */}
      <header
        style={{
          background: brand.dark,
          padding: "16px 24px",
          borderBottom: `1px solid ${brand.primary}40`,
        }}
      >
        <div
          style={{
            maxWidth: 920,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                background: brand.primary,
                color: "white",
                fontWeight: 800,
                fontSize: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                fontFamily: "Georgia, serif",
              }}
            >
              {brand.logo}
            </div>
            <div>
              <div
                style={{
                  color: "white",
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                }}
              >
                {brand.name}
              </div>
              <div
                style={{
                  color: brand.primary,
                  fontSize: 10,
                  letterSpacing: "0.1em",
                  fontWeight: 600,
                }}
              >
                {brand.label.toUpperCase()}
              </div>
            </div>
          </div>
          <nav style={{ display: "flex", gap: 14, fontSize: 12 }}>
            <Link href={`/cabinets/${slug}/admin`} style={{ color: "#cbd5e1", textDecoration: "none" }}>
              ← Dashboard
            </Link>
            <span style={{ color: brand.primary, fontWeight: 700 }}>Parrainage</span>
          </nav>
        </div>
      </header>

      <section style={{ padding: "30px 24px" }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          {/* Bandeau RGPD : matérialise la propriété */}
          {slug === "collabimo" && (
            <div
              style={{
                background: "white",
                borderLeft: `4px solid ${brand.primary}`,
                padding: "14px 18px",
                borderRadius: 4,
                marginBottom: 24,
                fontSize: 13,
                color: "#475569",
                lineHeight: 1.6,
              }}
            >
              <strong style={{ color: brand.dark }}>Vous êtes responsable de traitement RGPD (art. 4.7)</strong> —
              les Prospects Pré-Mandat capturés via collabimo.com vous appartiennent.
              DATAMERRY = sous-traitant (art. 28). Eurealimmo = mandataire commercial via votre carte T déléguée.
            </div>
          )}

          <div style={{ marginBottom: 24 }}>
            <h1
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 28,
                fontWeight: 700,
                margin: "0 0 4px",
              }}
            >
              Vos liens de parrainage
            </h1>
            <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
              Recrutez des fondateurs ou des mandataires standard et touchez à vie 20 % (HNWI) ou
              15 % (standard) sur leurs commissions.
            </p>
          </div>

          <ReferralLinksCard
            founderCodes={data.founder_codes}
            standardCodes={data.standard_codes}
            network={data.network}
          />
        </div>
      </section>
    </main>
  );
}
