/**
 * Page commissions mandataire — totaux + détail par vente.
 *
 * URL : /mandataire/[id]/workspace/commissions
 *
 * Calcul : rétrocession 95 % de la commission Eurealimmo brute.
 * Versement : 7 j ouvrés SEPA après encaissement signature notaire.
 */

import { headers } from "next/headers";
import { notFound } from "next/navigation";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

const fmtEUR = (n: number) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

type Commission = {
  lead_id: string;
  client_nom: string | null;
  bien_adresse: string | null;
  mandat_type: string | null;
  mandat_signe_at: string | null;
  vente_date: string | null;
  vente_compromis_date: string | null;
  vente_prix_final: number | null;
  mandat_commission_pct: number | null;
  commission_eurealimmo_brute: number | null;
  retrocession_mandataire: number | null;
  statut_commission: string;
};

async function fetchCommissions(id: string, baseUrl: string) {
  try {
    const res = await fetch(`${baseUrl}/api/mandataire/${id}/workspace/commissions`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export default async function WorkspaceCommissionsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const data = await fetchCommissions(id, baseUrl);
  if (!data || !data.ok) notFound();

  const { commissions, totals }: { commissions: Commission[]; totals: { a_venir: number; encaisse: number } } = data;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}
        >
          Commissions
        </h1>
        <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
          Rétrocession 95 % de la commission Eurealimmo brute · Versement SEPA 7 j ouvrés après
          encaissement notaire
        </p>
      </div>

      {/* ─── 2 totaux ──────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <TotalCard
          label="À venir (mandats signés, ventes pas encore notariées)"
          value={fmtEUR(totals.a_venir)}
          accent="#f59e0b"
        />
        <TotalCard
          label="Encaissé (ventes notariées, en attente versement)"
          value={fmtEUR(totals.encaisse)}
          accent="#10b981"
        />
      </div>

      {/* ─── Tableau détaillé ──────────────────────────────────────────── */}
      <section
        style={{
          background: "white",
          borderRadius: 6,
          padding: 20,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        <h2
          style={{ fontSize: 16, fontWeight: 700, margin: "0 0 16px", fontFamily: "Georgia, serif" }}
        >
          Détail des commissions
        </h2>

        {commissions.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: 24 }}>
            Aucune commission pour l'instant. Les mandats signés apparaîtront ici.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                  <th style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600 }}>Client</th>
                  <th style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600 }}>Bien</th>
                  <th style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600 }}>Type</th>
                  <th style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600 }}>Signé le</th>
                  <th style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600 }}>Vendu le</th>
                  <th
                    style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600, textAlign: "right" }}
                  >
                    Prix vente
                  </th>
                  <th
                    style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600, textAlign: "right" }}
                  >
                    Commission %
                  </th>
                  <th
                    style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600, textAlign: "right" }}
                  >
                    Brute
                  </th>
                  <th
                    style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600, textAlign: "right" }}
                  >
                    Rétro (95 %)
                  </th>
                  <th style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600 }}>Statut</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((c) => (
                  <tr key={c.lead_id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 6px", fontWeight: 600 }}>{c.client_nom ?? "—"}</td>
                    <td style={{ padding: "10px 6px", color: "#64748b", fontSize: 12 }}>
                      {c.bien_adresse ?? "—"}
                    </td>
                    <td style={{ padding: "10px 6px", fontSize: 12 }}>{c.mandat_type ?? "—"}</td>
                    <td style={{ padding: "10px 6px", color: "#64748b" }}>
                      {fmtDate(c.mandat_signe_at)}
                    </td>
                    <td style={{ padding: "10px 6px", color: "#64748b" }}>
                      {fmtDate(c.vente_date)}
                    </td>
                    <td style={{ padding: "10px 6px", textAlign: "right" }}>
                      {c.vente_prix_final ? fmtEUR(c.vente_prix_final) : "—"}
                    </td>
                    <td style={{ padding: "10px 6px", textAlign: "right" }}>
                      {c.mandat_commission_pct ? `${c.mandat_commission_pct} %` : "—"}
                    </td>
                    <td style={{ padding: "10px 6px", textAlign: "right" }}>
                      {c.commission_eurealimmo_brute ? fmtEUR(c.commission_eurealimmo_brute) : "—"}
                    </td>
                    <td
                      style={{
                        padding: "10px 6px",
                        textAlign: "right",
                        fontWeight: 700,
                        color: PRIMARY,
                      }}
                    >
                      {c.retrocession_mandataire ? fmtEUR(c.retrocession_mandataire) : "—"}
                    </td>
                    <td style={{ padding: "10px 6px" }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 3,
                          background: c.statut_commission === "a_venir" ? "#fef3c7" : "#d1fae5",
                          color: c.statut_commission === "a_venir" ? "#78350f" : "#065f46",
                        }}
                      >
                        {c.statut_commission === "a_venir" ? "À venir" : "Encaissé"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ─── Notice juridique ──────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 16,
          padding: 12,
          background: "#f8fafc",
          borderLeft: `3px solid ${PRIMARY}`,
          fontSize: 12,
          color: "#475569",
          lineHeight: 1.5,
        }}
      >
        <strong>Conformité Hoguet :</strong> Eurealimmo SARL ne pratique aucun maniement de fonds
        clients. Les honoraires sont encaissés directement par le notaire et reversés à Eurealimmo,
        puis votre rétrocession est virée sur votre IBAN dans les 7 j ouvrés.
      </div>
    </div>
  );
}

function TotalCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: 6,
        padding: 20,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        borderTop: `3px solid ${accent}`,
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "#94a3b8",
          letterSpacing: "0.1em",
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color: DARK, fontFamily: "Georgia, serif" }}>
        {value}
      </div>
    </div>
  );
}
