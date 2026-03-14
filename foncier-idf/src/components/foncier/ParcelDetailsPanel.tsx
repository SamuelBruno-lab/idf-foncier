"use client";

import type { ParcelDetail } from "@/lib/foncier-types";

type ParcelListFallback = {
  parcel_id: string;
  insee_code: string;
  area_m2: number | null;
  mutability_score: number | null;
  best_use: string | null;
  estimated_gfa: number | null;
};

type Props = {
  item: ParcelDetail | null;
  fallbackItem?: ParcelListFallback | null;
  loading?: boolean;
};

function formatNumber(value: number | null | undefined, digits = 0) {
  if (value == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value == null) return "—";
  return `${(value * 100).toFixed(0)} %`;
}

const BEST_USE_LABELS: Record<string, string> = {
  densification_residentielle: "Densification résidentielle",
  division_parcellaire: "Division parcellaire",
  dent_creuse: "Dent creuse",
  activite_economique: "Activité économique",
  bureaux_commerces: "Bureaux / Commerces",
  mixte_logements_activite: "Mixte logements + activité",
  analyse_complementaire: "Analyse complémentaire",
};

function StatCard({ label, value, warning }: { label: string; value: string; warning?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${warning ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white"}`}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${warning ? "text-amber-700" : "text-neutral-900"}`}>{value}</div>
    </div>
  );
}

export default function ParcelDetailsPanel({
  item,
  fallbackItem,
  loading = false,
}: Props) {
  if (loading) {
    return <div className="p-4 text-sm text-neutral-600">Chargement…</div>;
  }

  if (!item && !fallbackItem) {
    return (
      <div className="p-4 text-sm text-neutral-600">
        Sélectionne une parcelle pour afficher son détail.
      </div>
    );
  }

  const parcelId = item?.parcel_id ?? fallbackItem?.parcel_id ?? "—";
  const score = item?.mutability_score ?? fallbackItem?.mutability_score ?? null;
  const bestUse = item?.best_use ?? fallbackItem?.best_use ?? "—";
  const area = item?.area_m2 ?? fallbackItem?.area_m2 ?? null;
  const gfa = item?.estimated_gfa ?? fallbackItem?.estimated_gfa ?? null;

  // Parse explanation_json
  const ej: Record<string, unknown> = (() => {
    const raw = item?.explanation_json;
    if (!raw) return {};
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return {}; }
    }
    return raw;
  })();

  const coverageRatio = item?.coverage_ratio ?? (ej.coverage_ratio as number | null) ?? null;
  const hasMissingBuildingData = coverageRatio != null && coverageRatio === 0 && area != null && area > 300;

  // Bâti existant
  const existingGfa = item?.existing_gfa_est ?? (ej.existing_gfa_est as number | null) ?? null;
  const buildingCount = item?.building_count ?? (ej.building_count as number | null) ?? null;

  // Sous-exploitation
  const underuseRatio = item?.underuse_ratio ?? (ej.underuse_ratio as number | null) ?? null;
  const residualPotential = item?.residual_potential_est ?? (ej.residual_potential_est as number | null) ?? null;

  // Prix médian
  const medianPrice = item?.median_price_m2 ?? (ej.median_price_m2 as number | null) ?? null;
  const hdbscanZone = item?.hdbscan_zone_id;

  // Vocation
  const vocation = item?.zone_vocation ?? (ej.zone_vocation as string | null);
  const isEconomique = vocation === "economique";

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* Header */}
      <div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
        <div className="text-xs text-neutral-500">Parcelle</div>
        <div className="mt-1 text-lg font-semibold">{parcelId}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium text-white ${
            hasMissingBuildingData ? "bg-amber-500" : "bg-neutral-900"
          }`}>
            Score {score != null ? `${score.toFixed(1)}/10` : "—"}
            {hasMissingBuildingData ? " *" : ""}
          </span>
          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-neutral-700">
            {BEST_USE_LABELS[bestUse] ?? bestUse}
          </span>
          {item?.city_name && (
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-neutral-700">
              {item.city_name}
            </span>
          )}
        </div>
      </div>

      {/* Warnings */}
      {isEconomique && (
        <div className="mt-3 rounded-xl border border-purple-300 bg-purple-50 px-4 py-3 text-sm text-purple-800">
          <span className="font-semibold">Zone economique (PLU).</span>{" "}
          Pas de logements autorises. Activites, bureaux ou commerces uniquement.
        </div>
      )}
      {hasMissingBuildingData && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Bati manquant.</span>{" "}
          Aucun batiment detecte sur {formatNumber(area)} m². Score potentiellement surestime.
        </div>
      )}

      {/* Sous-exploitation — bloc principal */}
      <div className="mt-4 rounded-2xl border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold">Sous-exploitation</h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <StatCard
            label="Sous-exploitation"
            value={hasMissingBuildingData ? "N/A (bati absent)" : formatPercent(underuseRatio)}
            warning={hasMissingBuildingData}
          />
          <StatCard
            label="Potentiel residuel"
            value={hasMissingBuildingData ? "A verifier" : `${formatNumber(residualPotential)} m² SDP`}
            warning={hasMissingBuildingData}
          />
          <StatCard label="SDP max (PLU)" value={`${formatNumber(gfa)} m²`} />
          <StatCard label="SDP existante" value={existingGfa != null && existingGfa > 0 ? `${formatNumber(existingGfa)} m²` : "0 m²"} />
          <StatCard label="Surface terrain" value={`${formatNumber(area)} m²`} />
          <StatCard label="Nb batiments" value={buildingCount != null ? `${buildingCount}` : "0"} />
        </div>
        {existingGfa != null && existingGfa > 0 && (
          <div className="mt-2 text-xs text-neutral-400">
            Sous-exploitation = 1 - (SDP existante / SDP max PLU). Potentiel residuel = SDP max - SDP existante.
          </div>
        )}
      </div>

      {/* Prix médian DVF */}
      <div className="mt-4 rounded-2xl border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold">Prix median DVF</h3>
        <div className="mt-3 grid grid-cols-1 gap-3">
          <StatCard
            label={hdbscanZone ? "Prix micro-zone HDBSCAN" : "Prix median communal"}
            value={medianPrice != null ? `${formatNumber(medianPrice)} €/m²` : "—"}
          />
        </div>
        {hdbscanZone && (
          <div className="mt-2 text-xs text-neutral-400">
            Zone HDBSCAN : {hdbscanZone}
          </div>
        )}
      </div>

      {/* Données techniques (JSON brut) */}
      {Object.keys(ej).length > 0 && (
        <div className="mt-4 rounded-2xl border border-neutral-200 p-4">
          <h3 className="text-sm font-semibold">Donnees techniques</h3>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-neutral-950 p-3 text-xs text-neutral-100">
            {JSON.stringify(ej, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
