/**
 * Page leads mandataire — kanban + liste de tous les leads attribués.
 *
 * URL : /mandataire/[id]/workspace/leads
 */

import { headers } from "next/headers";
import { notFound } from "next/navigation";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

const fmtEUR = (n: number | null) =>
  n
    ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n)
    : "—";

const fmtDate = (s: string | null) =>
  s
    ? new Date(s).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

type Lead = {
  id: string;
  cabinet_slug: string;
  visitor_name: string | null;
  visitor_email: string | null;
  visitor_phone: string | null;
  address: string | null;
  status: string;
  created_at: string;
  mandat_type: string | null;
  mandat_signe_at: string | null;
  vente_prix_final: number | null;
  vente_date: string | null;
  surface_m2: number | null;
  prix_estime: number | null;
};

const COLUMNS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "nouveau", label: "Nouveaux", statuses: ["new"] },
  { key: "contact", label: "Contactés", statuses: ["contacted", "rdv_planifie", "visite_planifiee"] },
  { key: "mandat", label: "Mandats signés", statuses: ["mandat_signe"] },
  { key: "vente", label: "Ventes", statuses: ["vendu"] },
];

async function fetchLeads(id: string, baseUrl: string): Promise<Lead[]> {
  try {
    const res = await fetch(`${baseUrl}/api/mandataire/${id}/workspace/leads`, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    return data.leads ?? [];
  } catch {
    return [];
  }
}

export default async function WorkspaceLeadsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const leads = await fetchLeads(id, baseUrl);
  if (!leads) notFound();

  const byColumn = COLUMNS.map((col) => ({
    ...col,
    leads: leads.filter((l) => col.statuses.includes(l.status)),
  }));

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}
        >
          Mes leads
        </h1>
        <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
          {leads.length} lead{leads.length > 1 ? "s" : ""} attribué{leads.length > 1 ? "s" : ""}.
          Pour signer un mandat Hoguet, ouvrez le détail du lead via votre tableau cabinet.
        </p>
      </div>

      {/* ─── Kanban 4 colonnes ─────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 12,
          marginBottom: 32,
        }}
      >
        {byColumn.map((col) => (
          <div
            key={col.key}
            style={{
              background: "white",
              borderRadius: 6,
              padding: 12,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              minHeight: 400,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
                paddingBottom: 8,
                borderBottom: `2px solid ${PRIMARY}40`,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: DARK, letterSpacing: "0.05em" }}>
                {col.label.toUpperCase()}
              </span>
              <span
                style={{
                  background: PRIMARY,
                  color: DARK,
                  fontSize: 11,
                  fontWeight: 700,
                  padding: "2px 8px",
                  borderRadius: 10,
                }}
              >
                {col.leads.length}
              </span>
            </div>

            {col.leads.length === 0 ? (
              <div style={{ color: "#cbd5e1", fontSize: 11, textAlign: "center", padding: 12 }}>
                —
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {col.leads.map((lead) => (
                  <a
                    key={lead.id}
                    href={`/cabinets/${lead.cabinet_slug}/admin/lead/${lead.id}`}
                    style={{
                      display: "block",
                      padding: 10,
                      background: "#fafafa",
                      borderRadius: 4,
                      textDecoration: "none",
                      color: DARK,
                      fontSize: 12,
                      border: "1px solid #e2e8f0",
                    }}
                  >
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>
                      {lead.visitor_name ?? "Anonyme"}
                    </div>
                    <div style={{ color: "#64748b", fontSize: 11, marginBottom: 4, lineHeight: 1.3 }}>
                      {lead.address ?? "—"}
                    </div>
                    {lead.prix_estime && (
                      <div style={{ fontSize: 11, color: PRIMARY, fontWeight: 700 }}>
                        Estim. {fmtEUR(lead.prix_estime)}
                      </div>
                    )}
                    {lead.vente_prix_final && (
                      <div style={{ fontSize: 11, color: "#059669", fontWeight: 700 }}>
                        Vendu {fmtEUR(lead.vente_prix_final)}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
                      {fmtDate(lead.created_at)}
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* ─── Liste complète ────────────────────────────────────────────── */}
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
          Liste complète
        </h2>

        {leads.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: 24 }}>
            Aucun lead pour l'instant. Samuel vous attribuera les leads via le matching Collabimo.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #e2e8f0", textAlign: "left" }}>
                  <th style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600 }}>Client</th>
                  <th style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600 }}>Bien</th>
                  <th style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600 }}>Statut</th>
                  <th style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600 }}>Créé le</th>
                  <th style={{ padding: "8px 6px", color: "#64748b", fontWeight: 600 }}>Estim.</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                    <td style={{ padding: "10px 6px" }}>
                      <a
                        href={`/cabinets/${lead.cabinet_slug}/admin/lead/${lead.id}`}
                        style={{ color: DARK, textDecoration: "none", fontWeight: 600 }}
                      >
                        {lead.visitor_name ?? "Anonyme"}
                      </a>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{lead.visitor_email ?? ""}</div>
                    </td>
                    <td style={{ padding: "10px 6px", color: "#64748b" }}>{lead.address ?? "—"}</td>
                    <td style={{ padding: "10px 6px" }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: "2px 8px",
                          borderRadius: 3,
                          background: "#f1f5f9",
                          color: DARK,
                        }}
                      >
                        {lead.status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 6px", color: "#64748b" }}>{fmtDate(lead.created_at)}</td>
                    <td style={{ padding: "10px 6px", fontWeight: 600 }}>{fmtEUR(lead.prix_estime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
