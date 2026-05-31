"use client";

/**
 * Table des candidatures Eurealimmo (côté client).
 *
 * - Affiche chaque candidature avec ses infos profil + motivation
 * - Boutons d'action pour faire avancer le statut (new → reviewing → ...)
 * - Lien direct vers email + téléphone (mailto: / tel:)
 */

import { useState } from "react";

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

const STATUS_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  new: { label: "🆕 NOUVELLE", color: DARK, bg: "#fef3c7" },
  reviewing: { label: "👀 EN COURS", color: "#1e3a8a", bg: "#dbeafe" },
  call_scheduled: { label: "📞 CALL PLANIFIÉ", color: "#6d28d9", bg: "#ede9fe" },
  call_done: { label: "📞 CALL FAIT", color: "#1d4ed8", bg: "#dbeafe" },
  accepted: { label: "✓ ACCEPTÉE", color: "#065f46", bg: "#d1fae5" },
  rejected: { label: "✗ REJETÉE", color: "#991b1b", bg: "#fee2e2" },
  withdrawn: { label: "↩ RETIRÉE", color: "#475569", bg: "#f1f5f9" },
};

const SPECIALTY_LABEL: Record<string, string> = {
  hnwi: "👑 HNWI",
  ancien_standing: "🏛️ Ancien standing",
  standard: "💎 Standard",
  commercial: "🏢 Commercial",
  location: "🔑 Location",
  mixte: "🔀 Mixte",
};

