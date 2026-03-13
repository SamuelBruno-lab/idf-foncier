"use client";

export type FoncierFiltersState = {
  insee: string;
  minScore: number;
  minArea: number;
  minLandValue: number;
  bestUse: string;
  limit: number;
};

type Props = {
  value: FoncierFiltersState;
  onChange: (value: FoncierFiltersState) => void;
  disabled?: boolean;
};

const BEST_USE_OPTIONS = [
  { value: "", label: "Tous" },
  { value: "densification_residentielle", label: "Densification résidentielle" },
  { value: "division_parcellaire", label: "Division parcellaire" },
  { value: "dent_creuse", label: "Dent creuse" },
  { value: "analyse_complementaire", label: "Analyse complémentaire" },
];

export default function FoncierFilters({
  value,
  onChange,
  disabled = false,
}: Props) {
  function update<K extends keyof FoncierFiltersState>(
    key: K,
    nextValue: FoncierFiltersState[K]
  ) {
    onChange({
      ...value,
      [key]: nextValue,
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-800">
          Code INSEE
        </label>
        <input
          type="text"
          value={value.insee}
          onChange={(e) => update("insee", e.target.value)}
          placeholder="92078"
          disabled={disabled}
          className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none ring-0 transition focus:border-neutral-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-800">
          Score minimum
        </label>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={value.minScore}
          disabled={disabled}
          onChange={(e) => update("minScore", Number(e.target.value))}
          className="w-full"
        />
        <div className="mt-1 text-xs text-neutral-600">{value.minScore}/10</div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-800">
          Surface minimum (m²)
        </label>
        <input
          type="number"
          min={0}
          value={value.minArea}
          onChange={(e) => update("minArea", Number(e.target.value))}
          disabled={disabled}
          className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-800">
          Valeur foncière min (€)
        </label>
        <input
          type="number"
          min={0}
          value={value.minLandValue}
          onChange={(e) => update("minLandValue", Number(e.target.value))}
          disabled={disabled}
          className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-500"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-800">
          Usage suggéré
        </label>
        <select
          value={value.bestUse}
          onChange={(e) => update("bestUse", e.target.value)}
          disabled={disabled}
          className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-500"
        >
          {BEST_USE_OPTIONS.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-800">
          Nombre de résultats
        </label>
        <select
          value={value.limit}
          onChange={(e) => update("limit", Number(e.target.value))}
          disabled={disabled}
          className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-500"
        >
          {[20, 50, 100, 200].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
