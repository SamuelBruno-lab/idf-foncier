"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Map, { NavigationControl } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { MVTLayer } from "@deck.gl/geo-layers";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import { GeoJsonLayer } from "@deck.gl/layers";

import "maplibre-gl/dist/maplibre-gl.css";

type DvfPoint = {
  lat: number;
  lon: number;
  prix_m2: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GeoJsonFC = { type: "FeatureCollection"; features: any[] };

type Props = {
  selectedParcelId: string | null;
  onSelectParcel: (id: string) => void;
  insee?: string;
  minScore?: number;
};

const INITIAL_VIEW = {
  longitude: 2.335,
  latitude: 48.91,
  zoom: 12,
  pitch: 0,
  bearing: 0,
};

function scoreColor(score: number | null | undefined): [number, number, number, number] {
  if (score == null) return [115, 115, 115, 120];
  if (score >= 8) return [220, 38, 38, 190];
  if (score >= 6) return [234, 88, 12, 180];
  if (score >= 4) return [202, 138, 4, 160];
  return [101, 163, 13, 140];
}

function microZoneColor(prixM2: number | null): [number, number, number, number] {
  if (prixM2 == null) return [150, 150, 150, 60];
  if (prixM2 >= 8000) return [220, 38, 38, 90];
  if (prixM2 >= 5000) return [234, 88, 12, 80];
  if (prixM2 >= 3000) return [202, 138, 4, 70];
  return [16, 185, 129, 65];
}

function microZoneLineColor(prixM2: number | null): [number, number, number, number] {
  if (prixM2 == null) return [150, 150, 150, 180];
  if (prixM2 >= 8000) return [220, 38, 38, 220];
  if (prixM2 >= 5000) return [234, 88, 12, 200];
  if (prixM2 >= 3000) return [202, 138, 4, 190];
  return [16, 185, 129, 180];
}

export default function FoncierMap({
  selectedParcelId,
  onSelectParcel,
  insee,
  minScore = 4,
}: Props) {
  const [hoverInfo, setHoverInfo] = useState<{
    x: number;
    y: number;
    // parcelle hover
    parcel_id?: string;
    score?: number;
    best_use?: string;
    area?: number;
    // micro-zone hover
    zone_nom?: string;
    zone_type?: string;
    zone_prix_m2?: number;
    zone_prix_p25?: number;
    zone_prix_p75?: number;
    zone_count?: number;
  } | null>(null);

  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showMicroZones, setShowMicroZones] = useState(false);
  const [dvfPoints, setDvfPoints] = useState<DvfPoint[]>([]);
  const [microZonesGeoJson, setMicroZonesGeoJson] = useState<GeoJsonFC | null>(null);
  const [loadingDvf, setLoadingDvf] = useState(false);
  const [loadingZones, setLoadingZones] = useState(false);

  // Fetch DVF heatmap data when toggled on
  useEffect(() => {
    if (!showHeatmap || dvfPoints.length > 0) return;

    let cancelled = false;
    setLoadingDvf(true);

    (async () => {
      try {
        const params = new URLSearchParams({ mode: "heatmap", zoom: "14" });
        if (insee) {
          const dept = insee.startsWith("97") ? insee.slice(0, 3) : insee.slice(0, 2);
          params.set("dept", dept);
        }
        const res = await fetch(`/api/dvf/clusters?${params.toString()}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setDvfPoints(json.data ?? []);
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoadingDvf(false);
      }
    })();

    return () => { cancelled = true; };
  }, [showHeatmap, insee, dvfPoints.length]);

  // Fetch HDBSCAN micro-zones when toggled on
  // Loads by commune if insee is set, otherwise by dept derived from insee
  useEffect(() => {
    if (!showMicroZones) return;

    let cancelled = false;
    setLoadingZones(true);

    (async () => {
      try {
        const params = new URLSearchParams();
        if (insee) {
          params.set("insee", insee);
        } else {
          // Default: load 92 (Hauts-de-Seine) as demo
          params.set("dept", "92");
        }
        params.set("limit", "300");

        const res = await fetch(`/api/foncier/hdbscan-zones?${params.toString()}`);
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setMicroZonesGeoJson(json);
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoadingZones(false);
      }
    })();

    return () => { cancelled = true; };
  }, [showMicroZones, insee]);

  const tileUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("minScore", String(minScore));
    if (insee) params.set("insee", insee);
    return `/api/tiles/foncier/{z}/{x}/{y}?${params.toString()}`;
  }, [insee, minScore]);

  const handleClick = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (info: any) => {
      const pid = info?.object?.properties?.parcel_id;
      if (pid) onSelectParcel(pid);
    },
    [onSelectParcel]
  );

  const layers = useMemo(() => {
    const result = [];

    // Layer 1: DVF heatmap (bottom)
    if (showHeatmap && dvfPoints.length > 0) {
      result.push(
        new HeatmapLayer({
          id: "dvf-heatmap",
          data: dvfPoints,
          getPosition: (d: DvfPoint) => [d.lon, d.lat],
          getWeight: (d: DvfPoint) => d.prix_m2 ?? 1,
          radiusPixels: 40,
          intensity: 1.2,
          threshold: 0.1,
          opacity: 0.6,
          colorRange: [
            [65, 182, 196],
            [127, 205, 187],
            [199, 233, 180],
            [237, 248, 177],
            [255, 255, 204],
            [255, 237, 160],
            [254, 217, 118],
            [254, 178, 76],
            [253, 141, 60],
            [240, 59, 32],
          ],
        })
      );
    }

    // Layer 2: HDBSCAN micro-zone polygons (above heatmap, below parcels)
    if (showMicroZones && microZonesGeoJson && microZonesGeoJson.features.length > 0) {
      result.push(
        new GeoJsonLayer({
          id: "hdbscan-micro-zones",
          data: microZonesGeoJson,
          pickable: true,
          filled: true,
          stroked: true,
          lineWidthMinPixels: 2,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getFillColor: (f: any) => microZoneColor(f.properties?.prix_m2_median),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getLineColor: (f: any) => microZoneLineColor(f.properties?.prix_m2_median),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          onHover: (info: any) => {
            if (info?.object?.properties) {
              const p = info.object.properties;
              setHoverInfo({
                x: info.x,
                y: info.y,
                zone_nom: p.nom_commune,
                zone_type: p.type_local,
                zone_prix_m2: p.prix_m2_median,
                zone_prix_p25: p.prix_m2_p25,
                zone_prix_p75: p.prix_m2_p75,
                zone_count: p.count,
              });
            }
          },
        })
      );
    }

    // Layer 3: Parcels MVT (on top)
    result.push(
      new MVTLayer({
        id: "foncier-mvt",
        data: tileUrl,
        minZoom: 10,
        maxZoom: 22,
        pickable: true,
        filled: true,
        stroked: true,
        lineWidthMinPixels: 1,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getFillColor: (f: any) => {
          const score = f?.properties?.score;
          const pid = f?.properties?.parcel_id;
          if (pid && pid === selectedParcelId) {
            return [37, 99, 235, 220] as [number, number, number, number];
          }
          return scoreColor(typeof score === "string" ? Number(score) : score);
        },
        getLineColor: [50, 50, 50, 140] as [number, number, number, number],
        onClick: handleClick,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onHover: (info: any) => {
          if (info?.object?.properties) {
            const p = info.object.properties;
            setHoverInfo({
              x: info.x,
              y: info.y,
              parcel_id: p.parcel_id,
              score: p.score,
              best_use: p.best_use,
              area: p.area,
            });
          } else if (!showMicroZones) {
            setHoverInfo(null);
          }
        },
        updateTriggers: {
          getFillColor: [selectedParcelId],
        },
      })
    );

    return result;
  }, [tileUrl, selectedParcelId, handleClick, showHeatmap, dvfPoints, showMicroZones, microZonesGeoJson]);

  return (
    <div className="relative h-full w-full">
      <DeckGL
        initialViewState={INITIAL_VIEW}
        controller={true}
        layers={layers}
      >
        <Map
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        >
          <NavigationControl position="top-right" />
        </Map>
      </DeckGL>

      {/* Layer toggles */}
      <div className="absolute left-3 top-3 z-10 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => setShowMicroZones(!showMicroZones)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm transition ${
            showMicroZones
              ? "bg-violet-600 text-white"
              : "border border-neutral-200 bg-white/95 text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          {loadingZones ? "Chargement…" : showMicroZones ? "Micro-marchés HDBSCAN" : "Micro-marchés HDBSCAN"}
        </button>
        <button
          type="button"
          onClick={() => setShowHeatmap(!showHeatmap)}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm transition ${
            showHeatmap
              ? "bg-orange-500 text-white"
              : "border border-neutral-200 bg-white/95 text-neutral-700 hover:bg-neutral-50"
          }`}
        >
          {loadingDvf ? "Chargement…" : showHeatmap ? "Heatmap DVF" : "Heatmap DVF"}
        </button>
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 right-4 max-h-[45vh] overflow-y-auto rounded-xl border border-neutral-200 bg-white/95 px-3 py-2 text-xs shadow-sm">
        <div className="mb-1.5 font-medium text-neutral-700">Score mutabilité</div>
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: "rgb(220,38,38)" }} />
            <span>8–10 (fort)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: "rgb(234,88,12)" }} />
            <span>6–8 (moyen)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: "rgb(202,138,4)" }} />
            <span>4–6 (faible)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm" style={{ backgroundColor: "rgb(101,163,13)" }} />
            <span>&lt;4 (très faible)</span>
          </div>
        </div>

        {showMicroZones && (
          <>
            <div className="mb-1 mt-3 border-t border-neutral-200 pt-2 font-medium text-neutral-700">
              Micro-marchés HDBSCAN
            </div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 rounded-sm border" style={{ backgroundColor: "rgba(220,38,38,0.35)", borderColor: "rgb(220,38,38)" }} />
                <span>≥ 8 000 €/m²</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 rounded-sm border" style={{ backgroundColor: "rgba(234,88,12,0.3)", borderColor: "rgb(234,88,12)" }} />
                <span>5 000–8 000</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 rounded-sm border" style={{ backgroundColor: "rgba(202,138,4,0.27)", borderColor: "rgb(202,138,4)" }} />
                <span>3 000–5 000</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-5 rounded-sm border" style={{ backgroundColor: "rgba(16,185,129,0.25)", borderColor: "rgb(16,185,129)" }} />
                <span>&lt; 3 000</span>
              </div>
            </div>
            <div className="mt-1 text-[10px] text-neutral-500">
              Polygones = convex hull des transactions
            </div>
          </>
        )}

        {showHeatmap && (
          <>
            <div className="mb-1 mt-3 border-t border-neutral-200 pt-2 font-medium text-neutral-700">
              Heatmap DVF prix /m²
            </div>
            <div className="flex items-center gap-1">
              <div className="h-2 w-16 rounded-sm" style={{ background: "linear-gradient(90deg, rgb(65,182,196), rgb(254,178,76), rgb(240,59,32))" }} />
              <span className="text-[10px] text-neutral-500">bas → élevé</span>
            </div>
          </>
        )}
      </div>

      {/* Hover tooltip */}
      {hoverInfo && (
        <div
          className="pointer-events-none absolute z-10 max-w-[240px] rounded-xl border border-neutral-200 bg-white/95 px-3 py-2 text-xs shadow-md"
          style={{ left: hoverInfo.x + 12, top: hoverInfo.y - 12 }}
        >
          {hoverInfo.zone_nom ? (
            <>
              <div className="font-semibold text-neutral-900">
                {hoverInfo.zone_nom}
                {hoverInfo.zone_type && (
                  <span className="ml-1 font-normal text-neutral-500">
                    · {hoverInfo.zone_type}
                  </span>
                )}
              </div>
              {hoverInfo.zone_prix_m2 != null && (
                <div className="mt-0.5 text-neutral-600">
                  Prix médian : <span className="font-semibold text-neutral-900">
                    {Math.round(hoverInfo.zone_prix_m2).toLocaleString("fr-FR")} €/m²
                  </span>
                </div>
              )}
              {hoverInfo.zone_prix_p25 != null && hoverInfo.zone_prix_p75 != null && (
                <div className="text-neutral-500">
                  Fourchette : {Math.round(hoverInfo.zone_prix_p25).toLocaleString("fr-FR")} – {Math.round(hoverInfo.zone_prix_p75).toLocaleString("fr-FR")} €/m²
                </div>
              )}
              {hoverInfo.zone_count != null && (
                <div className="text-neutral-500">
                  {hoverInfo.zone_count} transactions DVF
                </div>
              )}
            </>
          ) : (
            <>
              <div className="font-semibold text-neutral-900">{hoverInfo.parcel_id}</div>
              <div className="mt-0.5 text-neutral-600">
                Score : <span className="font-medium text-neutral-900">{hoverInfo.score?.toFixed(1) ?? "—"}/10</span>
              </div>
              {hoverInfo.area != null && (
                <div className="text-neutral-600">
                  Surface : {Math.round(hoverInfo.area).toLocaleString("fr-FR")} m²
                </div>
              )}
              {hoverInfo.best_use && (
                <div className="text-neutral-600">
                  {hoverInfo.best_use.replace(/_/g, " ")}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
