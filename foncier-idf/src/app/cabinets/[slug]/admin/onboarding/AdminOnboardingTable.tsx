"use client";

/**
 * Composant client de la table admin des mandataires en onboarding.
 *
 * Affiche pour chaque mandataire :
 *   - identité (nom + email + tier + téléphone)
 *   - barre de progression visuelle
 *   - jours d'inactivité (colore en rouge si > 7)
 *   - statut prêt 1er mandat
 *   - bouton "Relancer" qui ouvre une modal avec message custom
 *   - lien "Voir détail" vers la page mandataire
 */

import { useState } from "react";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

type Mandataire = {
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
  contract_signed_at: string | null;
};

export function AdminOnboardingTable({
  cabinetSlug,
  mandataires,
}: {
  cabinetSlug: string;
  mandataires: Mandataire[];
}) {
  const [modal, setModal] = useState<{ mandataire: Mandataire; message: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [contratBusy, setContratBusy] = useState<string | null>(null);
  const [activateBusy, setActivateBusy] = useState<string | null>(null);

  async function activateMandataire(m: Mandataire) {
    if (m.contract_signed_at) {
      alert("Mandataire déjà activé.");
      return;
    }
    const note = prompt(
      `Activer ${m.first_name} ${m.last_name} ?\n\n` +
        `Cette action va :\n` +
        `  1. Marquer son contrat comme signé (now)\n` +
        `  2. Envoyer l'email d'activation avec ses URLs workspace à ${m.email}\n\n` +
        `Note optionnelle à ajouter dans l'email (Entrée = aucune note) :`,
    );
    if (note === null) return; // Annulé
    setActivateBusy(m.mandataire_id);
    try {
      const res = await fetch(
        `/api/cabinets/${cabinetSlug}/admin/mandataires/${m.mandataire_id}/activate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true, note: note.trim() || undefined }),
        },
      );
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        detail?: string;
        email_status?: string;
        email_error?: string;
      };
      if (!j.ok) {
        alert(`Erreur activation : ${j.detail ?? j.error}`);
        return;
      }
      if (j.email_status === "sent") {
        alert(`✓ ${m.first_name} activé(e) — email envoyé à ${m.email}`);
      } else if (j.email_status === "failed") {
        alert(
          `✓ ${m.first_name} activé(e) mais email KO : ${j.email_error ?? "inconnu"}\n` +
            `Envoie le mail manuellement.`,
        );
      } else {
        alert(`✓ ${m.first_name} activé(e) — email non envoyé (Resend pas configuré)`);
      }
      // Refresh pour cacher le bouton et màj contract_signed_at
      window.location.reload();
    } catch (err) {
      alert("Erreur réseau : " + (err instanceof Error ? err.message : "inconnue"));
    } finally {
      setActivateBusy(null);
    }
  }

  async function generateContrat(m: Mandataire, sendForSignature: boolean) {
    setContratBusy(m.mandataire_id);
    try {
      const res = await fetch(
        `/api/cabinets/${cabinetSlug}/admin/mandataires/${m.mandataire_id}/contrat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ send_for_signature: sendForSignature }),
        },
      );
      const j = (await res.json()) as {
        ok?: boolean;
        signed_url?: string;
        error?: string;
        message?: string;
        signature?: { ok?: boolean; error?: string };
      };
      if (!j.ok) {
        alert(`Erreur : ${j.message ?? j.error}`);
        return;
      }
      if (sendForSignature) {
        if (j.signature?.ok) alert(`✓ Contrat envoyé en signature à ${m.email}`);
        else alert(`Contrat généré, mais envoi signature KO : ${j.signature?.error ?? "non configuré"}`);
      } else if (j.signed_url) {
        window.open(j.signed_url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      alert("Erreur réseau : " + (err instanceof Error ? err.message : "inconnue"));
    } finally {
      setContratBusy(null);
    }
  }

  async function generateAll() {
    if (!confirm("Générer les contrats de tous les fondateurs éligibles (n° 2..60) sans contrat ?")) return;
    setContratBusy("all");
    try {
      const res = await fetch(
        `/api/cabinets/${cabinetSlug}/admin/mandataires/contrats/batch`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ only_missing: true }),
        },
      );
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        summary?: { total: number; generated: number; skipped: number; errors: number };
      };
      if (!j.ok) {
        alert(`Erreur batch : ${j.error}`);
        return;
      }
      const s = j.summary;
      alert(`✓ Batch terminé — générés : ${s?.generated}, ignorés : ${s?.skipped}, erreurs : ${s?.errors}`);
    } catch (err) {
      alert("Erreur réseau : " + (err instanceof Error ? err.message : "inconnue"));
    } finally {
      setContratBusy(null);
    }
  }

  async function sendRelance() {
    if (!modal) return;
    setSending(true);
    try {
      const res = await fetch(`/api/cabinets/${cabinetSlug}/admin/onboarding/relance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mandataire_id: modal.mandataire.mandataire_id,
          custom_message: modal.message.trim() || undefined,
        }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; detail?: string };
      if (!j.ok) {
        alert(`Erreur envoi : ${j.detail ?? j.error}`);
      } else {
        alert(`✓ Email envoyé à ${modal.mandataire.email}`);
        setModal(null);
      }
    } catch (err) {
      alert("Erreur réseau : " + (err instanceof Error ? err.message : "inconnue"));
    } finally {
      setSending(false);
    }
  }

  if (mandataires.length === 0) {
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
        Aucun mandataire trouvé pour ce filtre.
      </div>
    );
  }

  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button
          type="button"
          onClick={generateAll}
          disabled={contratBusy !== null}
          style={primaryBtn}
        >
          {contratBusy === "all" ? "Génération…" : "📄 Générer tous les contrats"}
        </button>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            background: "white",
            borderRadius: 6,
            overflow: "hidden",
            border: "1px solid #e2e8f0",
          }}
        >
          <thead>
            <tr style={{ background: "#f1f5f9" }}>
              <Th>Mandataire</Th>
              <Th>Tier</Th>
              <Th>Progression</Th>
              <Th>Inactif depuis</Th>
              <Th>Statut</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {mandataires.map((m) => (
              <tr key={m.mandataire_id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <Td>
                  <div style={{ fontWeight: 700 }}>
                    {m.first_name} {m.last_name}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>
                    <a href={`mailto:${m.email}`} style={{ color: "#64748b" }}>
                      {m.email}
                    </a>
                    {m.phone && (
                      <>
                        {" · "}
                        <a href={`tel:${m.phone}`} style={{ color: "#64748b" }}>
                          {m.phone}
                        </a>
                      </>
                    )}
                  </div>
                </Td>
                <Td>
                  <TierBadge tier={m.tier} />
                </Td>
                <Td>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        height: 8,
                        background: "#e2e8f0",
                        borderRadius: 4,
                        overflow: "hidden",
                        minWidth: 80,
                      }}
                    >
                      <div
                        style={{
                          width: `${m.pct_completion ?? 0}%`,
                          height: "100%",
                          background:
                            (m.pct_completion ?? 0) === 100 ? "#059669" : PRIMARY,
                          transition: "width 0.3s",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontWeight: 700,
                        fontSize: 12,
                        minWidth: 60,
                        textAlign: "right",
                      }}
                    >
                      {m.completed_required_steps ?? 0}/{m.total_required_steps ?? 9} ({m.pct_completion ?? 0}%)
                    </span>
                  </div>
                  {(m.blocked_steps ?? 0) > 0 && (
                    <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>
                      🚫 {m.blocked_steps} étape{(m.blocked_steps ?? 0) > 1 ? "s" : ""} bloquée{(m.blocked_steps ?? 0) > 1 ? "s" : ""}
                    </div>
                  )}
                </Td>
                <Td>
                  <span
                    style={{
                      color:
                        (m.days_since_last_activity ?? 0) >= 14
                          ? "#dc2626"
                          : (m.days_since_last_activity ?? 0) >= 7
                            ? "#d97706"
                            : "#64748b",
                      fontWeight: (m.days_since_last_activity ?? 0) >= 7 ? 700 : 400,
                    }}
                  >
                    {m.days_since_last_activity ?? 0} jour
                    {(m.days_since_last_activity ?? 0) > 1 ? "s" : ""}
                  </span>
                </Td>
                <Td>
                  {m.ready_for_first_mandate ? (
                    <span
                      style={{
                        padding: "3px 8px",
                        background: "#d1fae5",
                        color: "#065f46",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.02em",
                      }}
                    >
                      ✓ PRÊT
                    </span>
                  ) : (
                    <span
                      style={{
                        padding: "3px 8px",
                        background: "#fef3c7",
                        color: "#78350f",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      EN COURS
                    </span>
                  )}
                </Td>
                <Td>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => setModal({ mandataire: m, message: "" })}
                      style={primaryBtn}
                    >
                      ✉️ Relancer
                    </button>
                    <a
                      href={`/mandataire/${m.mandataire_id}/onboarding`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={linkBtn}
                    >
                      Voir détail
                    </a>
                    <button
                      type="button"
                      onClick={() => generateContrat(m, false)}
                      disabled={contratBusy !== null}
                      style={secondaryBtn}
                      title="Générer le contrat de mandat (.docx) et l'ouvrir"
                    >
                      {contratBusy === m.mandataire_id ? "…" : "📄 Contrat"}
                    </button>
                    <button
                      type="button"
                      onClick={() => generateContrat(m, true)}
                      disabled={contratBusy !== null}
                      style={secondaryBtn}
                      title="Générer et envoyer en signature électronique"
                    >
                      ✍️ Signature
                    </button>
                    {!m.contract_signed_at ? (
                      <button
                        type="button"
                        onClick={() => activateMandataire(m)}
                        disabled={activateBusy !== null}
                        style={activateBtn}
                        title="Marquer le contrat signé + envoyer l'email d'activation workspace"
                      >
                        {activateBusy === m.mandataire_id ? "Activation…" : "🚀 Activer"}
                      </button>
                    ) : (
                      <span
                        style={{
                          fontSize: 11,
                          color: "#059669",
                          padding: "6px 10px",
                          background: "#d1fae5",
                          borderRadius: 4,
                          fontWeight: 700,
                        }}
                        title={`Activé le ${new Date(m.contract_signed_at).toLocaleDateString("fr-FR")}`}
                      >
                        ✓ ACTIVÉ
                      </span>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal relance */}
      {modal && (
        <div
          onClick={() => !sending && setModal(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 50,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "white",
              borderRadius: 8,
              padding: 28,
              maxWidth: 540,
              width: "100%",
            }}
          >
            <h3
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 20,
                margin: "0 0 8px",
              }}
            >
              Relancer {modal.mandataire.first_name} {modal.mandataire.last_name}
            </h3>
            <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>
              Email automatique « Samuel persona » avec progression actuelle ({modal.mandataire.pct_completion ?? 0}%) +
              étape suivante + CTA. Tu peux ajouter un message personnalisé (optionnel).
            </p>
            <textarea
              value={modal.message}
              onChange={(e) =>
                setModal((prev) => prev && { ...prev, message: e.target.value })
              }
              placeholder="Message personnel (optionnel) — ex: J'ai vu que tu étais bloqué sur la formation ALUR. Veux-tu qu'on fasse un call rapide ?"
              rows={4}
              style={{
                width: "100%",
                padding: 10,
                borderRadius: 4,
                border: "1px solid #cbd5e1",
                fontSize: 13,
                marginBottom: 16,
                fontFamily: "inherit",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setModal(null)}
                disabled={sending}
                style={secondaryBtn}
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={sendRelance}
                disabled={sending}
                style={primaryBtn}
              >
                {sending ? "Envoi…" : "✉️ Envoyer la relance"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const tiers: Record<string, { label: string; color: string; bg: string }> = {
    founder: { label: "👑 FONDATEUR", color: DARK, bg: PRIMARY },
    standard: { label: "💎 STANDARD", color: "#475569", bg: "#f1f5f9" },
    pending: { label: "⏳ EN ATTENTE", color: "#94a3b8", bg: "#f8fafc" },
    custom: { label: "CUSTOM", color: "#64748b", bg: "#f1f5f9" },
  };
  const t = tiers[tier] ?? tiers.pending;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 8px",
        background: t.bg,
        color: t.color,
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.02em",
      }}
    >
      {t.label}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 14px",
        fontSize: 11,
        fontWeight: 700,
        color: "#64748b",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td style={{ padding: "12px 14px", verticalAlign: "top" }}>{children}</td>
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

const secondaryBtn: React.CSSProperties = {
  background: "transparent",
  color: "#64748b",
  border: "1px solid #cbd5e1",
  padding: "6px 12px",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};

const linkBtn: React.CSSProperties = {
  background: "transparent",
  color: PRIMARY,
  border: `1px solid ${PRIMARY}`,
  padding: "6px 12px",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 12,
  textDecoration: "none",
  display: "inline-block",
};

const activateBtn: React.CSSProperties = {
  background: "#059669",
  color: "white",
  border: "none",
  padding: "6px 12px",
  borderRadius: 4,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};
