"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Map, { NavigationControl } from "react-map-gl/maplibre";
import DeckGL from "@deck.gl/react";
import { GeoJsonLayer } from "@deck.gl/layers";

import "maplibre-gl/dist/maplibre-gl.css";

type ParcelBBoxItem = {
  parcel_id: string;
  mutability_score: number;
  geojson: Record<string, unknown>;
  land_value_est?: number;
  best_use?: string;
  area_m2?: number;
};

type Props = {
  selectedParcelId: string | null;
  onSelectParcel: (id: string) => void;
  insee?: string;
};

const INITIAL_VIEW = {
  longitude: 2.335,
  latitude: 48.938,
  zoom: 14,
  pitch: 0,
  bearing: 0,
};

function scoreColor(score: number): [number, number, number, number] {
  if (score >= 8) return [153, 27, 27, 180];
  if (score >= 6) return [234, 88, 12, 180];
  if (score >= 4) return [202, 138, 4, 180];
  return [101, 163, 13, 160];
}

export default function FoncierMap({
  selectedParcelId,
  onSelectParcel,
  insee,
}: Props) {
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [features, setFeatures] = useState<ParcelBBoxItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadData = useCallback(async (vs: typeof INITIAL_VIEW) => {
    setLoading(true);
    try {
      // Approximate bbox from viewport center (rough)
      const span = 0.02 / Math.pow(2, Math.max(0, vs.zoom - 13));
      const params = new URLSearchParams({
        minx: (vs.longitude - span).toString(),
        miny: (vs.latitude - span * 0.7).toString(),
        maxx: (vs.longitude + span).toString(),
        maxy: (vs.latitude + span * 0.7).toString(),
        minScore: "4",
        limit: "500",
      });

      const res = await fetch(`/api/foncier/bbox?${params.toString()}`);
      if (!res.ok) return;

      const json = await res.json();
      setFeatures(json.items ?? []);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData(viewState);
  }, [loadData, viewState.zoom]);

  const layer = useMemo(() => {
    const featureCollection = {
      type: "FeatureCollection" as const,
      features: features.map((f) => ({
        type: "Feature" as const,
        geometry: f.geojson as unknown as GeoJSON.Geometry,
        properties: {
          parcel_id: f.parcel_id,
          score: f.mutability_score,
          best_use: f.best_use,
          area_m2: f.area_m2,
          land_value_est: f.land_value_est,
        },
      })),
    };
    return new GeoJsonLayer({
      id: "parcels-foncier",
      data: featureCollection,

      pickable: true,
      stroked: true,
      filled: true,

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      getFillColor: (f: any) => scoreColor(f.properties?.score ?? 0),
      getLineColor: [40, 40, 40, 120] as [number, number, number, number],
      lineWidthMinPixels: 1,

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onClick: (info: any) => {
        if (info.object?.properties?.parcel_id) {
          onSelectParcel(info.object.properties.parcel_id);
        }
      },

      updateTriggers: {
        getFillColor: [features.length],
      },
    });
  }, [features, onSelectParcel]);

  return (
    <div className="relative h-full w-full">
      {loading && (
        <div className="absolute left-3 top-3 z-10 rounded-lg bg-white/80 px-3 py-1.5 text-xs text-neutral-600 shadow-sm">
          Chargement parcelles…
        </div>
      )}
      <DeckGL
        layers={[layer]}
        initialViewState={INITIAL_VIEW}
        controller={true}
        onViewStateChange={({ viewState: vs }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          setViewState(vs as any);
        }}
      >
        <Map
          mapStyle="https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"
        >
          <NavigationControl position="top-right" />
        </Map>
      </DeckGL>
    </div>
  );
}
