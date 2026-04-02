"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import Map, { NavigationControl, ScaleControl } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer, GeoJsonLayer, TextLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { PickingInfo } from "@deck.gl/core";
import type { DvfPoint } from "@/types/dvf";
import type { CommuneInfo } from "@/lib/communes-top30";
import {
  buildGoogleStreetViewUrl,
  buildGoogleMapsUrl,
  buildCadastreUrl,
  openExternalUrl,
  formatDateFr,
} from "@/lib/location-links";
import "maplibre-gl/dist/maplibre-gl.css";

interface HdbscanZone {
  id: string;
  type_local: string;
  cluster_id: number;
  count: number;
  prix_m2_median: number | null;
  prix_m2_p25: number | null;
  prix_m2_p75: number | null;
  prix_median: number | null;
  hull_coords: [number, number][];
  centroid_lat: number;
  centroid_lon: number;
}

interface Props {
  commune: CommuneInfo;
  points: DvfPoint[];
  zones: HdbscanZone[];
  showZones: boolean;
  showHeatmap: boolean;
  showPoints: boolean;
  isLoading: boolean;
  onPointSelected?: (selected: boolean) => void;
}

const TYPE_COLOR: Record<string, [number, number, number]> = {
  Appartement: [0, 180, 255],
  Maison: [255, 140, 60],
  "Local industriel. commercial ou assimilé": [168, 85, 247],
};

