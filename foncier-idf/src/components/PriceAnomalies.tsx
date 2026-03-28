"use client";

interface Zone {
  id: string;
  type_local: string;
  cluster_id: number;
  count: number;
  prix_m2_median: number | null;
  prix_m2_p25: number | null;
  prix_m2_p75: number | null;
  prix_median: number | null;
  hull_coords: [number, number][] | null;
  centroid_lat: number | null;
  centroid_lon: number | null;
  annee_min: number | null;
  annee_max: number | null;
}

interface Anomaly {
  type_local: string;
  zone_haute: Zone;
  zone_basse: Zone;
  ecart_pct: number;
  ecart_abs: number;
  n_zones: number;
}

const TYPE_LABEL: Record<string, string> = {
  "Appartement": "Appartement",
  "Maison": "Maison",
  "Local industriel. commercial ou assimilé": "Local commercial",
};

function computeAnomalies(zones: Zone[]): Anomaly[] {
  const byType: Record<string, Zone[]> = {};
  for (const z of zones) {
    if (z.prix_m2_median == null || z.prix_m2_median <= 0 || z.count < 3) continue;
    if (!byType[z.type_local]) byType[z.type_local] = [];
    byType[z.type_local].push(z);
  }

  const anomalies: Anomaly[] = [];
  for (const [type, typeZones] of Object.entries(byType)) {
    if (typeZones.length < 2) continue;

    const sorted = [...typeZones].sort((a, b) => (a.prix_m2_median ?? 0) - (b.prix_m2_median ?? 0));
    const zone_basse = sorted[0];
    const zone_haute = sorted[sorted.length - 1];

    const prixBas = zone_basse.prix_m2_median!;
    const prixHaut = zone_haute.prix_m2_median!;
    if (prixBas <= 0) continue;

    const ecart_pct = ((prixHaut / prixBas) - 1) * 100;
    const ecart_abs = prixHaut - prixBas;

    anomalies.push({
      type_local: type,
      zone_haute,
      zone_basse,
      ecart_pct,
      ecart_abs,
      n_zones: typeZones.length,
    });
  }

  return anomalies.sort((a, b) => b.ecart_pct - a.ecart_pct);
}

export default function PriceAnomalies({ zones, commune }: { zones: Zone[]; commune: string }) {
  const anomalies = computeAnomalies(zones);

  if (anomalies.length === 0) return null;

  const topAnomaly = anomalies[0];
  const severity = topAnomaly.ecart_pct >= 50 ? "high" : topAnomaly.ecart_pct >= 25 ? "medium" : "low";
  const severityColor = severity === "high" ? "#ff0055" : severity === "medium" ? "#ff8844" : "#ffdd00";
  const severityLabel = severity === "high" ? "Ecart majeur" : severity === "medium" ? "Ecart significatif" : "Ecart modere";

  return (
    <div id="anomalies" style={{ marginBottom: 36 }}>
      <h2 style={{
        fontSize: 14, fontWeight: 600, color: "rgba(255,255,255,0.5)",
        textTransform: "uppercase", letterSpacing: 1, marginBottom: 6,
      }}>
        Anomalies de prix inter-zones
      </h2>
      <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", marginBottom: 16 }}>
        Ecarts de prix entre micro-marches au sein de {commune}
      </p>

      {/* Alert banner for biggest anomaly */}
      <div style={{
        background: `${severityColor}08`,
        border: `1px solid ${severityColor}30`,
        borderRadius: 12,
        padding: "18px 22px",
        marginBottom: 16,
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: `${severityColor}15`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, flexShrink: 0,
        }}>
          {severity === "high" ? "🔴" : severity === "medium" ? "🟠" : "🟡"}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <span style={{
              fontSize: 28, fontWeight: 900, color: severityColor,
              fontFamily: "Segoe UI, sans-serif", lineHeight: 1,
            }}>
              +{Math.round(topAnomaly.ecart_pct)}%
            </span>
            <span style={{
              padding: "3px 10px", borderRadius: 99,
              background: `${severityColor}20`, border: `1px solid ${severityColor}40`,
              fontSize: 10, fontWeight: 700, color: severityColor,
              textTransform: "uppercase", letterSpacing: 0.8,
            }}>
              {severityLabel}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.55)", lineHeight: 1.6 }}>
            Dans la meme commune, le prix median au m² varie de{" "}
            <strong style={{ color: "#51cf66" }}>{Math.round(topAnomaly.zone_basse.prix_m2_median!).toLocaleString("fr-FR")} €/m²</strong>
            {" "}a{" "}
            <strong style={{ color: "#ff6b6b" }}>{Math.round(topAnomaly.zone_haute.prix_m2_median!).toLocaleString("fr-FR")} €/m²</strong>
            {" "}en {TYPE_LABEL[topAnomaly.type_local]?.toLowerCase() ?? topAnomaly.type_local}
            {" "}— soit {Math.round(topAnomaly.ecart_abs).toLocaleString("fr-FR")} €/m² de difference.
          </p>
        </div>
      </div>

      {/* Anomaly cards per type */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {anomalies.map((a) => {
          const typeColors: Record<string, string> = {
            Appartement: "#00d4ff",
            Maison: "#ff8844",
            "Local industriel. commercial ou assimilé": "#a855f7",
          };
          const tc = typeColors[a.type_local] ?? "#00ff88";

          return (
            <div key={a.type_local} style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12, padding: "18px 20px",
            }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: tc, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 14 }}>
                {TYPE_LABEL[a.type_local] ?? a.type_local}
              </div>

              {/* Visual bar comparison */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
                {/* Zone basse */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Zone Z{a.zone_basse.cluster_id} · {a.zone_basse.count} tx</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#51cf66" }}>
                      {Math.round(a.zone_basse.prix_m2_median!).toLocaleString("fr-FR")} €/m²
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3,
                      width: `${Math.round((a.zone_basse.prix_m2_median! / a.zone_haute.prix_m2_median!) * 100)}%`,
                      background: "linear-gradient(90deg, #51cf66, #51cf6688)",
                    }} />
                  </div>
                </div>

                {/* Zone haute */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>Zone Z{a.zone_haute.cluster_id} · {a.zone_haute.count} tx</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#ff6b6b" }}>
                      {Math.round(a.zone_haute.prix_m2_median!).toLocaleString("fr-FR")} €/m²
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3, width: "100%",
                      background: "linear-gradient(90deg, #ff6b6b88, #ff6b6b)",
                    }} />
                  </div>
                </div>
              </div>

              {/* Ecart summary */}
              <div style={{
                padding: "10px 14px", borderRadius: 8,
                background: `${severityColor}08`, border: `1px solid ${severityColor}20`,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)" }}>Ecart</span>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: severityColor }}>+{Math.round(a.ecart_pct)}%</span>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>
                    ({Math.round(a.ecart_abs).toLocaleString("fr-FR")} €/m²)
                  </span>
                </div>
              </div>

              <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.25)", textAlign: "right" }}>
                {a.n_zones} micro-marches analyses
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
