"use client";

import { useMemo, useState } from "react";
import Map from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { PickingInfo } from "@deck.gl/core";
import "maplibre-gl/dist/maplibre-gl.css";

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
}

interface Props {
  zones: Zone[];
}

const TYPE_COLOR: Record<string, [number, number, number]> = {
  Appartement: [0, 180, 255],
  Maison: [255, 140, 60],
  "Local industriel. commercial ou assimilé": [168, 85, 247],
};

function priceGradient(prix: number | null, min: number, max: number): [number, number, number, number] {
  if (!prix) return [120, 120, 140, 140];
  const t = Math.max(0, Math.min(1, (prix - min) / (max - min || 1)));
  // bleu froid → jaune → rouge chaud
  const stops: [number, number, number][] = [
    [0, 180, 255],
    [0, 220, 120],
    [255, 200, 0],
    [255, 80, 30],
  ];
  const idx = t * (stops.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, stops.length - 1);
  const f = idx - lo;
  return [
    Math.round(stops[lo][0] + f * (stops[hi][0] - stops[lo][0])),
    Math.round(stops[lo][1] + f * (stops[hi][1] - stops[lo][1])),
    Math.round(stops[lo][2] + f * (stops[hi][2] - stops[lo][2])),
    180,
  ];
}

interface TooltipInfo {
  x: number;
  y: number;
  zone: Zone;
}

