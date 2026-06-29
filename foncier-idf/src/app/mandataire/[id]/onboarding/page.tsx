/**
 * Page mandataire : checklist d'onboarding interactive.
 *
 * URL : /mandataire/[id]/onboarding
 *
 * Affiche les 10 étapes du parcours avec :
 *   - progress bar X/10
 *   - card par étape : statut, description, lien ressource, boutons d'action
 *   - upload de documents (RCP, ALUR, CCI) — stocke dans Supabase Storage
 *   - vue ready_for_first_mandate quand toutes les étapes critiques sont OK
 *
 * Auth MVP : pas d'auth, le id UUID en URL fait office de secret.
 * À renforcer en Y2 avec magic link signé.
 */

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { OnboardingChecklist } from "./OnboardingChecklist";

export const metadata: Metadata = {
  title: "Mon onboarding Eurealimmo",
  robots: { index: false, follow: false },
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

async function fetchOnboarding(id: string, baseUrl: string) {
  if (!UUID_RE.test(id)) return null;
  try {
    const res = await fetch(`${baseUrl}/api/mandataire/${id}/onboarding`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function MandataireOnboardingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  // Récupère l'origine via les headers HTTP (fonctionne sur Vercel + local)
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const data = await fetchOnboarding(id, baseUrl);
  if (!data || !data.ok) notFound();

  const { mandataire, checklist, summary } = data as {
    mandataire: {
      id: string;
      first_name: string;
      last_name: string;
      email: string;
      tier: string;
    };
    checklist: Array<{
      id: string;
      step_order: number;
      step_key: string;
      title: string;
      description: string;
      resource_url: string | null;
      estimated_days: number;
      is_required: boolean;
      validation_type: string;
      category: string;
      progress: {
        status: string;
        completed_at?: string | null;
        evidence_url?: string | null;
        notes?: string | null;
        blocker_reason?: string | null;
      };
    }>;
    summary: {
      total_required: number;
      completed_required: number;
      pct_completion: number;
      current_step_key: string | null;
      current_step_title: string | null;
    };
  };

  return (
    <main style={{ background: "#fafafa", color: DARK, minHeight: "100vh" }}>
      {/* ─── Header ────────────────────────────────────────────────────── */}
      <header
        style={{
          background: DARK,
          padding: "20px 24px",
          borderBottom: `1px solid ${PRIMARY}40`,
        }}
      >
        <div
          style={{
            maxWidth: 920,
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
                width: 40,
                height: 40,
                background: PRIMARY,
                color: DARK,
                fontWeight: 800,
                fontSize: 22,
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
              <div style={{ color: "white", fontSize: 14, fontWeight: 700, letterSpacing: "0.05em" }}>
                EUREALIMMO
              </div>
              <div style={{ color: PRIMARY, fontSize: 10, letterSpacing: "0.1em", fontWeight: 600 }}>
                ONBOARDING MANDATAIRE
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
                  : "⏳ EN ATTENTE D'ACTIVATION"}
            </div>
          </div>
        </div>
      </header>

      {/* ─── Hero progress ─────────────────────────────────────────────── */}
      <section style={{ padding: "40px 24px 30px", background: "white" }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <h1
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 32,
              fontWeight: 700,
              margin: "0 0 8px",
              color: DARK,
            }}
          >
            Bienvenue {mandataire.first_name} 👋
          </h1>
          <p style={{ color: "#64748b", fontSize: 15, marginBottom: 28 }}>
            Voici votre checklist pour finaliser votre rattachement à Eurealimmo Réseau.
            Vous pouvez avancer à votre rythme — nous vous accompagnons à chaque étape.
          </p>

          {/* Progress bar */}
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>
                Progression
              </span>
              <span
                style={{
                  fontFamily: "Georgia, serif",
                  fontSize: 24,
                  fontWeight: 700,
                  color: DARK,
                }}
              >
                {summary.completed_required}/{summary.total_required}{" "}
                <span style={{ fontSize: 14, color: "#94a3b8" }}>
                  ({summary.pct_completion}%)
                </span>
              </span>
            </div>
            <div
              style={{
                background: "#e2e8f0",
                height: 12,
                borderRadius: 6,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: PRIMARY,
                  height: "100%",
                  width: `${summary.pct_completion}%`,
                  transition: "width 0.4s ease",
                  borderRadius: 6,
                }}
              />
            </div>
          </div>

          {summary.current_step_key && (
            <div
              style={{
                marginTop: 20,
                padding: 16,
                background: "#fef3c7",
                borderLeft: `3px solid ${PRIMARY}`,
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "#78350f",
                  fontWeight: 700,
                  letterSpacing: "0.1em",
                  marginBottom: 4,
                }}
              >
                ⭐ ÉTAPE EN COURS
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#78350f" }}>
                {summary.current_step_title}
              </div>
            </div>
          )}

          {summary.pct_completion === 100 && (
            <div
              style={{
                marginTop: 20,
                padding: 20,
                background: "#d1fae5",
                borderLeft: `3px solid #059669`,
                borderRadius: 4,
                color: "#065f46",
              }}
            >
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                🎉 Bravo, votre onboarding est complet !
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>
                Vous êtes prêt(e) à signer votre premier mandat. Samuel vous contactera
                sous 24h pour vous transmettre les premiers leads.
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ─── Checklist (composant client interactif) ───────────────────── */}
      <section style={{ padding: "20px 24px 60px" }}>
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <OnboardingChecklist mandataireId={mandataire.id} initialChecklist={checklist} />
        </div>
      </section>

      {/* ─── Footer ────────────────────────────────────────────────────── */}
      <footer
        style={{
          padding: "30px 24px",
          background: "#020617",
          color: "#94a3b8",
          fontSize: 12,
          textAlign: "center",
          lineHeight: 1.7,
        }}
      >
        <div style={{ maxWidth: 920, margin: "0 auto" }}>
          <p style={{ margin: "0 0 8px" }}>
            Question urgente ? Email{" "}
            <a href="mailto:contact@eurealimmo.com" style={{ color: PRIMARY }}>
              contact@eurealimmo.com
            </a>{" "}
            — réponse sous 24h.
          </p>
          <p style={{ margin: 0, color: "#475569", fontSize: 11 }}>
            EUREALIMMO SARL · SIREN 984 449 470 · Carte T CPI 7501 2024 000 000 219 · Sans maniement de fonds
          </p>
        </div>
      </footer>
    </main>
  );
}
