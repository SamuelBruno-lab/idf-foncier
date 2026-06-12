"use client";

/**
 * Composant client : affiche les codes referral d'un mandataire
 * avec bouton "Copier" et QR code.
 */

import { useState } from "react";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

type ReferralCode = {
  code: string;
  tier: string;
  max_uses: number;
  current_uses: number;
  places_remaining: number;
  message_public: string | null;
  full_url: string;
  qr_code_url: string;
};

export function ReferralLinksCard({
  founderCodes,
  standardCodes,
  network,
}: {
  founderCodes: ReferralCode[];
  standardCodes: ReferralCode[];
  network: { founder_count: number; founder_cap: number; founder_remaining: number };
}) {
  return (
    <div>
      {/* ─── Compteur réseau ─────────────────────────────────────────── */}
      <section
        style={{
          background: "white",
          borderRadius: 6,
          padding: 20,
          marginBottom: 16,
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          borderLeft: `4px solid ${PRIMARY}`,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                color: "#94a3b8",
                letterSpacing: "0.1em",
                fontWeight: 700,
                marginBottom: 4,
              }}
            >
              CERCLE FONDATEUR EUREALIMMO
            </div>
            <div style={{ fontSize: 14, color: "#475569" }}>
              Places restantes dans le réseau (premier arrivé, premier servi)
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 32,
                fontWeight: 800,
                color: PRIMARY,
              }}
            >
              {network.founder_remaining}<span style={{ fontSize: 18, color: "#94a3b8" }}>/{network.founder_cap}</span>
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>
              {network.founder_count} place{network.founder_count > 1 ? "s" : ""} occupée{network.founder_count > 1 ? "s" : ""}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Codes Fondateur ─────────────────────────────────────────── */}
      {founderCodes.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 18,
              fontWeight: 700,
              margin: "0 0 8px",
              color: DARK,
            }}
          >
            👑 Lien Fondateur
          </h2>
          <p style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
            Réservé : tu fais partie du cercle restreint qui peut recruter des Associés Fondateurs.
            Tu touches <strong>18 % à vie</strong> sur les commissions de tes filleuls.
          </p>
          {founderCodes.map((c) => (
            <LinkCard key={c.code} code={c} highlight />
          ))}
        </section>
      )}

      {/* ─── Codes Standard ──────────────────────────────────────────── */}
      <section>
        <h2
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 18,
            fontWeight: 700,
            margin: "0 0 8px",
            color: DARK,
          }}
        >
          💼 Lien Standard
        </h2>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
          Partage ce lien pour recruter des mandataires standard. Tu touches <strong>18 % à vie</strong>{" "}
          sur leurs commissions.
        </p>
        {standardCodes.length === 0 ? (
          <div style={{ color: "#94a3b8", fontSize: 13, padding: 24, textAlign: "center" }}>
            Ton code standard sera généré automatiquement à l'activation de ton contrat.
          </div>
        ) : (
          standardCodes.map((c) => <LinkCard key={c.code} code={c} />)
        )}
      </section>
    </div>
  );
}

function LinkCard({ code, highlight }: { code: ReferralCode; highlight?: boolean }) {
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(code.full_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const el = document.createElement("textarea");
      el.value = code.full_url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const usesPct = Math.round((code.current_uses / code.max_uses) * 100);

  return (
    <div
      style={{
        background: highlight ? "#fffbeb" : "white",
        border: highlight ? `2px solid ${PRIMARY}` : "1px solid #e2e8f0",
        borderRadius: 6,
        padding: 16,
        marginBottom: 12,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px", gap: 16 }}>
        <div>
          {/* Code */}
          <div
            style={{
              display: "inline-block",
              padding: "4px 10px",
              background: highlight ? PRIMARY : "#f1f5f9",
              color: highlight ? DARK : "#475569",
              borderRadius: 3,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.05em",
              marginBottom: 10,
              fontFamily: "Georgia, serif",
            }}
          >
            CODE : {code.code}
          </div>

          {/* URL + bouton copier */}
          <div
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <input
              readOnly
              value={code.full_url}
              onClick={(e) => e.currentTarget.select()}
              style={{
                flex: 1,
                padding: "8px 10px",
                border: "1px solid #cbd5e1",
                borderRadius: 4,
                fontSize: 12,
                fontFamily: "monospace",
                background: "#f8fafc",
                color: DARK,
              }}
            />
            <button
              type="button"
              onClick={copyToClipboard}
              style={{
                background: copied ? "#10b981" : DARK,
                color: "white",
                border: "none",
                padding: "0 14px",
                borderRadius: 4,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
                minWidth: 90,
              }}
            >
              {copied ? "✓ Copié" : "📋 Copier"}
            </button>
          </div>

          {/* Compteur */}
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "#64748b",
                marginBottom: 4,
              }}
            >
              <span>
                Utilisations : <strong>{code.current_uses}</strong> /{" "}
                {code.max_uses >= 9999 ? "illimité" : code.max_uses}
              </span>
              <span>{code.places_remaining} restantes</span>
            </div>
            <div
              style={{
                background: "#e2e8f0",
                height: 6,
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: highlight ? PRIMARY : "#3b82f6",
                  height: "100%",
                  width: `${Math.min(100, usesPct)}%`,
                  transition: "width 0.3s",
                }}
              />
            </div>
          </div>
        </div>

        {/* QR code */}
        <div style={{ textAlign: "center" }}>
          <img
            src={code.qr_code_url}
            alt={`QR code pour ${code.code}`}
            width={120}
            height={120}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 4,
              background: "white",
              padding: 4,
            }}
          />
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
            Scanner / partager IRL
          </div>
        </div>
      </div>
    </div>
  );
}
