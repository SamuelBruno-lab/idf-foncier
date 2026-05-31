/**
 * Dashboard admin : liste des candidatures mandataires reçues.
 *
 * URL : /cabinets/eurealimmo/admin/candidatures
 *
 * Auth : cookie session admin.
 *
 * Affiche les candidatures avec :
 *   - statut (new / reviewing / call_scheduled / etc.)
 *   - identité + contact (email, tél clickable)
 *   - profil (statut actuel, réseau, expérience, spécialité)
 *   - motivation
 *   - bouton "Marquer en cours / appel programmé / accepté / rejeté"
 *   - bouton "Créer mandataire" pour les acceptés (Y2)
 *
 * Utile car indépendant de Resend (si emails ne partent pas, on voit ici).
 */

import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySession, ADMIN_SESSION_COOKIE } from "@/lib/admin-auth";
import { ApplicationsTable } from "./ApplicationsTable";

export const metadata: Metadata = {
  title: "Candidatures — Admin Eurealimmo",
  robots: { index: false, follow: false },
};

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

type Application = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  current_status: string;
  current_network: string | null;
  years_experience: string;
  has_carte_t: string;
  specialty: string;
  motivation: string;
  status: string;
  source: string | null;
  referred_by_email: string | null;
  consent_given: boolean;
  created_at: string;
  reviewed_at: string | null;
  reviewer_notes: string | null;
};

async function fetchApplications(baseUrl: string, cookieHeader: string, status?: string) {
  try {
    const url = status
      ? `${baseUrl}/api/cabinets/eurealimmo/admin/applications?status=${status}`
      : `${baseUrl}/api/cabinets/eurealimmo/admin/applications`;
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

export default async function CandidaturesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(ADMIN_SESSION_COOKIE)?.value;
  const session = verifySession(sessionCookie);
  if (!session || session.slug !== "eurealimmo") {
    redirect("/cabinets/eurealimmo/admin/login");
  }

  const { status } = await searchParams;

  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL?.startsWith("http")
      ? process.env.VERCEL_URL
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000");

  const cookieHeader = `${ADMIN_SESSION_COOKIE}=${sessionCookie}`;
  const data = await fetchApplications(baseUrl, cookieHeader, status);

  if (!data || !data.ok) {
    return (
      <main style={{ padding: 40, fontFamily: "Arial, sans-serif", color: DARK }}>
        <h1>Erreur de chargement</h1>
        <p>Vérifie que SQL 39 (eurealimmo_applications) est bien lancé.</p>
        <p>
          <Link href="/cabinets/eurealimmo/admin">← Retour au dashboard</Link>
        </p>
      </main>
    );
  }

  const { applications, stats } = data as {
    applications: Application[];
    stats: Record<string, number>;
  };

  return (
    <main style={{ background: "#fafafa", color: DARK, minHeight: "100vh" }}>
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
          <div>
            <div style={{ color: "white", fontSize: 13, fontWeight: 700, letterSpacing: "0.05em" }}>
              EUREALIMMO ADMIN
            </div>
            <div style={{ color: PRIMARY, fontSize: 10, letterSpacing: "0.1em" }}>
              CANDIDATURES MANDATAIRES
            </div>
          </div>
          <nav style={{ display: "flex", gap: 16, fontSize: 13 }}>
            <Link href="/cabinets/eurealimmo/admin" style={{ color: "#cbd5e1" }}>
              ← Dashboard
            </Link>
            <span style={{ color: PRIMARY, fontWeight: 700 }}>Candidatures</span>
            <Link href="/cabinets/eurealimmo/admin/onboarding" style={{ color: "#cbd5e1" }}>
              Onboarding
            </Link>
            <Link href="/cabinets/eurealimmo/admin/registre" style={{ color: "#cbd5e1" }}>
              Registre
            </Link>
          </nav>
        </div>
      </header>

      <section style={{ padding: "30px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <h1
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 28,
              fontWeight: 700,
              margin: "0 0 20px",
            }}
          >
            Candidatures reçues ({stats.total ?? 0})
          </h1>

          {/* Stats par status */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 12,
              marginBottom: 24,
            }}
          >
            <StatCard label="Nouvelles" value={stats.new ?? 0} accent={PRIMARY} />
            <StatCard label="En cours" value={stats.reviewing ?? 0} accent="#1e40af" />
            <StatCard label="Call planifié" value={stats.call_scheduled ?? 0} accent="#7c3aed" />
            <StatCard label="Acceptées" value={stats.accepted ?? 0} accent="#059669" />
            <StatCard label="Rejetées" value={stats.rejected ?? 0} accent="#dc2626" />
          </div>

          {/* Filtres */}
          <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap" }}>
            <FilterBtn href="/cabinets/eurealimmo/admin/candidatures" active={!status}>
              Tous ({stats.total ?? 0})
            </FilterBtn>
            <FilterBtn
              href="/cabinets/eurealimmo/admin/candidatures?status=new"
              active={status === "new"}
            >
              🆕 Nouvelles ({stats.new ?? 0})
            </FilterBtn>
            <FilterBtn
              href="/cabinets/eurealimmo/admin/candidatures?status=reviewing"
              active={status === "reviewing"}
            >
              👀 En cours ({stats.reviewing ?? 0})
            </FilterBtn>
            <FilterBtn
              href="/cabinets/eurealimmo/admin/candidatures?status=call_scheduled"
              active={status === "call_scheduled"}
            >
              📞 Call planifié ({stats.call_scheduled ?? 0})
            </FilterBtn>
            <FilterBtn
              href="/cabinets/eurealimmo/admin/candidatures?status=accepted"
              active={status === "accepted"}
            >
              ✓ Acceptées ({stats.accepted ?? 0})
            </FilterBtn>
            <FilterBtn
              href="/cabinets/eurealimmo/admin/candidatures?status=rejected"
              active={status === "rejected"}
            >
              ✗ Rejetées ({stats.rejected ?? 0})
            </FilterBtn>
          </div>

          <ApplicationsTable applications={applications} />
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
  value: number;
  accent: string;
}) {
  return (
    <div
      style={{
        padding: 14,
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 6,
        borderTop: `3px solid ${accent}`,
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
          fontSize: 26,
          fontWeight: 700,
          color: accent,
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
