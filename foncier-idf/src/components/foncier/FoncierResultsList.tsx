"use client";

import {
  formatNumber,
  computeResidualGfa,
  computeResidualHabitable,
  computeTheoreticalUnits,
  getOperationBadge,
  getBadgeColor,
} from "@/lib/foncier-helpers";

export type ParcelListItem = {
  parcel_id: string;
  insee_code: string;
  city_name?: string | null;
  area_m2: number | null;
  mutability_score: number | null;
  best_use: string | null;
  estimated_gfa: number | null;
  residual_potential_est?: number | null;
  existing_gfa_est?: number | null;
  underuse_ratio?: number | null;
  plu_zone_code?: string | null;
};

type Props = {
  items: ParcelListItem[];
  loading?: boolean;
  selectedParcelId: string | null;
  onSelectParcel: (parcelId: string) => void;
};

export default function FoncierResultsList({
  items,
  loading = false,
  selectedParcelId,
  onSelectParcel,
}: Props) {
  if (loading) {
    return <div className="p-4 text-sm text-neutral-500">Chargement...</div>;
  }

  if (items.length === 0) {
    return (
      <div className="p-4 text-sm text-neutral-500">
        Aucun resultat pour ces filtres.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="divide-y divide-neutral-100">
        {items.map((item, index) => {
          const selected = item.parcel_id === selectedParcelId;

          const residualGfa = computeResidualGfa(item.estimated_gfa, item.existing_gfa_est ?? null);
          const residualHab = computeResidualHabitable(residualGfa);
          const units = computeTheoreticalUnits(residualHab);
          const underusePct = item.underuse_ratio != null
            ? Math.round(item.underuse_ratio * 100)
            : null;
          const badge = getOperationBadge(units);
          const badgeColor = getBadgeColor(badge);

          return (
            <button
              key={item.parcel_id}
              type="button"
              onClick={() => onSelectParcel(item.parcel_id)}
              className={`block w-full px-4 py-3 text-left transition ${
                selected
                  ? "bg-neutral-900 text-white"
                  : "bg-white hover:bg-neutral-50"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div
                    className={`text-xs ${
                      selected ? "text-neutral-300" : "text-neutral-500"
                    }`}
                  >
                    #{index + 1} · {item.city_name ?? item.insee_code}
                  </div>
                  <div className="mt-0.5 text-sm font-medium truncate">
                    {item.parcel_id}
                  </div>
                  <div
                    className={`mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs ${
                      selected ? "text-neutral-300" : "text-neutral-600"
                    }`}
                  >
                    {item.plu_zone_code && (
                      <span>{item.plu_zone_code}</span>
                    )}
                    <span>{formatNumber(item.area_m2)} m²</span>
                    {underusePct != null && (
                      <span className="font-medium">{underusePct}% sous-exploit.</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  {units > 0 && (
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${badgeColor}`}>
                      ~{units} logt
                    </span>
                  )}
                  <span className={`text-xs ${selected ? "text-neutral-300" : "text-neutral-500"}`}>
                    {formatNumber(residualGfa)} m²
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
