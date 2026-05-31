/**
 * Dashboard admin Samuel : vue d'ensemble de l'onboarding des mandataires.
 *
 * URL : /cabinets/eurealimmo/admin/onboarding
 *
 * Auth : cookie session admin (pattern admin-auth.ts, slug='eurealimmo').
 *
 * Fonctionnalités :
 *   - Stats globales (total, avg completion, ready, stagnant, blocked)
 *   - Filtres (tous / stagnants / bloqués / prêts)
 *   - Table mandataires avec % completion, jours d'inactivité, dernière étape
 *   - Bouton "Relancer" → trigger email Resend
 *   - Lien "Voir détail" → page mandataire en mode admin
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, ADMIN_SESSION_COOKIE } from "@/lib/admin-auth";
import { AdminOnboardingTable } from "./AdminOnboardingTable";

export const metadata: Metadata = {
  title: "Onboarding mandataires — Admin Eurealimmo",
  robots: { index: false, follow: false },
};

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

async function fetchOnboardingData(baseUrl: string, cookieHeader: string, filter?: string) {
  try {
    const url = filter
      ? `${baseUrl}/api/cabinets/eurealimmo/admin/onboarding?filter=${filter}`
      : `${baseUrl}/api/cabinets/eurealimmo/admin/onboarding`;
    const res = await fetch(url, {
      cache: "no-store",
      headers: { cookie: cookieHeader },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function AdminOnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  // Auth check
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const session = verifySession(sessionCookie);
  if (!session || session.slug !== "eurealimmo") {
    redirect("/cabinets/eurealimmo/admin/login");
  }

  const { filter } = await searchParams;

  // Construit l'URL de base + header cookie pour fetch interne SSR
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL?.startsWith("http")
      ? process.env.VERCEL_URL
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

  const cookieHeader = `${ADMIN_SESSION_COOKIE}=${sessionCookie}`;
  const data = await fetchOnboardingData(baseUrl, cookieHeader, filter);

  if (!data || !data.ok) {
    return (
      <main style={{ padding: 40, fontFamily: "Arial, sans-serif", color: DARK }}>
        <h1>Erreur de chargement</h1>
        <p>Impossible de récupérer les données. Vérifie que la migration SQL 41 est lancée.</p>
        <p>
          <Link href="/cabinets/eurealimmo/admin">← Retour au dashboard</Link>
        </p>
      </main>
    );
  }

  const { mandataires, stats } = data as {
    mandataires: Array<{
      mandataire_id: string;
      first_name: string;
      last_name: string;
      email: string;
      phone: string | null;
      tier: string;
      pct_completion: number | null;
      completed_required_steps: number | null;
      total_required_steps: number | null;
      in_progress_steps: number | null;
      blocked_steps: number | null;
      days_since_last_activity: number | null;
      last_activity_at: string | null;
      ready_for_first_mandate: boolean | null;
    }>;
    stats: {
      total: number;
      avg_completion: number;
      ready_count: number;
      stagnant_count: number;
      blocked_count: number;
    };
  };

  return (
    <main style={{ background: "#fafafa", color: DARK, minHeight: "100vh" }}>
      {/* Header */}
      <header
        style={{
          background: DARK,
          padding: "18px 24px",
          borderBottom: `1px solid ${PRIMARY}40`,
        }}
      >
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
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                background: PRIMARY,
                color: DARK,
                fontWeight: 800,
                fontSize: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                fontFamily: "Georgia, serif",
              }}
            >
              E
            </div>
            <div>
              <div style={{ color: "white", fontSize: 13, fontWeight: 700, letterSpacing: "0.05em" }}>
                EUREALIMMO ADMIN
              </div>
              <div style={{ color: PRIMARY, fontSize: 10, letterSpacing: "0.1em" }}>
                ONBOARDING MANDATAIRES
              </div>
            </div>
          </div>
          <nav style={{ display: "flex", gap: 16, fontSize: 13 }}>
            <Link href="/cabinets/eurealimmo/admin" style={{ color: "#cbd5e1" }}>
              ← Dashboard
            </Link>
            <span style={{ color: PRIMARY, fontWeight: 700 }}>Onboarding</span>
            <Link href="/cabinets/eurealimmo/admin/registre" style={{ color: "#cbd5e1" }}>
              Registre mandats
            </Link>
          </nav>
        </div>
      </header>

      {/* Stats cards */}
      <section style={{ padding: "30px 24px", background: "white" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h1
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 28,
              fontWeight: 700,
              margin: "0 0 20px",
            }}
          >
            Suivi onboarding mandataires
          </h1>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: 12,
              marginBottom: 24,
            }}
          >
            <StatCard label="Mandataires total" value={stats.total} />
            <StatCard
              label="% complétion moyen"
              value={`${stats.avg_completion}%`}
              accent={PRIMARY}
            />
            <StatCard
              label="Prêts 1er mandat"
              value={stats.ready_count}
              accent="#059669"
            />
            <StatCard
              label="Stagnent +7j"
              value={stats.stagnant_count}
              accent="#d97706"
            />
            <StatCard
              label="Bloqués"
              value={stats.blocked_count}
              accent="#dc2626"
            />
          </div>

          {/* Filtres */}
          <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
            <FilterBtn href="/cabinets/eurealimmo/admin/onboarding" active={!filter}>
              Tous ({stats.total})
            </FilterBtn>
            <FilterBtn
              href="/cabinets/eurealimmo/admin/onboarding?filter=ready"
              active={filter === "ready"}
            >
              ✓ Prêts ({stats.ready_count})
            </FilterBtn>
            <FilterBtn
              href="/cabinets/eurealimmo/admin/onboarding?filter=stagnant"
              active={filter === "stagnant"}
            >
              ⚠️ Stagnent +7j ({stats.stagnant_count})
            </FilterBtn>
            <FilterBtn
              href="/cabinets/eurealimmo/admin/onboarding?filter=blocked"
              active={filter === "blocked"}
            >
              🚫 Bloqués ({stats.blocked_count})
            </FilterBtn>
          </div>

          {/* Table mandataires (composant client interactif) */}
          <AdminOnboardingTable mandataires={mandataires} />
        </div>
      </section>
    </main>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: "#fafafa",
        border: "1px solid #e2e8f0",
        borderRadius: 6,
        borderTop: accent ? `3px solid ${accent}` : "1px solid #e2e8f0",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "#94a3b8",
          fontWeight: 700,
          letterSpacing: "0.1em",
          marginBottom: 6,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div
        style={{
          fontFamily: "Georgia, serif",
          fontSize: 28,
          fontWeight: 700,
          color: accent ?? DARK,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function FilterBtn({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-block",
        padding: "8px 14px",
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 700,
        textDecoration: "none",
        background: active ? PRIMARY : "white",
        color: active ? DARK : "#475569",
        border: active ? `1px solid ${PRIMARY}` : "1px solid #e2e8f0",
        letterSpacing: "0.02em",
      }}
    >
      {children}
    </Link>
  );
}
