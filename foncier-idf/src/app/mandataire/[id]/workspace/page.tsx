/**
 * Dashboard mandataire — page d'accueil du workspace.
 *
 * URL : /mandataire/[id]/workspace
 *
 * Affiche :
 *  - 4 KPIs (leads actifs, mandats signés, ventes, CA estimé)
 *  - palier prime cession + barre de progression vers palier suivant
 *  - 5 leads récents
 *  - 5 commissions récentes
 */

import { headers } from "next/headers";
import Link from "next/link";

function ErrorBanner({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      style={{
        background: "#fef2f2",
        border: "1px solid #fecaca",
        borderRadius: 6,
        padding: 20,
        color: "#7f1d1d",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>⚠️ {title}</div>
      <div style={{ fontSize: 13, fontFamily: "monospace" }}>{detail}</div>
    </div>
  );
}

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

const fmtEUR = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "Nouveau", color: "#3b82f6" },
  contacted: { label: "Contacté", color: "#8b5cf6" },
  rdv_planifie: { label: "RDV planifié", color: "#f59e0b" },
  visite_planifiee: { label: "Visite planifiée", color: "#f59e0b" },
  mandat_signe: { label: "Mandat signé", color: "#10b981" },
  vendu: { label: "Vendu", color: "#059669" },
  perdu: { label: "Perdu", color: "#6b7280" },
};

