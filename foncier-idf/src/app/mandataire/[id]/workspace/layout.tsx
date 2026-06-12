/**
 * Layout workspace mandataire : header + nav latérale + contenu.
 *
 * URL : /mandataire/[id]/workspace/...
 *
 * Toutes les pages enfants (dashboard, leads, commissions, registre)
 * partagent ce layout. Auth via UUID en URL (même pattern que /onboarding).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

export const metadata: Metadata = {
  title: "Espace mandataire — Eurealimmo",
  robots: { index: false, follow: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

type Mandataire = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  tier: string;
  contract_signed_at: string | null;
};

async function fetchMandataire(id: string): Promise<Mandataire | null> {
  if (!UUID_RE.test(id)) return null;
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await sb
    .from("eurealimmo_mandataires")
    .select("id, first_name, last_name, email, commission_eurealimmo_pct, contract_signed_at")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;

  const pct = (data as { commission_eurealimmo_pct: number | null }).commission_eurealimmo_pct;
  const tier =
    pct === 5 ? "founder" : pct === 8 ? "standard" : pct === null ? "pending" : "custom";

  return {
    id: data.id,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    tier,
    contract_signed_at: data.contract_signed_at,
  };
}

const NAV_ITEMS = [
  { key: "dashboard", label: "Tableau de bord", icon: "▣", href: "" },
  { key: "leads", label: "Mes leads", icon: "◉", href: "/leads" },
  { key: "commissions", label: "Commissions", icon: "€", href: "/commissions" },
  { key: "registre", label: "Registre des mandats", icon: "☰", href: "/registre" },
  { key: "parrainage", label: "Parrainage", icon: "♻", href: "/parrainage" },
  { key: "onboarding", label: "Mon onboarding", icon: "✓", href: "/onboarding", external: true },
];

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const mandataire = await fetchMandataire(id);
  if (!mandataire) notFound();

  return (
    <div style={{ background: "#fafafa", color: DARK, minHeight: "100vh" }}>
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <header
        style={{
          background: DARK,
          padding: "16px 24px",
          borderBottom: `1px solid ${PRIMARY}40`,
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div
          style={{
            maxWidth: 1280,
            margin: "0 auto",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
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
                fontSize: 20,
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
                EUREALIMMO
              </div>
              <div style={{ color: PRIMARY, fontSize: 10, letterSpacing: "0.1em", fontWeight: 600 }}>
                ESPACE MANDATAIRE
              </div>
            </div>
          </div>
          <div style={{ textAlign: "right", color: "white", fontSize: 13 }}>
            <div style={{ fontWeight: 700 }}>
              {mandataire.first_name} {mandataire.last_name}
            </div>
            <div style={{ color: PRIMARY, fontSize: 11, letterSpacing: "0.05em" }}>
              {mandataire.tier === "founder"
                ? "👑 FONDATEUR"
                : mandataire.tier === "standard"
                  ? "💎 STANDARD"
                  : "⏳ EN ATTENTE"}
            </div>
          </div>
        </div>
      </header>

      {/* ─── Bannière contrat non signé ────────────────────────────────── */}
      {!mandataire.contract_signed_at && (
        <div
          style={{
            background: "#fef3c7",
            borderBottom: "1px solid #f59e0b",
            padding: "12px 24px",
            fontSize: 13,
            color: "#78350f",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          <strong>Prévisualisation</strong> — Votre contrat de mandataire commercial Eurealimmo
          n'est pas encore signé. Cet espace vous est ouvert en démonstration. L'activation
          opérationnelle (attribution de leads, signature de mandats Hoguet) interviendra
          dès signature du contrat et inscription au RSAC.
        </div>
      )}

      {/* ─── Layout principal : nav latérale + contenu ─────────────────── */}
      <div
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          gap: 24,
          padding: "24px",
        }}
      >
        {/* Nav latérale */}
        <aside>
          <nav
            style={{
              background: "white",
              borderRadius: 6,
              padding: 12,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              position: "sticky",
              top: 90,
            }}
          >
            {NAV_ITEMS.map((item) => {
              const href = item.external
                ? `/mandataire/${id}${item.href}`
                : `/mandataire/${id}/workspace${item.href}`;
              return (
                <Link
                  key={item.key}
                  href={href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    color: DARK,
                    textDecoration: "none",
                    fontSize: 14,
                    fontWeight: 500,
                    borderRadius: 4,
                    transition: "background 0.15s",
                  }}
                >
                  <span style={{ color: PRIMARY, fontSize: 16, width: 20 }}>{item.icon}</span>
                  <span>{item.label}</span>
                  {item.external && (
                    <span style={{ marginLeft: "auto", fontSize: 10, color: "#94a3b8" }}>↗</span>
                  )}
                </Link>
              );
            })}

            <div
              style={{
                marginTop: 16,
                paddingTop: 16,
                borderTop: "1px solid #e2e8f0",
                fontSize: 11,
                color: "#94a3b8",
                lineHeight: 1.6,
                padding: 12,
              }}
            >
              Support :{" "}
              <a href="mailto:contact@datamerry.com" style={{ color: PRIMARY }}>
                contact@datamerry.com
              </a>
            </div>
          </nav>
        </aside>

        {/* Contenu */}
        <main>{children}</main>
      </div>

      {/* ─── Footer ────────────────────────────────────────────────────── */}
      <footer
        style={{
          padding: "20px 24px",
          background: "#020617",
          color: "#475569",
          fontSize: 11,
          textAlign: "center",
        }}
      >
        EUREALIMMO SARL · SIREN 984 449 470 · Carte T CPI 7501 2024 000 219 · Sans maniement de fonds
      </footer>
    </div>
  );
}
