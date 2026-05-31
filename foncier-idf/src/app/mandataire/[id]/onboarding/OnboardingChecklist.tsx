"use client";

/**
 * Composant client interactif de la checklist d'onboarding.
 *
 * Affiche les 10 étapes en cards avec :
 *   - numéro + icône par catégorie
 *   - statut (pending / in_progress / completed / blocked)
 *   - bouton d'action selon validation_type
 *   - input upload URL pour les étapes 'document_upload'
 *   - bouton "marquer fait" pour les étapes 'self_declare'
 *   - mention "attente Samuel" pour les étapes 'admin_validation'
 */

import { useState } from "react";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

type ChecklistItem = {
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
};

const CATEGORY_ICON: Record<string, string> = {
  intake: "📧",
  legal: "📋",
  training: "🎓",
  cci: "🏢",
  tools: "🛠️",
  milestone: "🎯",
};

const STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: "À faire", color: "#64748b", bg: "#f1f5f9" },
  in_progress: { label: "En cours", color: "#78350f", bg: "#fef3c7" },
  completed: { label: "✓ Validé", color: "#065f46", bg: "#d1fae5" },
  skipped: { label: "Ignoré", color: "#94a3b8", bg: "#f8fafc" },
  blocked: { label: "Bloqué", color: "#991b1b", bg: "#fee2e2" },
};