export function ApplicationsTable({ applications }: { applications: Application[] }) {
  const [updating, setUpdating] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [list, setList] = useState(applications);

  async function updateStatus(application_id: string, status: string, notes?: string) {
    setUpdating(application_id);
    try {
      const res = await fetch("/api/cabinets/eurealimmo/admin/applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ application_id, status, reviewer_notes: notes }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; detail?: string };
      if (!j.ok) {
        alert(`Erreur : ${j.detail ?? j.error}`);
        return;
      }
      setList((prev) =>
        prev.map((a) =>
          a.id === application_id ? { ...a, status, reviewed_at: new Date().toISOString() } : a,
        ),
      );
    } catch (err) {
      alert("Erreur réseau : " + (err instanceof Error ? err.message : "inconnue"));
    } finally {
      setUpdating(null);
    }
  }

  if (list.length === 0) {
    return (
      <div
        style={{
          padding: 40,
          textAlign: "center",
          background: "#f8fafc",
          borderRadius: 8,
          color: "#64748b",
        }}
      >
        Aucune candidature pour ce filtre.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {list.map((a) => {
        const isExpanded = expanded === a.id;
        const isUpdating = updating === a.id;
        const statusInfo = STATUS_BADGE[a.status] ?? STATUS_BADGE.new;

        return (
          <div
            key={a.id}
            style={{
              background: "white",
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              padding: 20,
              opacity: isUpdating ? 0.6 : 1,
              transition: "all 0.2s",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 16,
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 240 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 4,
                    flexWrap: "wrap",
                  }}
                >
                  <h3
                    style={{
                      fontFamily: "Georgia, serif",
                      fontSize: 18,
                      fontWeight: 700,
                      margin: 0,
                    }}
                  >
                    {a.first_name} {a.last_name}
                  </h3>
                  <span
                    style={{
                      padding: "3px 8px",
                      background: statusInfo.bg,
                      color: statusInfo.color,
                      borderRadius: 4,
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.05em",
                    }}
                  >
                    {statusInfo.label}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: "#94a3b8",
                      fontStyle: "italic",
                    }}
                  >
                    {SPECIALTY_LABEL[a.specialty] ?? a.specialty}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#64748b" }}>
                  <a href={`mailto:${a.email}`} style={{ color: "#475569", marginRight: 12 }}>
                    📧 {a.email}
                  </a>
                  <a href={`tel:${a.phone}`} style={{ color: "#475569" }}>
                    📞 {a.phone}
                  </a>
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 11, color: "#94a3b8" }}>
                Reçue le{" "}
                {new Date(a.created_at).toLocaleString("fr-FR", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </div>
            </div>

            {/* Profil sommaire */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 8,
                fontSize: 12,
                marginBottom: 12,
                padding: 12,
                background: "#fafafa",
                borderRadius: 4,
              }}
            >
              <ProfileField label="Statut actuel" value={a.current_status.replace(/_/g, " ")} />
              <ProfileField label="Réseau" value={a.current_network ?? "—"} />
              <ProfileField label="Expérience" value={a.years_experience} />
              <ProfileField label="Carte T" value={a.has_carte_t} />
              {a.referred_by_email && (
                <ProfileField
                  label="Recommandé par"
                  value={a.referred_by_email}
                  highlight={a.source === "referral"}
                />
              )}
            </div>

            {/* Motivation (toggle) */}
            {a.motivation && (
              <div>
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : a.id)}
                  style={{
                    background: "transparent",
                    color: PRIMARY,
                    border: "none",
                    padding: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                    marginBottom: isExpanded ? 8 : 0,
                  }}
                >
                  {isExpanded ? "▼ Cacher la motivation" : "▶ Voir la motivation"}
                </button>
                {isExpanded && (
                  <div
                    style={{
                      padding: 12,
                      background: "#fffbeb",
                      borderLeft: `3px solid ${PRIMARY}`,
                      borderRadius: 4,
                      fontSize: 13,
                      color: "#78350f",
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.5,
                      marginBottom: 12,
                    }}
                  >
                    {a.motivation}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
              {a.status === "new" && (
                <button
                  onClick={() => updateStatus(a.id, "reviewing")}
                  disabled={isUpdating}
                  style={primaryBtn}
                >
                  👀 Prendre en revue
                </button>
              )}
              {(a.status === "new" || a.status === "reviewing") && (
                <button
                  onClick={() => updateStatus(a.id, "call_scheduled")}
                  disabled={isUpdating}
                  style={primaryBtn}
                >
                  📞 Call programmé
                </button>
              )}
              {(a.status === "call_scheduled" || a.status === "reviewing") && (
                <button
                  onClick={() => updateStatus(a.id, "call_done")}
                  disabled={isUpdating}
                  style={primaryBtn}
                >
                  ✓ Call fait
                </button>
              )}
              {a.status !== "accepted" && a.status !== "rejected" && (
                <>
                  <button
                    onClick={() => {
                      const notes = window.prompt(
                        "Notes finales avant acceptation (optionnel) :",
                      );
                      updateStatus(a.id, "accepted", notes ?? undefined);
                    }}
                    disabled={isUpdating}
                    style={greenBtn}
                  >
                    ✓ Accepter
                  </button>
                  <button
                    onClick={() => {
                      const notes = window.prompt(
                        "Raison du rejet (sera loggée) :",
                      );
                      if (notes) updateStatus(a.id, "rejected", notes);
                    }}
                    disabled={isUpdating}
                    style={redBtn}
                  >
                    ✗ Rejeter
                  </button>
                </>
              )}
              <a
                href={`mailto:${a.email}?subject=Eurealimmo Réseau — votre candidature`}
                style={linkBtn}
              >
                ✉️ Répondre
              </a>
            </div>

            {a.reviewer_notes && (
              <div
                style={{
                  marginTop: 12,
                  padding: 10,
                  background: "#f1f5f9",
                  borderRadius: 4,
                  fontSize: 11,
                  color: "#475569",
                }}
              >
                <strong>Notes :</strong> {a.reviewer_notes}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ProfileField({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          color: "#94a3b8",
          fontWeight: 700,
          letterSpacing: "0.05em",
          marginBottom: 2,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div
        style={{
          fontSize: 12,
          color: highlight ? PRIMARY : DARK,
          fontWeight: highlight ? 700 : 500,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: PRIMARY,
  color: DARK,
  border: "none",
  padding: "6px 12px",
  borderRadius: 4,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

const greenBtn: React.CSSProperties = {
  background: "#059669",
  color: "white",
  border: "none",
  padding: "6px 12px",
  borderRadius: 4,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

const redBtn: React.CSSProperties = {
  background: "transparent",
  color: "#991b1b",
  border: "1px solid #fca5a5",
  padding: "6px 12px",
  borderRadius: 4,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

const linkBtn: React.CSSProperties = {
  background: "transparent",
  color: "#475569",
  border: "1px solid #cbd5e1",
  padding: "6px 12px",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 12,
  textDecoration: "none",
  display: "inline-block",
};
