"use client";

import ProBadge from "./ProBadge";

interface InsightsSummaryProps {
  pointsForts: string[];
  pointsVigilance: string[];
}

export default function InsightsSummary({ pointsForts, pointsVigilance }: InsightsSummaryProps) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 28 }}>
      {/* Points forts */}
      <div
        style={{
          background: "rgba(0,255,136,0.04)",
          border: "1px solid rgba(0,255,136,0.15)",
          borderRadius: 12,
          padding: "18px 20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 16 }}>✅</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#00ff88", textTransform: "uppercase", letterSpacing: 1 }}>
            Points forts
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pointsForts.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{ color: "#00ff88", fontSize: 11, marginTop: 2, flexShrink: 0 }}>●</span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>{p}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Points de vigilance */}
      <div
        style={{
          background: "rgba(255,107,107,0.04)",
          border: "1px solid rgba(255,107,107,0.15)",
          borderRadius: 12,
          padding: "18px 20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontSize: 16 }}>⚠️</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#ff6b6b", textTransform: "uppercase", letterSpacing: 1 }}>
            Points de vigilance
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pointsVigilance.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <span style={{ color: "#ff6b6b", fontSize: 11, marginTop: 2, flexShrink: 0 }}>●</span>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", lineHeight: 1.5 }}>{p}</span>
            </div>
          ))}
        </div>

        {/* Pro teaser */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <ProBadge label="Analyse risques détaillée" />
        </div>
      </div>
    </div>
  );
}
