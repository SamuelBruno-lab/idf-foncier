"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import FoncierFilters, {
  type FoncierFiltersState,
} from "@/components/foncier/FoncierFilters";
import FoncierResultsList from "@/components/foncier/FoncierResultsList";
import ParcelDetailsPanel from "@/components/foncier/ParcelDetailsPanel";
import QuickOpportunityActions from "@/components/foncier/QuickOpportunityActions";
import FoncierKpiBanner from "@/components/foncier/FoncierKpiBanner";

// Load map client-side only (Mapbox + Deck.GL need window)
const FoncierMap = dynamic(
  () => import("@/components/foncier/FoncierMap"),
  { ssr: false }
);

type ParcelListItem = {
  parcel_id: string;
  insee_code: string;
  city_name?: string | null;
  area_m2: number | null;
  mutability_score: number | null;
  best_use: string | null;
  land_value_est: number | null;
  estimated_gfa: number | null;
  residual_potential_est?: number | null;
};

type ParcelDetail = {
  parcel_id: string;
  insee_code: string;
  section: string | null;
  number: string | null;
  area_m2: number | null;
  city_name: string | null;
  mutability_score: number | null;
  best_use: string | null;
  land_value_est: number | null;
  program_value_est: number | null;
  explanation_json: Record<string, unknown> | null;
  dominant_zone_family: string | null;
  estimated_gfa: number | null;
  residual_potential_est: number | null;
  underuse_ratio: number | null;
  median_price_m2: number | null;
};

const DEFAULT_FILTERS: FoncierFiltersState = {
  insee: "92078", // VLG par défaut
  minScore: 6,
  minArea: 200,
  minLandValue: 0,
  bestUse: "",
  limit: 50,
};

