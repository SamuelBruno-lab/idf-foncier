"use client";

import { useState, useCallback, useMemo } from "react";
import Map, { NavigationControl, ScaleControl } from "react-map-gl/mapbox";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { PickingInfo } from "@deck.gl/core";
import type { DvfPoint, DvfCluster, DvfFilters } from "@/types/dvf";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

const INITIAL_VIEW = {
  longitude: 2.347,
  latitude: 48.859,
  zoom: 10,
  pitch: 0,
  bearing: 0,
};

// Gradient couleur rendement brut (gris→rouge→orange→vert)
function rendementColor(r: number | null | undefined): [number, number, number, number] {
  if (r == null) return [100, 100, 120, 120];
  if (r < 3) return [255, 60, 60, 200];
  if (r < 5) return [255, 160, 0, 200];
  if (r < 7) return [50, 220, 100, 200];
  return [0, 255, 120, 220];
}

// Gradient couleur prix/m²  (bleu→vert→jaune→orange→rouge)
function priceColor(prix_m2: number | null, min: number, max: number): [number, number, number, number] {
  if (!prix_m2) return [150, 150, 150, 180];
  const t = Math.max(0, Math.min(1, (prix_m2 - min) / (max - min)));
  // 0=bleu, 0.25=cyan, 0.5=vert, 0.75=jaune, 1=rouge
  const stops = [
    [0, 100, 255],
    [0, 220, 180],
    [50, 220, 50],
    [255, 200, 0],
    [255, 30, 30],
  ];
  const idx = t * (stops.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, stops.length - 1);
  const f = idx - lo;
  const r = Math.round(stops[lo][0] + f * (stops[hi][0] - stops[lo][0]));
  const g = Math.round(stops[lo][1] + f * (stops[hi][1] - stops[lo][1]));
  const b = Math.round(stops[lo][2] + f * (stops[hi][2] - stops[lo][2]));
  return [r, g, b, 200];
}

interface Props {
  points: DvfPoint[];
  clusters: DvfCluster[];
  mode: "clusters" | "heatmap";
  filters: DvfFilters;
  isLoading: boolean;
  colorBy: "prix" | "rendement";
  onCommuneClick?: (code: string, nom: string) => void;
}

