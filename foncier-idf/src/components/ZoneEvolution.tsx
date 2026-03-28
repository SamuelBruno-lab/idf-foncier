"use client";

import ProBadge from "./ProBadge";

interface ZoneYearStat { annee: number; prix_m2_median: number; count: number }
interface ZoneEvolutionData {
  zone_id: string; type_local: string; cluster_id: number;
  prix_m2_median: number | null;
  evolution: ZoneYearStat[];
}

const TYPE_LABEL: Record<string, string> = {
  "Appartement": "Appt",
  "Maison": "Maison",
  "Local industriel. commercial ou assimilé": "Commerce",
};
const TYPE_COLORS: Record<string, string> = {
  "Appartement": "#00d4ff",
  "Maison": "#ff8844",
  "Local industriel. commercial ou assimilé": "#a855f7",
};

function Sparkline({ data, color, width = 120, height = 32 }: { data: number[]; color: string; width?: number; height?: number }) {
  if (data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const w = width - padding * 2;
  const h = height - padding * 2;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * w;
    const y = padding + h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(" ");

  // Fill area
  const firstX = padding;
  const lastX = padding + w;
  const fillPoints = `${firstX},${padding + h} ${points} ${lastX},${padding + h}`;

  return (
    <svg width={width} height={height} style={{ display: "block" }}>
      <polygon points={fillPoints} fill={`${color}15`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      {/* Last point dot */}
      {(() => {
        const lastVal = data[data.length - 1];
        const x = padding + w;
        const y = padding + h - ((lastVal - min) / range) * h;
        return <circle cx={x} cy={y} r={2.5} fill={color} />;
      })()}
    </svg>
  );
}

export default function ZoneEvolution({ zones, isPro }: { zones: ZoneEvolutionData[]; isPro: boolean }) {
  if (zones.length === 0) return null;

  // Group by type
  const byType = new Map<string, ZoneEvolutionData[]>();
  for (const z of zones) {
    const arr = byType.get(z.type_local) ?? [];
    arr.push(z);
    byType.set(z.type_local, arr);
  }

  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 1, margin: 0 }}>
          Évolution par micro-zone
        </h2>
        {!isPro && <ProBadge label="Historique micro-zones" />}
      </div>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>
        Tendance des prix/m² par zone HDBSCAN au fil des annees
      </p>

      {isPro ? (
        /* Full data view */
        [...byType.entries()].map(([type, typeZones]) => {
          const color = TYPE_COLORS[type] ?? "#00ff88";
          // Sort by biggest evolution (most interesting first)
          const sorted = [...typeZones].sort((a, b) => {
            const aChange = a.evolution.length >= 2 ? (a.evolution[a.evolution.length - 1].prix_m2_median / a.evolution[0].prix_m2_median - 1) : 0;
            const bChange = b.evolution.length >= 2 ? (b.evolution[b.evolution.length - 1].prix_m2_median / b.evolution[0].prix_m2_median - 1) : 0;
            return Math.abs(bChange) - Math.abs(aChange);
          });

          return (
            <div key={type} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 10 }}>
                {TYPE_LABEL[type] ?? type} — {sorted.length} zones avec historique
              </div>
              <div style={{
                background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 12, overflow: "hidden",
              }}>
                <div style={{ overflowX: "auto" }}>
                  <div style={{ minWidth: 500 }}>
                    {/* Header */}
                    <div style={{
                      display: "grid", gridTemplateColumns: "60px 120px 1fr 100px 80px",
                      padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)",
                      fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: 0.5, textTransform: "uppercase", gap: 8,
                    }}>
                      <span>Zone</span>
                      <span>Tendance</span>
                      <span>Annees</span>
                      <span style={{ textAlign: "right" }}>Actuel</span>
                      <span style={{ textAlign: "right" }}>Evol.</span>
                    </div>

                    {sorted.map((zone, i) => {
                      const first = zone.evolution[0];
                      const last = zone.evolution[zone.evolution.length - 1];
                      const change = ((last.prix_m2_median / first.prix_m2_median) - 1) * 100;
                      const isUp = change > 0;

                      return (
                        <div key={zone.zone_id} style={{
                          display: "grid", gridTemplateColumns: "60px 120px 1fr 100px 80px",
                          padding: "10px 16px",
                          borderBottom: i < sorted.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                          alignItems: "center", gap: 8,
                        }}>
                          <span style={{ fontWeight: 700, fontSize: 12, color }}>Z{zone.cluster_id}</span>

                          <Sparkline
                            data={zone.evolution.map((e) => e.prix_m2_median)}
                            color={isUp ? "#51cf66" : "#ff6b6b"}
                          />

                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                            {zone.evolution.map((e) => (
                              <div key={e.annee} style={{
                                fontSize: 9, padding: "2px 6px", borderRadius: 4,
                                background: "rgba(255,255,255,0.04)",
                                color: "rgba(255,255,255,0.4)",
                                whiteSpace: "nowrap",
                              }}>
                                {e.annee}: {e.prix_m2_median.toLocaleString("fr-FR")}
                              </div>
                            ))}
                          </div>

                          <span style={{ fontSize: 13, fontWeight: 700, color: "#ffdd00", textAlign: "right", whiteSpace: "nowrap" }}>
                            {last.prix_m2_median.toLocaleString("fr-FR")} €
                          </span>

                          <span style={{
                            fontSize: 12, fontWeight: 800, textAlign: "right",
                            color: isUp ? "#51cf66" : "#ff6b6b",
                          }}>
                            {isUp ? "+" : ""}{change.toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      ) : (
        /* Blurred preview for free tier */
        <div style={{ position: "relative", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ filter: "blur(6px)", opacity: 0.4, pointerEvents: "none" }}>
            <div style={{
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 12, overflow: "hidden",
            }}>
              <div style={{
                display: "grid", gridTemplateColumns: "60px 120px 1fr 100px 80px",
                padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)",
                fontSize: 10, color: "rgba(255,255,255,0.3)", gap: 8,
              }}>
                <span>Zone</span><span>Tendance</span><span>Annees</span>
                <span style={{ textAlign: "right" }}>Actuel</span>
                <span style={{ textAlign: "right" }}>Evol.</span>
              </div>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "60px 120px 1fr 100px 80px",
                  padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)",
                  alignItems: "center", gap: 8,
                }}>
                  <span style={{ fontWeight: 700, color: "#00d4ff" }}>Z{i}</span>
                  <div style={{ height: 32, background: "rgba(255,255,255,0.03)", borderRadius: 4 }} />
                  <div style={{ display: "flex", gap: 4 }}>
                    {[2020, 2021, 2022, 2023, 2024].map((yr) => (
                      <div key={yr} style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)" }}>
                        {yr}: ●●●●
                      </div>
                    ))}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#ffdd00", textAlign: "right" }}>●●●● €</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "#51cf66", textAlign: "right" }}>+●●%</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(7,7,20,0.5)",
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                Évolution prix/m² par micro-zone
              </div>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>
                Sparklines + tendances 2020 → 2025 par zone HDBSCAN
              </div>
              <ProBadge label="Debloquer l'historique micro-zones" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