function exportRowsToCsv(rows: ParcelListItem[]) {
  if (!rows.length) return;

  const headers = [
    "parcel_id",
    "insee_code",
    "city_name",
    "area_m2",
    "mutability_score",
    "best_use",
    "land_value_est",
    "estimated_gfa",
    "residual_potential_est",
  ];

  const escapeCell = (value: unknown) => {
    if (value == null) return "";
    const str = String(value).replace(/"/g, '""');
    return `"${str}"`;
  };

  const csv = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.parcel_id,
        row.insee_code,
        row.city_name ?? "",
        row.area_m2,
        row.mutability_score,
        row.best_use,
        row.land_value_est,
        row.estimated_gfa,
        row.residual_potential_est ?? "",
      ]
        .map(escapeCell)
        .join(",")
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);

  link.href = url;
  link.setAttribute("download", `datamerry-foncier-${date}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function FoncierPage() {
  const [filters, setFilters] = useState<FoncierFiltersState>(DEFAULT_FILTERS);
  const [results, setResults] = useState<ParcelListItem[]>([]);
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [selectedParcel, setSelectedParcel] = useState<ParcelDetail | null>(null);

  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const selectedListItem = useMemo(
    () => results.find((item) => item.parcel_id === selectedParcelId) ?? null,
    [results, selectedParcelId]
  );

  const kpiItems = useMemo(() => {
    if (results.length === 0) return [];
    const scores = results.map((r) => r.mutability_score ?? 0);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const totalValue = results.reduce((a, r) => a + (r.land_value_est ?? 0), 0);
    const topCount = results.filter((r) => (r.mutability_score ?? 0) >= 8).length;
    return [
      { label: "Score moyen", value: avgScore.toFixed(1) },
      {
        label: "Valeur totale",
        value:
          totalValue >= 1_000_000_000
            ? `${(totalValue / 1_000_000_000).toFixed(1)} Md€`
            : totalValue >= 1_000_000
            ? `${(totalValue / 1_000_000).toFixed(0)} M€`
            : `${(totalValue / 1_000).toFixed(0)} k€`,
      },
      { label: "Score ≥ 8", value: String(topCount) },
    ];
  }, [results]);

  // ---- Fetch results from /api/foncier/search ----
  const fetchResults = useCallback(async (nextFilters: FoncierFiltersState) => {
    setLoadingList(true);
    setListError(null);

    try {
      const params = new URLSearchParams();
      if (nextFilters.insee) params.set("insee", nextFilters.insee);
      params.set("minScore", String(nextFilters.minScore));
      params.set("minArea", String(nextFilters.minArea));
      params.set("minLandValue", String(nextFilters.minLandValue));
      if (nextFilters.bestUse) params.set("bestUse", nextFilters.bestUse);
      params.set("limit", String(nextFilters.limit));

      const res = await fetch(`/api/foncier/search?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error("Impossible de charger les résultats fonciers.");
      }

      const json = await res.json();
      if (json.error) {
        setListError(json.error);
      }
      const items: ParcelListItem[] = json.items ?? [];
      setResults(items);

      if (items.length > 0) {
        setSelectedParcelId((current) =>
          current && items.some((i) => i.parcel_id === current)
            ? current
            : items[0].parcel_id
        );
      } else {
        setSelectedParcelId(null);
        setSelectedParcel(null);
      }
    } catch (error) {
      console.error(error);
      setListError("Erreur lors du chargement des parcelles.");
      setResults([]);
      setSelectedParcelId(null);
      setSelectedParcel(null);
    } finally {
      setLoadingList(false);
    }
  }, []);

  // ---- Fetch parcel detail ----
  const fetchParcelDetail = useCallback(async (parcelId: string) => {
    setLoadingDetail(true);
    setDetailError(null);

    try {
      const res = await fetch(`/api/foncier/parcelle/${parcelId}`, {
        method: "GET",
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error("Impossible de charger le détail parcellaire.");
      }

      const json: ParcelDetail = await res.json();
      setSelectedParcel(json);
    } catch (error) {
      console.error(error);
      setDetailError("Erreur lors du chargement du détail de la parcelle.");
      setSelectedParcel(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // ---- Load opportunities (quick actions) ----
  const loadOpportunities = useCallback(
    async (profile: "promoteur" | "marchand") => {
      setLoadingList(true);
      setListError(null);

      try {
        const params = new URLSearchParams({
          profile,
          limit: "50",
        });

        if (filters.insee) {
          params.set("insee", filters.insee);
        }

        const res = await fetch(`/api/foncier/opportunities?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });

        if (!res.ok) {
          throw new Error("Impossible de charger les opportunités.");
        }

        const json = await res.json();
        const items: ParcelListItem[] = json.items ?? [];

        setResults(items);
        setSelectedParcelId(items[0]?.parcel_id ?? null);
        if (!items.length) setSelectedParcel(null);
      } catch (error) {
        console.error(error);
        setListError("Erreur lors du chargement des opportunités.");
      } finally {
        setLoadingList(false);
      }
    },
    [filters.insee]
  );

  const handleExportCsv = useCallback(() => {
    exportRowsToCsv(results);
  }, [results]);

  // ---- Effects ----
  useEffect(() => {
    fetchResults(filters);
  }, [filters, fetchResults]);

  useEffect(() => {
    if (selectedParcelId) {
      fetchParcelDetail(selectedParcelId);
    }
  }, [selectedParcelId, fetchParcelDetail]);

  return (
    <div className="h-screen w-full bg-neutral-50 text-neutral-900">
      <div className="grid h-full grid-cols-12 gap-4 p-4">
        {/* Colonne gauche : filtres */}
        <aside className="col-span-12 overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-3">
          <div className="mb-4">
            <h1 className="text-xl font-semibold tracking-tight">
              Radar foncier
            </h1>
            <p className="mt-1 text-sm text-neutral-600">
              Détection de parcelles mutables, potentiel constructible et valeur
              foncière estimée.
            </p>
          </div>

          <div className="mb-4">
            <QuickOpportunityActions
              onLoad={loadOpportunities}
              onExportCsv={handleExportCsv}
              loading={loadingList}
              resultCount={results.length}
            />
          </div>

          {kpiItems.length > 0 && (
            <div className="mb-4">
              <FoncierKpiBanner items={kpiItems} />
            </div>
          )}

          <FoncierFilters
            value={filters}
            onChange={setFilters}
            disabled={loadingList}
          />

          <div className="mt-4 rounded-xl bg-neutral-50 p-3 text-xs text-neutral-600">
            <div>
              <span className="font-medium text-neutral-800">Commune :</span>{" "}
              {filters.insee || "N/A"}
            </div>
            <div className="mt-1">
              <span className="font-medium text-neutral-800">Résultats :</span>{" "}
              {results.length}
            </div>
          </div>
        </aside>

        {/* Centre : carte */}
        <section className="col-span-12 flex min-h-0 flex-col rounded-2xl border border-neutral-200 bg-white shadow-sm lg:col-span-5">
          <div className="border-b border-neutral-200 px-4 py-3">
            <h2 className="text-base font-semibold">Carte</h2>
            <p className="text-sm text-neutral-600">
              Vue spatiale des parcelles filtrées.
            </p>
          </div>

          <div className="min-h-0 flex-1">
            <FoncierMap
              selectedParcelId={selectedParcelId}
              onSelectParcel={setSelectedParcelId}
              insee={filters.insee}
              minScore={filters.minScore}
            />
          </div>
        </section>

        {/* Droite : résultats + détail */}
        <section className="col-span-12 grid min-h-0 grid-rows-[minmax(260px,42%)_1fr] gap-4 lg:col-span-4">
          {/* Liste résultats */}
          <div className="min-h-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-200 px-4 py-3">
              <h2 className="text-base font-semibold">Résultats</h2>
              <p className="text-sm text-neutral-600">
                Classement des parcelles selon le score de mutabilité.
              </p>
            </div>

            {listError ? (
              <div className="p-4 text-sm text-red-600">{listError}</div>
            ) : (
              <FoncierResultsList
                items={results}
                loading={loadingList}
                selectedParcelId={selectedParcelId}
                onSelectParcel={setSelectedParcelId}
              />
            )}
          </div>

          {/* Fiche parcelle */}
          <div className="min-h-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-200 px-4 py-3">
              <h2 className="text-base font-semibold">Fiche parcelle</h2>
              <p className="text-sm text-neutral-600">
                Analyse détaillée de la parcelle sélectionnée.
              </p>
            </div>

            {detailError ? (
              <div className="p-4 text-sm text-red-600">{detailError}</div>
            ) : (
              <ParcelDetailsPanel
                item={selectedParcel}
                fallbackItem={selectedListItem}
                loading={loadingDetail}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
