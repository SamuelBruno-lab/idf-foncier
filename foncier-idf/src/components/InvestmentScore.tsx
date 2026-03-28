"use client";

interface InvestmentScoreProps {
  score: number; // 0-100
  label: string;
  commune: string;
}

export default function InvestmentScore({ score, label, commune }: InvestmentScoreProps) {
  const getColor = (s: number) => {
    if (s >= 70) return "#00ff88";
    if (s >= 50) return "#00d4ff";
    if (s >= 30) return "#f59e0b";
    return "#ff6b6b";
  };

  const getLabel = (s: number) => {
    if (s >= 70) return "Zone à fort potentiel";
    if (s >= 50) return "Zone intéressante";
    if (s >= 30) return "Zone neutre";
    return "Zone de vigilance";
  };

  const color = getColor(score);
  const pct = Math.min(100, Math.max(0, score));

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${color}33`,
        borderRadius: 14,
        padding: "24px 28px",
        marginBottom: 24,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Glow effect */}
      <div style={{ position: "absolute", top: -40, right: -40, width: 120, height: 120, borderRadius: "50%", background: `${color}08` }} />

      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 8 }}>
            Score investissement · {commune}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
            <span style={{ fontSize: 48, fontWeight: 900, color, fontFamily: "Segoe UI, sans-serif", lineHeight: 1 }}>
              {score}
            </span>
            <span style={{ fontSize: 16, color: "rgba(255,255,255,0.4)", fontWeight: 600 }}>/100</span>
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 99,
              background: `${color}15`,
              border: `1px solid ${color}30`,
              fontSize: 12,
              color,
              fontWeight: 700,
            }}
          >
            {getLabel(score)}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, maxWidth: 400 }}>
            {label}
          </p>
        </div>

        {/* Visual gauge */}
        <div style={{ width: 100, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <svg width="100" height="60" viewBox="0 0 100 60">
            {/* Background arc */}
            <path
              d="M10 55 A 40 40 0 0 1 90 55"
              fill="none"
              stroke="rgba(255,255,255,0.08)"
              strokeWidth="8"
              strokeLinecap="round"
            />
            {/* Score arc */}
            <path
              d="M10 55 A 40 40 0 0 1 90 55"
              fill="none"
              stroke={color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${pct * 1.26} 126`}
              style={{ filter: `drop-shadow(0 0 6px ${color}44)` }}
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