export default function ZonesMap({ zones }: Props) {
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const types = useMemo(() => [...new Set(zones.map((z) => z.type_local))], [zones]);

  const [activeType, setActiveType] = useState<string | null>(types[0] ?? "Appartement");

  const visibleZones = useMemo(
    () => (activeType ? zones.filter((z) => z.type_local === activeType) : zones),
    [zones, activeType]
  );

  const { centerLon, centerLat } = useMemo(() => {
    const withCoords = zones.filter((z) => z.centroid_lat && z.centroid_lon);
    if (!withCoords.length) return { centerLon: 2.35, centerLat: 48.87 };
    return {
      centerLon: withCoords.reduce((s, z) => s + z.centroid_lon!, 0) / withCoords.length,
      centerLat: withCoords.reduce((s, z) => s + z.centroid_lat!, 0) / withCoords.length,
    };
  }, [zones]);

  const allPrices = zones.map((z) => z.prix_m2_median).filter(Boolean) as number[];
  const minPrix = Math.min(...allPrices);
  const maxPrix = Math.max(...allPrices);

  const geojson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: visibleZones
      .filter((z) => z.hull_coords && z.hull_coords.length >= 3)
      .map((z) => ({
        type: "Feature" as const,
        properties: { ...z },
        geometry: {
          type: "Polygon" as const,
          // hull_coords sont [lat, lon] → GeoJSON attend [lon, lat]
          coordinates: [
            [...z.hull_coords!.map(([lat, lon]) => [lon, lat] as [number, number]),
              [z.hull_coords![0][1], z.hull_coords![0][0]] as [number, number]],
          ],
        },
      })),
  }), [visibleZones]);

  // Zones sans hull_coords valide → affichées comme cercles au centroïde
  const pointZones = useMemo(
    () => visibleZones.filter((z) => (!z.hull_coords || z.hull_coords.length < 3) && z.centroid_lat && z.centroid_lon),
    [visibleZones]
  );

  const layer = new GeoJsonLayer({
    id: "zones",
    data: geojson,
    filled: true,
    stroked: true,
    getFillColor: (f) => {
      const z = f.properties as Zone;
      return priceGradient(z.prix_m2_median, minPrix, maxPrix);
    },
    getLineColor: (f) => {
      const type = (f.properties as Zone).type_local;
      const [r, g, b] = TYPE_COLOR[type] ?? [200, 200, 200];
      return [r, g, b, 220];
    },
    lineWidthMinPixels: 1,
    lineWidthMaxPixels: 2,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 60],
    onHover: (info: PickingInfo) => {
      if (info.object) {
        setTooltip({ x: info.x, y: info.y, zone: info.object.properties as Zone });
      } else {
        setTooltip(null);
      }
    },
  });

  const pointLayer = new ScatterplotLayer<Zone>({
    id: "zones-points",
    data: pointZones,
    getPosition: (z) => [z.centroid_lon!, z.centroid_lat!],
    getRadius: 200,
    radiusMinPixels: 12,
    radiusMaxPixels: 40,
    filled: true,
    stroked: true,
    getFillColor: (z) => priceGradient(z.prix_m2_median, minPrix, maxPrix),
    getLineColor: (z) => {
      const [r, g, b] = TYPE_COLOR[z.type_local] ?? [200, 200, 200];
      return [r, g, b, 220];
    },
    lineWidthMinPixels: 2,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 60],
    onHover: (info: PickingInfo<Zone>) => {
      if (info.object) {
        setTooltip({ x: info.x, y: info.y, zone: info.object });
      } else {
        setTooltip(null);
      }
    },
  });

  const TYPE_LABEL: Record<string, string> = {
    Appartement: "Appartements",
    Maison: "Maisons",
    "Local industriel. commercial ou assimilé": "Locaux",
  };

  return (
    <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
      {/* Filtres par type */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 10,
          display: "flex",
          gap: 6,
        }}
      >
        {types.map((t) => {
          const [r, g, b] = TYPE_COLOR[t] ?? [200, 200, 200];
          return (
            <button
              key={t}
              onClick={() => setActiveType(t)}
              style={{
                padding: "5px 12px",
                borderRadius: 99,
                border: `1px solid rgba(${r},${g},${b},0.5)`,
                background: activeType === t ? `rgba(${r},${g},${b},0.25)` : "rgba(0,0,0,0.6)",
                color: activeType === t ? `rgb(${r},${g},${b})` : "rgba(255,255,255,0.7)",
                fontSize: 11,
                cursor: "pointer",
                fontWeight: activeType === t ? 700 : 400,
                backdropFilter: "blur(8px)",
              }}
            >
              {TYPE_LABEL[t] ?? t}
            </button>
          );
        })}
      </div>

      {/* Légende prix */}
      <div
        style={{
          position: "absolute",
          bottom: 32,
          right: 12,
          zIndex: 10,
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(8px)",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 10,
          color: "rgba(255,255,255,0.6)",
        }}
      >
        <div style={{ marginBottom: 4 }}>Prix médian €/m²</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div
            style={{
              width: 80,
              height: 6,
              borderRadius: 3,
              background: "linear-gradient(90deg, #00b4ff, #00dc78, #ffc800, #ff501e)",
            }}
          />
          <span style={{ fontSize: 9 }}>{minPrix.toLocaleString("fr-FR")} → {maxPrix.toLocaleString("fr-FR")}</span>
        </div>
      </div>

      <DeckGL
        initialViewState={{
          longitude: centerLon,
          latitude: centerLat,
          zoom: 13,
          pitch: 0,
          bearing: 0,
        }}
        controller
        layers={[layer, pointLayer]}
        style={{ height: "420px", position: "relative" }}
      >
        <Map
          mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        />
      </DeckGL>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: "absolute",
            left: Math.min(tooltip.x + 12, 600),
            top: tooltip.y - 10,
            zIndex: 20,
            background: "rgba(10,10,30,0.95)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 12,
            pointerEvents: "none",
            minWidth: 160,
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ fontWeight: 700, color: "#fff", marginBottom: 6 }}>
            Zone {tooltip.zone.cluster_id} — {TYPE_LABEL[tooltip.zone.type_local] ?? tooltip.zone.type_local}
          </div>
          <div style={{ color: "#ffdd00", fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
            {tooltip.zone.prix_m2_median?.toLocaleString("fr-FR")} €/m²
          </div>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>
            {tooltip.zone.prix_m2_p25?.toLocaleString("fr-FR")} – {tooltip.zone.prix_m2_p75?.toLocaleString("fr-FR")} €/m²
          </div>
          <div style={{ color: "#00d4ff", marginTop: 4 }}>
            {tooltip.zone.count} transactions
          </div>
        </div>
      )}
    </div>
  );
}