export function OnboardingChecklist({
  mandataireId,
  initialChecklist,
}: {
  mandataireId: string;
  initialChecklist: ChecklistItem[];
}) {
  const [checklist, setChecklist] = useState(initialChecklist);
  const [pendingStep, setPendingStep] = useState<string | null>(null);

  async function updateStep(
    step_key: string,
    status: string,
    extra?: { evidence_url?: string; notes?: string; blocker_reason?: string },
  ) {
    setPendingStep(step_key);
    try {
      const res = await fetch(`/api/mandataire/${mandataireId}/onboarding/step`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step_key, status, ...extra }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; detail?: string };
      if (!j.ok) {
        alert(`Erreur : ${j.detail ?? j.error}`);
        setPendingStep(null);
        return;
      }
      // Optimistic UI update
      setChecklist((prev) =>
        prev.map((s) =>
          s.step_key === step_key
            ? {
                ...s,
                progress: {
                  ...s.progress,
                  status,
                  ...(status === "completed" && {
                    completed_at: new Date().toISOString(),
                  }),
                  ...(extra?.evidence_url && { evidence_url: extra.evidence_url }),
                  ...(extra?.notes && { notes: extra.notes }),
                  ...(extra?.blocker_reason && { blocker_reason: extra.blocker_reason }),
                },
              }
            : s,
        ),
      );
    } catch (err) {
      alert("Erreur réseau : " + (err instanceof Error ? err.message : "inconnue"));
    } finally {
      setPendingStep(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {checklist.map((item) => (
        <StepCard
          key={item.id}
          item={item}
          isPending={pendingStep === item.step_key}
          onUpdate={updateStep}
        />
      ))}
    </div>
  );
}

function StepCard({
  item,
  isPending,
  onUpdate,
}: {
  item: ChecklistItem;
  isPending: boolean;
  onUpdate: (
    step_key: string,
    status: string,
    extra?: { evidence_url?: string; notes?: string; blocker_reason?: string },
  ) => Promise<void>;
}) {
  const status = item.progress.status;
  const statusInfo = STATUS_LABEL[status] ?? STATUS_LABEL.pending;
  const isCompleted = status === "completed";
  const isBlocked = status === "blocked";
  const [uploadUrl, setUploadUrl] = useState(item.progress.evidence_url ?? "");

  return (
    <div
      style={{
        background: isCompleted ? "#f0fdf4" : "white",
        border: `1px solid ${isCompleted ? "#86efac" : "#e2e8f0"}`,
        borderRadius: 8,
        padding: 20,
        opacity: isPending ? 0.6 : 1,
        transition: "all 0.2s",
      }}
    >
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        {/* Numéro + icône */}
        <div
          style={{
            flexShrink: 0,
            width: 48,
            height: 48,
            borderRadius: 8,
            background: isCompleted ? "#059669" : PRIMARY,
            color: isCompleted ? "white" : DARK,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            fontSize: 18,
            fontFamily: "Georgia, serif",
          }}
        >
          {isCompleted ? "✓" : item.step_order}
        </div>

        {/* Contenu */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            <h3
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 18,
                fontWeight: 700,
                color: DARK,
                margin: 0,
              }}
            >
              {CATEGORY_ICON[item.category] ?? "•"} {item.title}
            </h3>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.05em",
                padding: "3px 8px",
                borderRadius: 4,
                color: statusInfo.color,
                background: statusInfo.bg,
              }}
            >
              {statusInfo.label}
            </span>
            {!item.is_required && (
              <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>
                (optionnel)
              </span>
            )}
            {item.estimated_days > 0 && (
              <span style={{ fontSize: 10, color: "#94a3b8" }}>
                · estimé {item.estimated_days} jour{item.estimated_days > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p
            style={{
              color: "#475569",
              fontSize: 13,
              lineHeight: 1.6,
              margin: "0 0 12px",
            }}
          >
            {item.description}
          </p>

          {item.resource_url && (
            <a
              href={item.resource_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                fontSize: 12,
                color: PRIMARY,
                textDecoration: "underline",
                marginBottom: 12,
              }}
            >
              🔗 Ouvrir la ressource officielle →
            </a>
          )}

          {/* Document upload */}
          {item.validation_type === "document_upload" && !isCompleted && (
            <div style={{ marginTop: 8 }}>
              <input
                type="url"
                placeholder="URL du document uploadé (ex: https://...)"
                value={uploadUrl}
                onChange={(e) => setUploadUrl(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 4,
                  border: "1px solid #cbd5e1",
                  fontSize: 13,
                  marginBottom: 8,
                  boxSizing: "border-box",
                }}
              />
              <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>
                Hébergez votre document (Google Drive partagé, Dropbox, etc.) et collez l&apos;URL ici.
                <br />
                À venir Y1 Q2 : upload direct sécurisé via Supabase Storage.
              </div>
            </div>
          )}

          {/* Evidence URL si déjà uploadée */}
          {item.progress.evidence_url && (
            <div
              style={{
                fontSize: 12,
                marginBottom: 12,
                padding: 8,
                background: "#f8fafc",
                borderRadius: 4,
              }}
            >
              📎{" "}
              <a
                href={item.progress.evidence_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: PRIMARY }}
              >
                Document fourni
              </a>
            </div>
          )}

          {/* Blocker */}
          {isBlocked && item.progress.blocker_reason && (
            <div
              style={{
                fontSize: 12,
                padding: 10,
                background: "#fee2e2",
                borderRadius: 4,
                color: "#991b1b",
                marginBottom: 12,
              }}
            >
              <strong>Blocage signalé :</strong> {item.progress.blocker_reason}
            </div>
          )}

          {/* Actions */}
          {!isCompleted && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {item.validation_type === "self_declare" && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => onUpdate(item.step_key, "completed")}
                  style={primaryBtn}
                >
                  ✓ Marquer comme fait
                </button>
              )}

              {item.validation_type === "document_upload" && (
                <button
                  type="button"
                  disabled={isPending || !uploadUrl.trim()}
                  onClick={() =>
                    onUpdate(item.step_key, "completed", {
                      evidence_url: uploadUrl.trim(),
                    })
                  }
                  style={uploadUrl.trim() ? primaryBtn : disabledBtn}
                >
                  ✓ Valider le document
                </button>
              )}

              {item.validation_type === "admin_validation" && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#64748b",
                    fontStyle: "italic",
                    padding: "8px 12px",
                    background: "#f8fafc",
                    borderRadius: 4,
                  }}
                >
                  ⏳ Cette étape est validée par Samuel BRUNO. Aucune action requise.
                </div>
              )}

              {item.validation_type === "auto" && (
                <div
                  style={{
                    fontSize: 12,
                    color: "#64748b",
                    fontStyle: "italic",
                    padding: "8px 12px",
                    background: "#f8fafc",
                    borderRadius: 4,
                  }}
                >
                  🤖 Validation automatique. Aucune action requise.
                </div>
              )}

              {!isBlocked && (
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    const reason = window.prompt(
                      "Décrivez le blocage en quelques mots (ex: attente CCI, doc manquant, question juridique) :",
                    );
                    if (reason && reason.trim()) {
                      onUpdate(item.step_key, "blocked", { blocker_reason: reason.trim() });
                    }
                  }}
                  style={secondaryBtn}
                >
                  ⚠️ Je suis bloqué(e)
                </button>
              )}
            </div>
          )}

          {/* Completed timestamp */}
          {isCompleted && item.progress.completed_at && (
            <div style={{ fontSize: 11, color: "#059669", fontWeight: 600 }}>
              Validé le{" "}
              {new Date(item.progress.completed_at).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const primaryBtn: React.CSSProperties = {
  background: PRIMARY,
  color: DARK,
  border: "none",
  padding: "8px 16px",
  borderRadius: 4,
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer",
};

const disabledBtn: React.CSSProperties = {
  ...primaryBtn,
  background: "#e2e8f0",
  color: "#94a3b8",
  cursor: "not-allowed",
};

const secondaryBtn: React.CSSProperties = {
  background: "transparent",
  color: "#64748b",
  border: "1px solid #cbd5e1",
  padding: "8px 16px",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};