function priceGradient(prix: number | null, min: number, max: number): [number, number, number, number] {
  if (!prix) return [120, 120, 140, 140];
  const t = Math.max(0, Math.min(1, (prix - min) / (max - min || 1)));
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

function priceColor(prix_m2: number | null, min: number, max: number): [number, number, number, number] {
  if (!prix_m2) return [150, 150, 150, 220];
  const t = Math.max(0, Math.min(1, (prix_m2 - min) / (max - min)));
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
  return [
    Math.round(stops[lo][0] + f * (stops[hi][0] - stops[lo][0])),
    Math.round(stops[lo][1] + f * (stops[hi][1] - stops[lo][1])),
    Math.round(stops[lo][2] + f * (stops[hi][2] - stops[lo][2])),
    240,
  ];
}

const TYPE_LABEL: Record<string, string> = {
  Appartement: "Appartements",
  Maison: "Maisons",
  "Local industriel. commercial ou assimilé": "Locaux",
};

export default function CommuneMap({ commune, points, zones, showZones, showHeatmap, showPoints, isLoading, onPointSelected }: Props) {
  const [hoveredZone, setHoveredZone] = useState<{ x: number; y: number; zone: HdbscanZone } | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<DvfPoint | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<DvfPoint | null>(null);
  const [cursor, setCursor] = useState("grab");
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Notify parent when a point is selected/deselected
  useEffect(() => {
    onPointSelected?.(!!selectedPoint);
  }, [selectedPoint, onPointSelected]);

  const controller = useMemo(() => ({ dragPan: true, scrollZoom: true, doubleClickZoom: true }), []);
  const getCursorFn = useCallback(() => cursor, [cursor]);

  const [viewState, setViewState] = useState({
    longitude: commune.lon,
    latitude: commune.lat,
    zoom: 14,
    pitch: 0,
    bearing: 0,
    transitionDuration: 0,
  });

  // Price range for points
  const pointPriceRange = useMemo(() => {
    const vals = points.map((p) => p.prix_m2).filter(Boolean) as number[];
    if (vals.length === 0) return [2000, 12000] as [number, number];
    const sorted = [...vals].sort((a, b) => a - b);
    return [sorted[Math.floor(sorted.length * 0.05)], sorted[Math.floor(sorted.length * 0.95)]] as [number, number];
  }, [points]);

  // Price range for zones
  const zonePriceRange = useMemo(() => {
    const vals = zones.map((z) => z.prix_m2_median).filter(Boolean) as number[];
    if (vals.length === 0) return [2000, 12000] as [number, number];
    return [Math.min(...vals), Math.max(...vals)] as [number, number];
  }, [zones]);

  // GeoJSON for HDBSCAN zones
  const zonesGeojson = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: zones
      .filter((z) => z.hull_coords && z.hull_coords.length >= 3)
      .map((z) => ({
        type: "Feature" as const,
        properties: { ...z },
        geometry: {
          type: "Polygon" as const,
          coordinates: [
            [...z.hull_coords.map(([lat, lon]) => [lon, lat] as [number, number]),
              [z.hull_coords[0][1], z.hull_coords[0][0]] as [number, number]],
          ],
        },
      })),
  }), [zones]);

  // Split layers into separate useMemos so that loading zones doesn't
  // recreate the heatmap/points layers (which triggers GPU re-aggregation
  // in HeatmapLayer and can make dvf-points disappear).
  // FIX: When showPoints is active, hide heatmap — HeatmapLayer's GPU
  // aggregation texture composites ON TOP of ScatterplotLayer regardless
  // of layer order, making points invisible. They use the same data anyway.
  const heatmapLayer = useMemo(() => new HeatmapLayer<DvfPoint>({
    id: "heatmap",
    visible: showHeatmap && !showPoints && points.length > 0,
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
    updateTriggers: {
      getPosition: [],
      getWeight: [],
    },
  }), [showHeatmap, showPoints, points]);

  const zoneLayer = useMemo(() => new GeoJsonLayer({
    id: "hdbscan-zones",
    visible: showZones && zones.length > 0,
    data: zonesGeojson,
    filled: true,
    stroked: true,
    getFillColor: (f) => {
      const z = f.properties as HdbscanZone;
      return priceGradient(z.prix_m2_median, zonePriceRange[0], zonePriceRange[1]);
    },
    getLineColor: (f) => {
      const type = (f.properties as HdbscanZone).type_local;
      const [r, g, b] = TYPE_COLOR[type] ?? [200, 200, 200];
      return [r, g, b, 220];
    },
    lineWidthMinPixels: 2,
    lineWidthMaxPixels: 3,
    pickable: true,
    autoHighlight: true,
    highlightColor: [255, 255, 255, 60],
    onHover: (info: PickingInfo) => {
      if (info.object) {
        setHoveredZone({ x: info.x, y: info.y, zone: info.object.properties as HdbscanZone });
        setCursor("pointer");
      } else {
        setHoveredZone(null);
        setCursor("grab");
      }
    },
    updateTriggers: {
      getFillColor: zonePriceRange,
      getLineColor: [],
    },
  }), [showZones, zones, zonesGeojson, zonePriceRange]);

  const centroidLayer = useMemo(() => new ScatterplotLayer<HdbscanZone>({
    id: "zone-centroids",
    visible: showZones && zones.length > 0,
    data: zones.filter((z) => z.centroid_lat && z.centroid_lon),
    getPosition: (z) => [z.centroid_lon, z.centroid_lat],
    getRadius: (z) => Math.max(6, Math.min(Math.sqrt(z.count) * 2, 20)),
    radiusUnits: "pixels",
    filled: true,
    getFillColor: (z) => priceGradient(z.prix_m2_median, zonePriceRange[0], zonePriceRange[1]),
    getLineColor: [255, 255, 255, 180],
    lineWidthMinPixels: 2,
    pickable: true,
    onHover: (info: PickingInfo<HdbscanZone>) => {
      if (info.object) {
        setHoveredZone({ x: info.x, y: info.y, zone: info.object });
        setCursor("pointer");
      } else {
        setHoveredZone(null);
        setCursor("grab");
      }
    },
    updateTriggers: {
      getFillColor: zonePriceRange,
      getPosition: [],
      getRadius: [],
    },
  }), [showZones, zones, zonePriceRange]);

  const pointsLayer = useMemo(() => new ScatterplotLayer<DvfPoint>({
    id: "dvf-points",
    visible: showPoints && points.length > 0,
    data: points,
    getPosition: (d) => [d.lon, d.lat],
    getRadius: isMobile ? 10 : 8,
    radiusUnits: "pixels",
    filled: true,
    stroked: true,
    getFillColor: (d) => priceColor(d.prix_m2, pointPriceRange[0], pointPriceRange[1]),
    getLineColor: [255, 255, 255, 180],
    lineWidthMinPixels: 2,
    pickable: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parameters: { depthTest: false } as any,
    onHover: (info: PickingInfo) => {
      setHoveredPoint(info.object ?? null);
      setCursor(info.object ? "pointer" : "grab");
    },
    onClick: (info: PickingInfo) => {
      if (info.object) setSelectedPoint(info.object as DvfPoint);
    },
    updateTriggers: {
      getFillColor: pointPriceRange,
      getPosition: [],
    },
  }), [showPoints, points, pointPriceRange, isMobile]);

  // Text labels showing prix/m² on each zone centroid
  const zoneLabelLayer = useMemo(() => new TextLayer<HdbscanZone>({
    id: "zone-labels",
    visible: showZones && zones.length > 0,
    data: zones.filter((z: HdbscanZone) => z.centroid_lat && z.centroid_lon && z.prix_m2_median),
    getPosition: (z: HdbscanZone) => [z.centroid_lon, z.centroid_lat],
    getText: (z: HdbscanZone) => `${Math.round(z.prix_m2_median!).toLocaleString("fr-FR")} €/m²`,
    getSize: 13,
    getColor: [255, 255, 255, 230],
    getTextAnchor: "middle" as const,
    getAlignmentBaseline: "center" as const,
    fontFamily: "Segoe UI, Arial, sans-serif",
    fontWeight: 700,
    outlineWidth: 3,
    outlineColor: [10, 10, 30, 200],
    billboard: false,
    sizeUnits: "pixels" as const,
    pickable: false,
  }), [showZones, zones]);

  const layers = useMemo(
    () => [heatmapLayer, zoneLayer, centroidLayer, pointsLayer, zoneLabelLayer],
    [heatmapLayer, zoneLayer, centroidLayer, pointsLayer, zoneLabelLayer],
  );

  const renderZoneTooltip = useCallback(() => {
    if (!hoveredZone) return null;
    const z = hoveredZone.zone;
    return (
      <div style={{
        position: "fixed", top: isMobile ? 60 : 64, right: isMobile ? 8 : 16, zIndex: 10100,
        background: "rgba(10,10,30,0.95)", color: "#e8e8f0",
        borderRadius: 10, padding: isMobile ? "10px 14px" : "14px 18px",
        minWidth: isMobile ? 180 : 220, maxWidth: isMobile ? "60vw" : "none",
        border: "1px solid rgba(255,255,255,0.12)",
        fontFamily: "Segoe UI, Arial, sans-serif", fontSize: isMobile ? 12 : 13,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>
          <span style={{ color: `rgb(${(TYPE_COLOR[z.type_local] ?? [200,200,200]).join(",")})` }}>
            Zone {z.cluster_id}
          </span>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 10, marginLeft: 6 }}>
            {TYPE_LABEL[z.type_local] ?? z.type_local}
          </span>
        </div>
        <div style={{ fontSize: isMobile ? 17 : 20, fontWeight: 800, color: "#ffdd00", marginBottom: 3 }}>
          {z.prix_m2_median?.toLocaleString("fr-FR")} €/m²
        </div>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>
          {z.prix_m2_p25?.toLocaleString("fr-FR")} – {z.prix_m2_p75?.toLocaleString("fr-FR")} €/m²
        </div>
        <div style={{ color: "#00d4ff", marginTop: 4 }}>
          {z.count} transactions
        </div>
        {z.prix_median && (
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginTop: 2 }}>
            Prix médian : {Math.round(z.prix_median / 1000)}k €
          </div>
        )}
      </div>
    );
  }, [hoveredZone]);

  const renderPointTooltip = useCallback(() => {
    if (!hoveredPoint || hoveredZone) return null;
    return (
      <div style={{
        position: "fixed", top: isMobile ? 60 : 64, right: isMobile ? 8 : 16, zIndex: 10100,
        background: "rgba(10,10,30,0.95)", color: "#e8e8f0",
        borderRadius: 10, padding: isMobile ? "10px 14px" : "14px 18px",
        minWidth: isMobile ? 180 : 220, maxWidth: isMobile ? "60vw" : "none",
        border: "1px solid rgba(255,255,255,0.12)",
        fontFamily: "Segoe UI, Arial, sans-serif", fontSize: isMobile ? 12 : 13,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontWeight: 700, fontSize: isMobile ? 13 : 14, marginBottom: 6 }}>
          {hoveredPoint.adresse ?? "Adresse inconnue"}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>
          {hoveredPoint.valeur_fonciere.toLocaleString("fr-FR")} €
        </div>
        <div style={{ color: "#ffdd00", fontWeight: 600, marginTop: 2 }}>
          {hoveredPoint.prix_m2?.toLocaleString("fr-FR")} €/m²
        </div>
        <div style={{ color: "#aaa", marginTop: 6, fontSize: 12 }}>
          {hoveredPoint.type_local} · {hoveredPoint.surface} m² · {formatDateFr(hoveredPoint.date_mutation)}
        </div>
      </div>
    );
  }, [hoveredPoint, hoveredZone]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {isLoading && (
        <div style={{
          position: "absolute", top: 56, left: "50%", transform: "translateX(-50%)",
          zIndex: 999, background: "rgba(0,212,255,0.15)",
          border: "1px solid #00d4ff", color: "#00d4ff",
          padding: "6px 16px", borderRadius: 20,
          fontSize: 12, fontFamily: "Segoe UI, sans-serif",
        }}>
          Chargement...
        </div>
      )}

      <DeckGL
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs as typeof viewState)}
        controller={controller}
        layers={layers}
        getCursor={getCursorFn}
      >
        <Map
          mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
          reuseMaps
        >
          <NavigationControl position="top-right" />
          <ScaleControl position="bottom-right" />
        </Map>
      </DeckGL>

      {renderZoneTooltip()}
      {renderPointTooltip()}

      {/* Prix/m² legend */}
      <div style={{
        position: "absolute", bottom: isMobile ? 56 : 32, right: 12, zIndex: 10,
        background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
        borderRadius: 8, padding: "8px 12px", fontSize: 10,
        color: "rgba(255,255,255,0.6)",
      }}>
        <div style={{ marginBottom: 4 }}>Prix médian €/m²</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{
            width: 80, height: 6, borderRadius: 3,
            background: "linear-gradient(90deg, #00b4ff, #00dc78, #ffc800, #ff501e)",
          }} />
          <span style={{ fontSize: 9 }}>
            {pointPriceRange[0].toLocaleString("fr-FR")} → {pointPriceRange[1].toLocaleString("fr-FR")}
          </span>
        </div>
        {showZones && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
            {Object.entries(TYPE_COLOR).map(([type, [r, g, b]]) => (
              <div key={type} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: `rgb(${r},${g},${b})`, flexShrink: 0 }} />
                <span>{TYPE_LABEL[type] ?? type}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Point count badge */}
      {showPoints && points.length > 0 && (
        <div style={{
          position: "absolute", bottom: isMobile ? 56 : 32, left: 12, zIndex: 10,
          background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
          borderRadius: 8, padding: "8px 12px", fontSize: 11,
          color: "rgba(255,255,255,0.6)",
        }}>
          <span style={{ fontWeight: 700, color: "#00ff88" }}>{points.length.toLocaleString("fr-FR")}</span> points DVF
        </div>
      )}

      {/* Zone count badge */}
      {showZones && zones.length > 0 && !showPoints && (
        <div style={{
          position: "absolute", bottom: isMobile ? 56 : 32, left: 12, zIndex: 10,
          background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
          borderRadius: 8, padding: "8px 12px", fontSize: 11,
          color: "rgba(255,255,255,0.6)",
        }}>
          <span style={{ fontWeight: 700, color: "#00d4ff" }}>{zones.length}</span> micromarchés
        </div>
      )}

      {/* Detail panel for selected point — with StreetView */}
      {selectedPoint && (
        <div style={{
          position: "absolute",
          bottom: isMobile ? 50 : 16,
          left: isMobile ? 0 : 16,
          right: isMobile ? 0 : "auto",
          zIndex: 10001,
          background: "rgba(10,10,30,0.97)", color: "#e8e8f0",
          borderRadius: isMobile ? "14px 14px 0 0" : 14,
          padding: isMobile ? "16px 16px 12px" : "18px 22px",
          minWidth: isMobile ? "auto" : 280,
          maxWidth: isMobile ? "100%" : 340,
          border: "1px solid rgba(0,212,255,0.25)",
          fontFamily: "Segoe UI, Arial, sans-serif", fontSize: 13,
          boxShadow: "0 -4px 40px rgba(0,0,0,0.7)",
          maxHeight: isMobile ? "50vh" : "auto",
          overflowY: "auto",
        }}>
          <button onClick={() => setSelectedPoint(null)} style={{
            position: "absolute", top: 10, right: 12,
            background: "rgba(255,255,255,0.08)", border: "none", color: "rgba(255,255,255,0.6)",
            fontSize: 18, cursor: "pointer", lineHeight: 1,
            width: 28, height: 28, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>✕</button>

          <div style={{ fontWeight: 700, fontSize: isMobile ? 13 : 14, marginBottom: 4, color: "#00d4ff", paddingRight: 36 }}>
            {selectedPoint.adresse ?? "Adresse inconnue"}
          </div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginBottom: 10 }}>
            {selectedPoint.commune} ({selectedPoint.dept}) · {formatDateFr(selectedPoint.date_mutation)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.5 }}>Prix</div>
              <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 800, color: "#fff", marginTop: 2 }}>
                {selectedPoint.valeur_fonciere.toLocaleString("fr-FR")} €
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.5 }}>Prix/m²</div>
              <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 800, color: "#ffdd00", marginTop: 2 }}>
                {selectedPoint.prix_m2?.toLocaleString("fr-FR") ?? "—"} €
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.6)", marginBottom: 10 }}>
            {selectedPoint.type_local ?? "—"} · {selectedPoint.surface ?? "—"} m²
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => openExternalUrl(buildGoogleStreetViewUrl(selectedPoint.lat, selectedPoint.lon))}
              style={{
                padding: "7px 12px", borderRadius: 8,
                border: "1px solid rgba(0,212,255,0.4)", background: "rgba(0,212,255,0.1)",
                color: "#00d4ff", fontSize: 11, fontWeight: 600, cursor: "pointer",
                fontFamily: "Segoe UI, sans-serif",
              }}
            >Voir l&apos;environnement</button>
            <button
              onClick={() => { try { openExternalUrl(buildGoogleMapsUrl(selectedPoint.lat, selectedPoint.lon, selectedPoint.adresse)); } catch { /* noop */ } }}
              style={{
                padding: "7px 12px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 500, cursor: "pointer",
                fontFamily: "Segoe UI, sans-serif",
              }}
            >Google Maps</button>
            <button
              onClick={() => openExternalUrl(buildCadastreUrl(selectedPoint.lat, selectedPoint.lon, selectedPoint.commune))}
              style={{
                padding: "7px 12px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 500, cursor: "pointer",
                fontFamily: "Segoe UI, sans-serif",
              }}
            >Cadastre</button>
          </div>
        </div>
      )}
    </div>
  );
}
