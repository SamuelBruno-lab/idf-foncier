"use client";

import { useCallback, useMemo, useState } from "react";
import Map, { NavigationControl } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { MVTLayer } from "@deck.gl/geo-layers";
import { GeoJsonLayer } from "@deck.gl/layers";

import "maplibre-gl/dist/maplibre-gl.css";

type Props = {
  selectedParcelId: string | null;
  onSelectParcel: (id: string) => void;
  insee?: string;
  minScore?: number;
  highlightedParcels?: Array<{
    parcel_id: string;
    geojson?: Record<string, unknown>;
  }>;
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
  if (score >= 8) return [220, 38, 38, 190];  // red-600
  if (score >= 6) return [234, 88, 12, 180];  // orange-600
  if (score >= 4) return [202, 138, 4, 160];  // yellow-600
  return [101, 163, 13, 140];                  // lime-600
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
    parcel_id?: string;
    score?: number;
    best_use?: string;
    area?: number;
    land_value?: number;
  } | null>(null);

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
    const mvt = new MVTLayer({
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
            land_value: p.land_value,
          });
        } else {
          setHoverInfo(null);
        }
      },
      updateTriggers: {
        getFillColor: [selectedParcelId],
      },
    });

    return [mvt];
  }, [tileUrl, selectedParcelId, handleClick]);

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

      {/* Legend */}
      <div className="absolute bottom-4 right-4 rounded-xl border border-neutral-200 bg-white/95 px-3 py-2 text-xs shadow-sm">
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
      </div>

      {/* Hover tooltip */}
      {hoverInfo && (
        <div
          className="pointer-events-none absolute z-10 rounded-xl border border-neutral-200 bg-white/95 px-3 py-2 text-xs shadow-md"
          style={{ left: hoverInfo.x + 12, top: hoverInfo.y - 12 }}
        >
          <div className="font-semibold text-neutral-900">
            {hoverInfo.parcel_id}
          </div>
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
        </div>
      )}
    </div>
  );
}