export default function DvfMap({ points, clusters, mode, filters, isLoading, colorBy, onCommuneClick }: Props) {
  const [hovered, setHovered] = useState<DvfPoint | DvfCluster | null>(null);
  const [cursor, setCursor] = useState("grab");

  const priceRange = useMemo(() => {
    // En mode clusters, utiliser les prix des clusters ; sinon utiliser les points bruts
    const vals = clusters.length > 0
      ? clusters.map((c) => c.prix_m2_median).filter(Boolean) as number[]
      : points.map((p) => p.prix_m2).filter(Boolean) as number[];
    if (vals.length === 0) return [2000, 12000] as [number, number];
    const sorted = [...vals].sort((a, b) => a - b);
    // Percentiles P5-P95 pour écarter les extrêmes (outliers comme Pially/Conches)
    return [sorted[Math.floor(sorted.length * 0.05)], sorted[Math.floor(sorted.length * 0.95)]] as [number, number];
  }, [points, clusters]);

  const layers = useMemo(() => {
    if (mode === "heatmap") {
      return [
        new HeatmapLayer<DvfPoint>({
          id: "heatmap",
          data: points,
          getPosition: (d) => [d.lon, d.lat],
          getWeight: (d) => d.prix_m2 ?? 1,
          radiusPixels: 40,
          intensity: 1,
          threshold: 0.1,
          colorRange: [
            [0, 25, 180, 0],
            [0, 150, 255, 200],
            [0, 255, 150, 220],
            [255, 200, 0, 230],
            [255, 60, 0, 240],
            [200, 0, 50, 255],
          ],
        }),
      ];
    }

    if (mode === "clusters") {
      return [
        new ScatterplotLayer<DvfCluster>({
          id: "clusters",
          data: clusters,
          getPosition: (d) => [d.lon, d.lat],
          getRadius: (d) => Math.sqrt(d.count) * 40,
          getFillColor: (d) =>
            colorBy === "rendement"
              ? rendementColor(d.rendement_brut)
              : priceColor(d.prix_m2_median, priceRange[0], priceRange[1]),
          getLineColor: [255, 255, 255, 80],
          lineWidthMinPixels: 1,
          radiusMinPixels: 6,
          radiusMaxPixels: 60,
          pickable: true,
          onHover: (info: PickingInfo) => {
            setHovered(info.object ?? null);
            setCursor(info.object ? "pointer" : "grab");
          },
          onClick: (info: PickingInfo) => {
            if (info.object && onCommuneClick) {
              const cluster = info.object as DvfCluster;
              // cluster_id = "{code_commune}_{type_local}" pour les communes
              const code = cluster.cluster_id.split("_")[0];
              const nom = (cluster as DvfCluster & { nom?: string }).nom ?? code;
              onCommuneClick(code, nom);
            }
          },
        }),
      ];
    }

    return [];
  }, [points, clusters, mode, priceRange, colorBy]);

  const renderTooltip = useCallback(() => {
    if (!hovered) return null;
    const isCluster = "cluster_id" in hovered;

    return (
      <div
        style={{
          position: "fixed",
          top: 16,
          right: 16,
          background: "rgba(10,10,30,0.95)",
          color: "#e8e8f0",
          borderRadius: 10,
          padding: "14px 18px",
          minWidth: 220,
          border: "1px solid rgba(255,255,255,0.12)",
          fontFamily: "Segoe UI, Arial, sans-serif",
          fontSize: 13,
          zIndex: 1000,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        }}
      >
        {isCluster ? (
          <>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: "#00d4ff" }}>
              {(hovered as DvfCluster).nom ?? `Dept. ${(hovered as DvfCluster).dept}`}
            </div>
            <div>{(hovered as DvfCluster).count.toLocaleString("fr-FR")} transactions</div>
            <div style={{ marginTop: 4, color: "#ffdd00", fontWeight: 600 }}>
              {(hovered as DvfCluster).prix_m2_median?.toLocaleString("fr-FR")} €/m² médian
            </div>
            <div style={{ color: "#aaa", marginTop: 4 }}>
              {(hovered as DvfCluster).prix_median?.toLocaleString("fr-FR")} € médian
            </div>
            {(hovered as DvfCluster).loyer_median_m2 != null && (
              <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: 8 }}>
                <div style={{ color: "#88ffcc" }}>
                  Loyer médian : {(hovered as DvfCluster).loyer_median_m2?.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} €/m²/mois
                </div>
                {(hovered as DvfCluster).rendement_brut != null && (
                  <div style={{ color: "#ffaa44", fontWeight: 600, marginTop: 2 }}>
                    Rendement brut : {(hovered as DvfCluster).rendement_brut?.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
              {(hovered as DvfPoint).adresse ?? "Adresse inconnue"}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>
              {(hovered as DvfPoint).valeur_fonciere.toLocaleString("fr-FR")} €
            </div>
            <div style={{ color: "#ffdd00", fontWeight: 600, marginTop: 2 }}>
              {(hovered as DvfPoint).prix_m2?.toLocaleString("fr-FR")} €/m²
            </div>
            <div style={{ color: "#aaa", marginTop: 6, fontSize: 12 }}>
              {(hovered as DvfPoint).type_local} · {(hovered as DvfPoint).surface} m² ·{" "}
              {(hovered as DvfPoint).date_mutation?.slice(0, 7)}
            </div>
            <div style={{ color: "#666", fontSize: 11, marginTop: 2 }}>
              {(hovered as DvfPoint).commune} ({(hovered as DvfPoint).dept})
            </div>
          </>
        )}
      </div>
    );
  }, [hovered]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {isLoading && (
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 999,
            background: "rgba(0,212,255,0.15)",
            border: "1px solid #00d4ff",
            color: "#00d4ff",
            padding: "6px 16px",
            borderRadius: 20,
            fontSize: 12,
            fontFamily: "Segoe UI, sans-serif",
          }}
        >
          Chargement...
        </div>
      )}

      <DeckGL
        initialViewState={INITIAL_VIEW}
        controller={{ dragPan: true, scrollZoom: true, doubleClickZoom: true }}
        layers={layers}
        getCursor={() => cursor}
      >
        <Map
          mapboxAccessToken={MAPBOX_TOKEN}
          mapStyle="mapbox://styles/mapbox/dark-v11"
          reuseMaps
        >
          <NavigationControl position="top-right" />
          <ScaleControl position="bottom-right" />
        </Map>
      </DeckGL>

      {renderTooltip()}

      {/* Légende rendement */}
      {colorBy === "rendement" && mode === "clusters" && (
        <div
          style={{
            position: "absolute",
            bottom: 36,
            left: 12,
            zIndex: 500,
            background: "rgba(10,10,30,0.9)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: "10px 14px",
            fontFamily: "Segoe UI, Arial, sans-serif",
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
            Rendement brut
          </div>
          {[
            { color: "#00ff78", label: "> 7%" },
            { color: "#32dc64", label: "5 – 7%" },
            { color: "#ffa000", label: "3 – 5%" },
            { color: "#ff3c3c", label: "< 3%" },
            { color: "rgba(100,100,120,0.6)", label: "N/A" },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <div style={{ width: 11, height: 11, borderRadius: "50%", background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: "#bbb" }}>{label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
