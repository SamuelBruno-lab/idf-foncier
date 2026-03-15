"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import FoncierFilters, {
  type FoncierFiltersState,
} from "@/components/foncier/FoncierFilters";
import FoncierResultsList, {
  type ParcelListItem,
} from "@/components/foncier/FoncierResultsList";
import ParcelDetailsPanel from "@/components/foncier/ParcelDetailsPanel";
import FoncierKpiBanner from "@/components/foncier/FoncierKpiBanner";
import type { ParcelDetail } from "@/lib/foncier-types";
import {
  computeResidualGfa,
  computeResidualHabitable,
  computeTheoreticalUnits,
} from "@/lib/foncier-helpers";

const FoncierMap = dynamic(
  () => import("@/components/foncier/FoncierMap"),
  { ssr: false }
);

const DEFAULT_FILTERS: FoncierFiltersState = {
  insee: "92078",
  minScore: 6,
  minArea: 300,
  bestUse: "",
  limit: 50,
};

export default function FoncierPage() {
  const [filters, setFilters] = useState<FoncierFiltersState>(DEFAULT_FILTERS);
  const [results, setResults] = useState<ParcelListItem[]>([]);
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [selectedParcel, setSelectedParcel] = useState<ParcelDetail | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // --- KPI ---
  const kpiItems = useMemo(() => {
    if (results.length === 0) return [];

    const totalResidual = results.reduce(
      (a, r) => a + (r.residual_potential_est ?? 0),
      0
    );

    const avgUnderuse = results.reduce(
      (a, r) => a + (r.underuse_ratio ?? 0),
      0
    ) / results.length;

    const totalUnits = results.reduce((a, r) => {
      const rg = computeResidualGfa(r.estimated_gfa, r.existing_gfa_est ?? null);
      const rh = computeResidualHabitable(rg);
      return a + computeTheoreticalUnits(rh);
    }, 0);

    return [
      { label: "Parcelles", value: String(results.length) },
      {
        label: "Potentiel residuel",
        value:
          totalResidual >= 1_000_000
            ? `${(totalResidual / 1_000_000).toFixed(1)}M m²`
            : totalResidual >= 1_000
            ? `${(totalResidual / 1_000).toFixed(0)}k m²`
            : `${Math.round(totalResidual)} m²`,
      },
      {
        label: "Sous-exploitation moy.",
        value: `${Math.round(avgUnderuse * 100)}%`,
      },
    ];
  }, [results]);

  // --- Fetch list ---
  const fetchResults = useCallback(async (f: FoncierFiltersState) => {
    setLoadingList(true);
    setListError(null);
    try {
      const params = new URLSearchParams();
      if (f.insee) params.set("insee", f.insee);
      params.set("minScore", String(f.minScore));
      params.set("minArea", String(f.minArea));
      if (f.bestUse) params.set("bestUse", f.bestUse);
      params.set("limit", String(f.limit));

      const res = await fetch(`/api/foncier/search?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Erreur chargement");
      const json = await res.json();
      if (json.error) setListError(json.error);
      const items: ParcelListItem[] = json.items ?? [];
      setResults(items);
      setSelectedParcelId((cur) =>
        cur && items.some((i) => i.parcel_id === cur) ? cur : items[0]?.parcel_id ?? null
      );
      if (!items.length) setSelectedParcel(null);
    } catch {
      setListError("Erreur chargement parcelles.");
      setResults([]);
      setSelectedParcelId(null);
      setSelectedParcel(null);
    } finally {
      setLoadingList(false);
    }
  }, []);

  // --- Fetch detail ---
  const fetchDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/foncier/parcelle/${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error("Erreur detail");
      setSelectedParcel(await res.json());
    } catch {
      setDetailError("Erreur chargement detail.");
      setSelectedParcel(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  // --- Effects ---
  useEffect(() => { fetchResults(filters); }, [filters, fetchResults]);
  useEffect(() => { if (selectedParcelId) fetchDetail(selectedParcelId); }, [selectedParcelId, fetchDetail]);

  // --- CSV export ---
  const handleExportCsv = useCallback(() => {
    if (!results.length) return;
    const headers = ["parcel_id", "insee_code", "city_name", "area_m2", "zone", "underuse_pct", "residual_m2", "logements"];
    const rows = results.map((r) => {
      const rg = computeResidualGfa(r.estimated_gfa, r.existing_gfa_est ?? null);
      const rh = computeResidualHabitable(rg);
      const units = computeTheoreticalUnits(rh);
      const up = r.underuse_ratio != null ? Math.round(r.underuse_ratio * 100) : "";
      return [r.parcel_id, r.insee_code, r.city_name ?? "", r.area_m2, r.plu_zone_code ?? "", up, Math.round(rg), units].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",");
    });
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `datamerry-foncier-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [results]);

  return (
    <div className="h-screen w-full bg-neutral-50 text-neutral-900">
      <div className="grid h-full grid-cols-12 gap-4 p-4">
        {/* Gauche : filtres */}
        <aside className="col-span-12 overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-3">
          <div className="mb-4">
            <h1 className="text-lg font-semibold">Radar foncier</h1>
            <p className="mt-0.5 text-xs text-neutral-500">
              Reperer les parcelles sous-exploitees et leur potentiel de densification.
            </p>
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

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={loadingList || results.length === 0}
            className="mt-4 w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-40"
          >
            Exporter CSV
          </button>
        </aside>

        {/* Centre : carte */}
        <section className="col-span-12 flex min-h-0 flex-col rounded-2xl border border-neutral-200 bg-white shadow-sm lg:col-span-5">
          <div className="min-h-0 flex-1">
            <FoncierMap
              selectedParcelId={selectedParcelId}
              onSelectParcel={setSelectedParcelId}
              insee={filters.insee}
              minScore={filters.minScore}
            />
          </div>
        </section>

        {/* Droite : resultats + fiche */}
        <section className="col-span-12 grid min-h-0 grid-rows-[minmax(200px,35%)_1fr] gap-4 lg:col-span-4">
          {/* Liste */}
          <div className="min-h-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <div className="border-b border-neutral-100 px-4 py-2">
              <h2 className="text-sm font-semibold">Resultats</h2>
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
            <div className="border-b border-neutral-100 px-4 py-2">
              <h2 className="text-sm font-semibold">Fiche parcelle</h2>
            </div>
            {detailError ? (
              <div className="p-4 text-sm text-red-600">{detailError}</div>
            ) : (
              <ParcelDetailsPanel
                item={selectedParcel}
                loading={loadingDetail}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
