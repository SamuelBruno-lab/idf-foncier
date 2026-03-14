"use client";

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

type Props = {
  items: ParcelListItem[];
  loading?: boolean;
  selectedParcelId: string | null;
  onSelectParcel: (parcelId: string) => void;
};

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    maximumFractionDigits: 0,
  }).format(value);
}

const BEST_USE_LABELS: Record<string, string> = {
  densification_residentielle: "Densification résidentielle",
  division_parcellaire: "Division parcellaire",
  dent_creuse: "Dent creuse",
  analyse_complementaire: "Analyse complémentaire",
};

export default function FoncierResultsList({
  items,
  loading = false,
  selectedParcelId,
  onSelectParcel,
}: Props) {
  if (loading) {
    return <div className="p-4 text-sm text-neutral-600">Chargement…</div>;
  }

  if (items.length === 0) {
    return (
      <div className="p-4 text-sm text-neutral-600">
        Aucun résultat pour ces filtres.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="divide-y divide-neutral-100">
        {items.map((item, index) => {
          const selected = item.parcel_id === selectedParcelId;

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
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div
                    className={`text-xs ${
                      selected ? "text-neutral-300" : "text-neutral-500"
                    }`}
                  >
                    #{index + 1} · {item.city_name ?? item.insee_code} · {item.parcel_id}
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    {BEST_USE_LABELS[item.best_use ?? ""] ?? item.best_use ?? "Analyse complémentaire"}
                  </div>
                  <div
                    className={`mt-1 text-xs ${
                      selected ? "text-neutral-300" : "text-neutral-600"
                    }`}
                  >
                    Surface {formatNumber(item.area_m2)} m² · GFA{" "}
                    {formatNumber(item.estimated_gfa)} m²
                  </div>
                </div>

                <div className="text-right">
                  <div className="text-sm font-semibold">
                    {item.mutability_score?.toFixed(1) ?? "—"}/10
                  </div>
                  <div
                    className={`mt-1 text-xs ${
                      selected ? "text-neutral-300" : "text-neutral-600"
                    }`}
                  >
                    {formatCurrency(item.land_value_est)}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