async function fetchStats(id: string, baseUrl: string) {
  try {
    const res = await fetch(`${baseUrl}/api/mandataire/${id}/workspace/stats`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function WorkspaceDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const data = await fetchStats(id, baseUrl);
  if (!data || !data.ok) {
    return (
      <ErrorBanner
        title="Impossible de charger le tableau de bord"
        detail={data?.error ?? "API stats injoignable. Vérifie que la migration SQL 50 est appliquée."}
      />
    );
  }

  const { stats, palier, recentLeads, recentCommissions } = data;

  return (
    <div>
      {/* ─── Titre + CTA ──────────────────────────────────────────────── */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          marginBottom: 24,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 28,
              fontWeight: 700,
              margin: "0 0 4px",
            }}
          >
            Tableau de bord
          </h1>
          <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
            Vue d'ensemble de votre activité Eurealimmo
          </p>
        </div>
        <Link
          href={`/mandataire/${id}/workspace/mandats/nouveau`}
          style={{
            background: "#064e3b",
            color: "white",
            padding: "10px 18px",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            textDecoration: "none",
            whiteSpace: "nowrap",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          📝 Créer un mandat
        </Link>
      </div>

      {/* ─── 4 KPIs ────────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <KpiCard label="Leads actifs" value={stats.leads_actifs} accent={PRIMARY} icon="◉" />
        <KpiCard label="Mandats signés" value={stats.leads_mandat_signe} accent="#3b82f6" icon="✎" />
        <KpiCard label="Ventes signées" value={stats.leads_vendus} accent="#10b981" icon="✓" />
        <KpiCard
          label="Rétro estimée"
          value={fmtEUR(stats.retrocession_estimee_total)}
          accent="#c8a25d"
          icon="€"
          small
        />
      </div>

      {/* ─── Palier prime cession ──────────────────────────────────────── */}
      <section
        style={{
          background: "white",
          borderRadius: 6,
          padding: 20,
          marginBottom: 24,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 8,
          }}
        >
          <div>
            <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.1em", fontWeight: 700 }}>
              PRIME DE CESSION
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "Georgia, serif", marginTop: 4 }}>
              {palier.label}
            </div>
          </div>
          <div style={{ fontSize: 32, fontWeight: 800, color: PRIMARY, fontFamily: "Georgia, serif" }}>
            {palier.pct}%
          </div>
        </div>

        <div style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
          {stats.nb_filleuls_actifs} filleul(s) actif(s) parrainé(s) — cession future plafonnée à{" "}
          <strong>{palier.pct}% × valeur portefeuille</strong>
        </div>

        {palier.next && (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "#64748b",
                marginBottom: 6,
              }}
            >
              <span>
                Prochain palier : <strong>{palier.next.pct}%</strong> à {palier.next.at} filleuls
              </span>
              <span>
                {stats.nb_filleuls_actifs}/{palier.next.at}
              </span>
            </div>
            <div style={{ background: "#e2e8f0", height: 8, borderRadius: 4, overflow: "hidden" }}>
              <div
                style={{
                  background: PRIMARY,
                  height: "100%",
                  width: `${Math.min(100, (stats.nb_filleuls_actifs / palier.next.at) * 100)}%`,
                  transition: "width 0.4s ease",
                  borderRadius: 4,
                }}
              />
            </div>
          </>
        )}
      </section>

      {/* ─── Leads récents + commissions récentes ──────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Leads récents */}
        <section
          style={{
            background: "white",
            borderRadius: 6,
            padding: 20,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 16,
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, fontFamily: "Georgia, serif" }}>
              Leads récents
            </h2>
            <Link
              href={`/mandataire/${id}/workspace/leads`}
              style={{ fontSize: 12, color: PRIMARY, textDecoration: "none", fontWeight: 600 }}
            >
              Tout voir →
            </Link>
          </div>

          {recentLeads.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: 24 }}>
              Aucun lead pour l'instant.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {recentLeads.map((lead: { id: string; visitor_name: string | null; address: string | null; status: string; created_at: string }) => {
                const status = STATUS_LABELS[lead.status] ?? { label: lead.status, color: "#6b7280" };
                return (
                  <div
                    key={lead.id}
                    style={{
                      padding: 10,
                      borderLeft: `3px solid ${status.color}`,
                      background: "#fafafa",
                      borderRadius: 3,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>
                      {lead.visitor_name ?? "Visiteur anonyme"}
                    </div>
                    <div style={{ color: "#64748b", fontSize: 12 }}>{lead.address ?? "—"}</div>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        marginTop: 4,
                        fontSize: 11,
                      }}
                    >
                      <span style={{ color: status.color, fontWeight: 600 }}>{status.label}</span>
                      <span style={{ color: "#94a3b8" }}>{fmtDate(lead.created_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Commissions récentes */}
        <section
          style={{
            background: "white",
            borderRadius: 6,
            padding: 20,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: 16,
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 700, margin: 0, fontFamily: "Georgia, serif" }}>
              Commissions récentes
            </h2>
            <Link
              href={`/mandataire/${id}/workspace/commissions`}
              style={{ fontSize: 12, color: PRIMARY, textDecoration: "none", fontWeight: 600 }}
            >
              Tout voir →
            </Link>
          </div>

          {recentCommissions.length === 0 ? (
            <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: 24 }}>
              Aucune commission pour l'instant.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {recentCommissions.map((c: { lead_id: string; client_nom: string | null; bien_adresse: string | null; retrocession_mandataire: number; statut_commission: string; vente_date: string | null }) => (
                <div
                  key={c.lead_id}
                  style={{
                    padding: 10,
                    background: c.statut_commission === "a_venir" ? "#fef3c7" : "#d1fae5",
                    borderRadius: 3,
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{c.client_nom ?? "—"}</div>
                  <div style={{ color: "#64748b", fontSize: 12, marginBottom: 4 }}>
                    {c.bien_adresse ?? "—"}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 12,
                    }}
                  >
                    <span style={{ fontWeight: 700, color: DARK }}>{fmtEUR(c.retrocession_mandataire)}</span>
                    <span style={{ color: "#64748b" }}>
                      {c.statut_commission === "a_venir" ? "À venir" : fmtDate(c.vente_date)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  accent,
  icon,
  small,
}: {
  label: string;
  value: number | string;
  accent: string;
  icon: string;
  small?: boolean;
}) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 6,
        padding: 16,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        borderTop: `3px solid ${accent}`,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 11, color: "#94a3b8", letterSpacing: "0.1em", fontWeight: 700 }}>
          {label.toUpperCase()}
        </div>
        <div style={{ color: accent, fontSize: 18 }}>{icon}</div>
      </div>
      <div
        style={{
          fontSize: small ? 22 : 30,
          fontWeight: 800,
          color: DARK,
          fontFamily: "Georgia, serif",
        }}
      >
        {value}
      </div>
    </div>
  );
}
