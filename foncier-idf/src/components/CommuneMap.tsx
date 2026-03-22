"use client";

import { useState, useCallback, useMemo } from "react";
import Map, { NavigationControl, ScaleControl } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer, GeoJsonLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { PickingInfo } from "@deck.gl/core";
import type { DvfPoint } from "@/types/dvf";
import type { CommuneInfo } from "@/lib/communes-top30";
import {
  buildGoogleStreetViewUrl,
  buildGoogleMapsUrl,
  buildCadastreUrl,
  openExternalUrl,
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
  if (!prix_m2) return [150, 150, 150, 180];
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
    200,
  ];
}

const TYPE_LABEL: Record<string, string> = {
  Appartement: "Appartements",
  Maison: "Maisons",
  "Local industriel. commercial ou assimilé": "Locaux",
};

export default function CommuneMap({ commune, points, zones, showZones, showHeatmap, showPoints, isLoading }: Props) {
  const [hoveredZone, setHoveredZone] = useState<{ x: number; y: number; zone: HdbscanZone } | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<DvfPoint | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<DvfPoint | null>(null);
  const [cursor, setCursor] = useState("grab");
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

  // Build all layers - shown simultaneously based on toggle states
  const layers = useMemo(() => {
    const result: (HeatmapLayer<DvfPoint> | GeoJsonLayer | ScatterplotLayer<HdbscanZone> | ScatterplotLayer<DvfPoint>)[] = [];

    // Layer 1: Heatmap (bottom layer)
    if (showHeatmap && points.length > 0) {
      result.push(
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
      );
    }

    // Layer 2: HDBSCAN zone polygons
    if (showZones && zones.length > 0) {
      result.push(
        new GeoJsonLayer({
          id: "hdbscan-zones",
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
        }),
        new ScatterplotLayer<HdbscanZone>({
          id: "zone-centroids",
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
        }),
      );
    }

    // Layer 3: DVF points (top layer, always clickable)
    if (showPoints && points.length > 0) {
      result.push(
        new ScatterplotLayer<DvfPoint>({
          id: "dvf-points",
          data: points,
          getPosition: (d) => [d.lon, d.lat],
          getRadius: 6,
          radiusUnits: "pixels",
          getFillColor: (d) => priceColor(d.prix_m2, pointPriceRange[0], pointPriceRange[1]),
          getLineColor: [255, 255, 255, 60],
          lineWidthMinPixels: 1,
          pickable: true,
          onHover: (info: PickingInfo) => {
            setHoveredPoint(info.object ?? null);
            setCursor(info.object ? "pointer" : "grab");
          },
          onClick: (info: PickingInfo) => {
            if (info.object) setSelectedPoint(info.object as DvfPoint);
          },
        }),
      );
    }

    return result;
  }, [showZones, showHeatmap, showPoints, points, zones, zonesGeojson, pointPriceRange, zonePriceRange]);

  const renderZoneTooltip = useCallback(() => {
    if (!hoveredZone) return null;
    const z = hoveredZone.zone;
    return (
      <div style={{
        position: "fixed", top: 16, right: 16, zIndex: 1000,
        background: "rgba(10,10,30,0.95)", color: "#e8e8f0",
        borderRadius: 10, padding: "14px 18px", minWidth: 220,
        border: "1px solid rgba(255,255,255,0.12)",
        fontFamily: "Segoe UI, Arial, sans-serif", fontSize: 13,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          <span style={{ color: `rgb(${(TYPE_COLOR[z.type_local] ?? [200,200,200]).join(",")})` }}>
            Zone {z.cluster_id}
          </span>
          <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginLeft: 8 }}>
            {TYPE_LABEL[z.type_local] ?? z.type_local}
          </span>
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#ffdd00", marginBottom: 4 }}>
          {z.prix_m2_median?.toLocaleString("fr-FR")} €/m²
        </div>
        <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>
          {z.prix_m2_p25?.toLocaleString("fr-FR")} – {z.prix_m2_p75?.toLocaleString("fr-FR")} €/m²
        </div>
        <div style={{ color: "#00d4ff", marginTop: 6 }}>
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
        position: "fixed", top: 16, right: 16, zIndex: 1000,
        background: "rgba(10,10,30,0.95)", color: "#e8e8f0",
        borderRadius: 10, padding: "14px 18px", minWidth: 220,
        border: "1px solid rgba(255,255,255,0.12)",
        fontFamily: "Segoe UI, Arial, sans-serif", fontSize: 13,
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
          {hoveredPoint.adresse ?? "Adresse inconnue"}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>
          {hoveredPoint.valeur_fonciere.toLocaleString("fr-FR")} €
        </div>
        <div style={{ color: "#ffdd00", fontWeight: 600, marginTop: 2 }}>
          {hoveredPoint.prix_m2?.toLocaleString("fr-FR")} €/m²
        </div>
        <div style={{ color: "#aaa", marginTop: 6, fontSize: 12 }}>
          {hoveredPoint.type_local} · {hoveredPoint.surface} m² · {hoveredPoint.date_mutation?.slice(0, 7)}
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
        controller={{ dragPan: true, scrollZoom: true, doubleClickZoom: true }}
        layers={layers}
        getCursor={() => cursor}
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
        position: "absolute", bottom: 32, right: 12, zIndex: 10,
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

      {/* Zone count badge */}
      {showZones && zones.length > 0 && (
        <div style={{
          position: "absolute", bottom: 32, left: 12, zIndex: 10,
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
          position: "absolute", bottom: 16, left: 16, zIndex: 1001,
          background: "rgba(10,10,30,0.96)", color: "#e8e8f0",
          borderRadius: 14, padding: "18px 22px",
          minWidth: 280, maxWidth: 340,
          border: "1px solid rgba(0,212,255,0.25)",
          fontFamily: "Segoe UI, Arial, sans-serif", fontSize: 13,
          boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
        }}>
          <button onClick={() => setSelectedPoint(null)} style={{
            position: "absolute", top: 10, right: 12,
            background: "none", border: "none", color: "rgba(255,255,255,0.4)",
            fontSize: 16, cursor: "pointer", lineHeight: 1,
          }}>✕</button>

          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: "#00d4ff", paddingRight: 20 }}>
            {selectedPoint.adresse ?? "Adresse inconnue"}
          </div>
          <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, marginBottom: 12 }}>
            {selectedPoint.commune} ({selectedPoint.dept}) · {selectedPoint.date_mutation?.slice(0, 10)}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.5 }}>Prix</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginTop: 2 }}>
                {selectedPoint.valeur_fonciere.toLocaleString("fr-FR")} €
              </div>
            </div>
            <div style={{ background: "rgba(255,255,255,0.05)", borderRadius: 8, padding: "8px 10px" }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: 0.5 }}>Prix/m²</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#ffdd00", marginTop: 2 }}>
                {selectedPoint.prix_m2?.toLocaleString("fr-FR") ?? "—"} €
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", marginBottom: 14 }}>
            {selectedPoint.type_local ?? "—"} · {selectedPoint.surface ?? "—"} m²
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => openExternalUrl(buildGoogleStreetViewUrl(selectedPoint.lat, selectedPoint.lon))}
              style={{
                padding: "7px 14px", borderRadius: 8,
                border: "1px solid rgba(0,212,255,0.4)", background: "rgba(0,212,255,0.1)",
                color: "#00d4ff", fontSize: 12, fontWeight: 600, cursor: "pointer",
                fontFamily: "Segoe UI, sans-serif",
              }}
            >Voir l&apos;environnement</button>
            <button
              onClick={() => { try { openExternalUrl(buildGoogleMapsUrl(selectedPoint.lat, selectedPoint.lon, selectedPoint.adresse)); } catch { /* noop */ } }}
              style={{
                padding: "7px 14px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 500, cursor: "pointer",
                fontFamily: "Segoe UI, sans-serif",
              }}
            >Google Maps</button>
            <button
              onClick={() => openExternalUrl(buildCadastreUrl(selectedPoint.lat, selectedPoint.lon, selectedPoint.commune))}
              style={{
                padding: "7px 14px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.7)", fontSize: 12, fontWeight: 500, cursor: "pointer",
                fontFamily: "Segoe UI, sans-serif",
              }}
            >Cadastre</button>
          </div>

          <div style={{ marginTop: 10, fontSize: 10, color: "rgba(255,255,255,0.25)" }}>
            Vues fournies par Google Maps et le Geoportail
          </div>
        </div>
      )}
    </div>
  );
}
