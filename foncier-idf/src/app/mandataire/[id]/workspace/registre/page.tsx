/**
 * Page registre des mandats — obligation Hoguet décret 72-678 art. 65/73.
 *
 * URL : /mandataire/[id]/workspace/registre
 *
 * Format : tableau chronologique avec numéro de registre continu,
 * type de mandat, date signature, durée, état (en cours / vendu).
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

function dateFin(signeAt: string | null, dureeMois: number | null): string | null {
  if (!signeAt || !dureeMois) return null;
  const d = new Date(signeAt);
  d.setMonth(d.getMonth() + dureeMois);
  return d.toISOString();
}

const TYPE_LABELS: Record<string, string> = {
  vente: "Mandat de vente",
  recherche_acquereur: "Recherche acquéreur",
  mise_en_location: "Mise en location",
  recherche_bien_locatif: "Recherche bien locatif",
};

type Mandat = {
  id: string;
  mandat_numero_registre: string | null;
  mandat_type: string | null;
  mandat_modalite: string | null;
  mandat_signe_at: string | null;
  mandat_duree_mois: number | null;
  visitor_name: string | null;
  address: string | null;
  mandat_commission_pct: number | null;
  mandat_pdf_url: string | null;
  vente_date: string | null;
  vente_prix_final: number | null;
};

async function fetchRegistre(id: string, baseUrl: string): Promise<Mandat[]> {
  try {
    const res = await fetch(`${baseUrl}/api/mandataire/${id}/workspace/registre`, {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.mandats ?? [];
  } catch {
    return [];
  }
}

export default async function WorkspaceRegistrePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

  const mandats = await fetchRegistre(id, baseUrl);
  if (!mandats) notFound();

  const enCours = mandats.filter((m) => !m.vente_date).length;
  const cloture = mandats.filter((m) => m.vente_date).length;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 700, margin: "0 0 4px" }}
        >
          Registre des mandats
        </h1>
        <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
          Obligation loi Hoguet · Décret n° 72-678 art. 65 / 73 — numérotation continue, conservation 10 ans
        </p>
      </div>

      {/* ─── Compteurs ─────────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 16,
          marginBottom: 24,
        }}
      >
        <StatBlock label="Mandats au registre" value={mandats.length} accent={PRIMARY} />
        <StatBlock label="En cours" value={enCours} accent="#f59e0b" />
        <StatBlock label="Clôturés (vente)" value={cloture} accent="#10b981" />
      </div>

      {/* ─── Registre officiel ─────────────────────────────────────────── */}
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
            Registre officiel
          </h2>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            Eurealimmo SARL · CPI 7501 2024 000 000 219
          </span>
        </div>

        {mandats.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13, textAlign: "center", padding: 24 }}>
            Aucun mandat enregistré pour l'instant. Votre premier mandat apparaîtra ici dès
            signature et numérotation par Samuel.
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${PRIMARY}40`, textAlign: "left" }}>
                  <th style={{ padding: "10px 6px", color: "#64748b", fontWeight: 700, width: 90 }}>
                    N° registre
                  </th>
                  <th style={{ padding: "10px 6px", color: "#64748b", fontWeight: 700 }}>Type</th>
                  <th style={{ padding: "10px 6px", color: "#64748b", fontWeight: 700 }}>Modalité</th>
                  <th style={{ padding: "10px 6px", color: "#64748b", fontWeight: 700 }}>Mandant</th>
                  <th style={{ padding: "10px 6px", color: "#64748b", fontWeight: 700 }}>Bien</th>
                  <th style={{ padding: "10px 6px", color: "#64748b", fontWeight: 700 }}>Signé le</th>
                  <th style={{ padding: "10px 6px", color: "#64748b", fontWeight: 700 }}>Échéance</th>
                  <th
                    style={{ padding: "10px 6px", color: "#64748b", fontWeight: 700, textAlign: "right" }}
                  >
                    Commission
                  </th>
                  <th style={{ padding: "10px 6px", color: "#64748b", fontWeight: 700 }}>État</th>
                  <th style={{ padding: "10px 6px", color: "#64748b", fontWeight: 700 }}>PDF</th>
                </tr>
              </thead>
              <tbody>
                {mandats.map((m) => {
                  const fin = dateFin(m.mandat_signe_at, m.mandat_duree_mois);
                  const isExpired = fin && new Date(fin) < new Date() && !m.vente_date;
                  return (
                    <tr key={m.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td
                        style={{
                          padding: "10px 6px",
                          fontFamily: "Georgia, serif",
                          fontWeight: 700,
                          color: PRIMARY,
                        }}
                      >
                        #{m.mandat_numero_registre ?? "—"}
                      </td>
                      <td style={{ padding: "10px 6px" }}>
                        {m.mandat_type ? TYPE_LABELS[m.mandat_type] ?? m.mandat_type : "—"}
                      </td>
                      <td style={{ padding: "10px 6px", textTransform: "capitalize", color: "#64748b" }}>
                        {m.mandat_modalite ?? "—"}
                      </td>
                      <td style={{ padding: "10px 6px", fontWeight: 600 }}>
                        {m.visitor_name ?? "—"}
                      </td>
                      <td style={{ padding: "10px 6px", color: "#64748b", fontSize: 12 }}>
                        {m.address ?? "—"}
                      </td>
                      <td style={{ padding: "10px 6px", color: "#64748b" }}>
                        {fmtDate(m.mandat_signe_at)}
                      </td>
                      <td
                        style={{
                          padding: "10px 6px",
                          color: isExpired ? "#dc2626" : "#64748b",
                          fontWeight: isExpired ? 600 : 400,
                        }}
                      >
                        {fmtDate(fin)}
                      </td>
                      <td style={{ padding: "10px 6px", textAlign: "right", fontWeight: 600 }}>
                        {m.mandat_commission_pct ? `${m.mandat_commission_pct} %` : "—"}
                      </td>
                      <td style={{ padding: "10px 6px" }}>
                        {m.vente_date ? (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 3,
                              background: "#d1fae5",
                              color: "#065f46",
                            }}
                          >
                            Vendu {fmtEUR(m.vente_prix_final)}
                          </span>
                        ) : isExpired ? (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 3,
                              background: "#fee2e2",
                              color: "#991b1b",
                            }}
                          >
                            Expiré
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 3,
                              background: "#fef3c7",
                              color: "#78350f",
                            }}
                          >
                            En cours
                          </span>
                        )}
                      </td>
                      <td style={{ padding: "10px 6px" }}>
                        {m.mandat_pdf_url ? (
                          <a
                            href={m.mandat_pdf_url}
                            target="_blank"
                            rel="noopener"
                            style={{ color: PRIMARY, textDecoration: "none", fontSize: 12, fontWeight: 600 }}
                          >
                            ↓ PDF
                          </a>
                        ) : (
                          <span style={{ color: "#cbd5e1", fontSize: 11 }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
        <strong>Conformité Hoguet :</strong> ce registre est tenu sous la responsabilité d'Eurealimmo SARL,
        titulaire de la carte professionnelle T n° CPI 7501 2024 000 000 219. La numérotation est
        continue, sans rature ni surcharge, et conservée 10 ans (art. 65 du décret 72-678).
        Conformément à l'art. 73, chaque mandat porte le n° d'inscription au registre.
      </div>
    </div>
  );
}

function StatBlock({ label, value, accent }: { label: string; value: number; accent: string }) {
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
