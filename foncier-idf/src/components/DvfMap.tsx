"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import Map, { NavigationControl, ScaleControl, Marker } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { ScatterplotLayer } from "@deck.gl/layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { PickingInfo } from "@deck.gl/core";
import type { DvfPoint, DvfCluster, DvfFilters } from "@/types/dvf";
import {
  buildGoogleStreetViewUrl,
  buildGoogleMapsUrl,
  buildCadastreUrl,
  openExternalUrl,
  formatDateFr,
} from "@/lib/location-links";
import "maplibre-gl/dist/maplibre-gl.css";

const INITIAL_VIEW = {
  longitude: 2.347,
  latitude: 48.859,
  zoom: 10,
  pitch: 0,
  bearing: 0,
  transitionDuration: 0,
};

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
  onCommuneClick?: (code: string, nom: string) => void;
}

export default function DvfMap({ points, clusters, mode, filters, isLoading, onCommuneClick }: Props) {
  const [hovered, setHovered] = useState<DvfPoint | DvfCluster | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<DvfPoint | null>(null);
  const [cursor, setCursor] = useState("grab");
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPin, setSearchPin] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const [searchStatus, setSearchStatus] = useState<"idle" | "loading" | "notfound">("idle");
  const searchRef = useRef<HTMLInputElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearchStatus("loading");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=fr&limit=1`,
        { headers: { "Accept-Language": "fr" } }
      );
      const data = await res.json();
      if (!data.length) { setSearchStatus("notfound"); setTimeout(() => setSearchStatus("idle"), 2500); return; }
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      const label = data[0].display_name.split(",").slice(0, 2).join(", ");
      setSearchPin({ lat, lon, label });
      setViewState(v => ({ ...v, latitude: lat, longitude: lon, zoom: 15, transitionDuration: 800 }));
      setSearchStatus("idle");
    } catch {
      setSearchStatus("notfound");
      setTimeout(() => setSearchStatus("idle"), 2500);
    }
  }, [searchQuery]);

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
        // Couche de points cliquables par-dessus la heatmap
        new ScatterplotLayer<DvfPoint>({
          id: "points-pickable",
          data: points,
          getPosition: (d) => [d.lon, d.lat],
          getRadius: 6,
          radiusUnits: "pixels",
          getFillColor: [255, 255, 255, 0],
          pickable: true,
          onHover: (info: PickingInfo) => {
            setHovered(info.object ?? null);
            setCursor(info.object ? "pointer" : "grab");
          },
          onClick: (info: PickingInfo) => {
            if (info.object) {
              setSelectedPoint(info.object as DvfPoint);
            }
          },
        }),
      ];
    }

    if (mode === "clusters") {
      return [
        new ScatterplotLayer<DvfCluster>({
          id: "clusters",
          data: clusters,
          getPosition: (d) => [d.lon, d.lat],
          getRadius: (d) => Math.min(Math.max(Math.sqrt(d.count) * 3, 5), 55),
          radiusUnits: "pixels",
          getFillColor: (d) => priceColor(d.prix_m2_median, priceRange[0], priceRange[1]),
          getLineColor: [255, 255, 255, 80],
          lineWidthMinPixels: 1,
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
  }, [points, clusters, mode, priceRange]);

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
              {formatDateFr((hovered as DvfPoint).date_mutation)}
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
      {/* Barre de recherche d'adresse */}
      <div style={{
        position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
        zIndex: 1000, display: "flex", gap: 6, alignItems: "center",
      }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <input
            ref={searchRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Rechercher une adresse..."
            style={{
              width: 260, padding: "8px 40px 8px 14px",
              borderRadius: 20, border: "1px solid rgba(255,255,255,0.18)",
              background: "rgba(10,10,30,0.92)", color: "#e8e8f0",
              fontSize: 13, fontFamily: "Segoe UI, Arial, sans-serif",
              outline: "none", backdropFilter: "blur(8px)",
              boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
            }}
          />
          <button
            onClick={handleSearch}
            style={{
              position: "absolute", right: 6,
              background: "none", border: "none", cursor: "pointer",
              fontSize: 15, color: "#00d4ff", padding: "2px 4px",
            }}
          >
            {searchStatus === "loading" ? "⏳" : "🔍"}
          </button>
        </div>
        {searchStatus === "notfound" && (
          <span style={{ fontSize: 12, color: "#ff6060", background: "rgba(10,10,30,0.9)", padding: "6px 12px", borderRadius: 12 }}>
            Adresse non trouvée
          </span>
        )}
        {searchPin && searchStatus === "idle" && (
          <button
            onClick={() => setSearchPin(null)}
            style={{
              background: "rgba(10,10,30,0.9)", border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.5)", borderRadius: 20, padding: "6px 10px",
              fontSize: 11, cursor: "pointer",
            }}
          >✕ Effacer</button>
        )}
      </div>

      {isLoading && (
        <div
          style={{
            position: "absolute",
            top: 56,
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
        viewState={viewState}
        onViewStateChange={({ viewState: vs }) => setViewState(vs as typeof INITIAL_VIEW)}
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
          {searchPin && (
            <Marker latitude={searchPin.lat} longitude={searchPin.lon} anchor="bottom">
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{
                  background: "rgba(10,10,30,0.92)", color: "#fff", fontSize: 11,
                  padding: "3px 8px", borderRadius: 6, whiteSpace: "nowrap",
                  border: "1px solid rgba(255,255,255,0.2)", marginBottom: 4,
                  maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis",
                }}>
                  {searchPin.label}
                </div>
                <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#ff4444", border: "3px solid #fff", boxShadow: "0 2px 8px rgba(0,0,0,0.5)" }} />
              </div>
            </Marker>
          )}
        </Map>
      </DeckGL>

      {renderTooltip()}

      {/* Panneau détail transaction sélectionnée */}
      {selectedPoint && (
        <div
          style={{
            position: "absolute",
            bottom: isMobile ? 50 : 16,
            left: isMobile ? 0 : 16,
            right: isMobile ? 0 : "auto",
            zIndex: 10001,
            background: "rgba(10,10,30,0.97)",
            color: "#e8e8f0",
            borderRadius: isMobile ? "14px 14px 0 0" : 14,
            padding: isMobile ? "16px 16px 12px" : "18px 22px",
            minWidth: isMobile ? "auto" : 280,
            maxWidth: isMobile ? "100%" : 340,
            border: "1px solid rgba(0,212,255,0.25)",
            fontFamily: "Segoe UI, Arial, sans-serif",
            fontSize: 13,
            boxShadow: "0 -4px 40px rgba(0,0,0,0.7)",
            maxHeight: isMobile ? "50vh" : "auto",
            overflowY: "auto",
          }}
        >
          <button
            onClick={() => setSelectedPoint(null)}
            style={{
              position: "absolute", top: 10, right: 12,
              background: "rgba(255,255,255,0.08)", border: "none", color: "rgba(255,255,255,0.6)",
              fontSize: 18, cursor: "pointer", lineHeight: 1,
              width: 28, height: 28, borderRadius: "50%",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            ✕
          </button>

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
            >
              Voir l&apos;environnement
            </button>
            <button
              onClick={() => {
                try { openExternalUrl(buildGoogleMapsUrl(selectedPoint.lat, selectedPoint.lon, selectedPoint.adresse)); } catch { /* noop */ }
              }}
              style={{
                padding: "7px 12px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 500, cursor: "pointer",
                fontFamily: "Segoe UI, sans-serif",
              }}
            >
              Google Maps
            </button>
            <button
              onClick={() => openExternalUrl(buildCadastreUrl(selectedPoint.lat, selectedPoint.lon, selectedPoint.commune))}
              style={{
                padding: "7px 12px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)",
                color: "rgba(255,255,255,0.7)", fontSize: 11, fontWeight: 500, cursor: "pointer",
                fontFamily: "Segoe UI, sans-serif",
              }}
            >
              Cadastre
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
