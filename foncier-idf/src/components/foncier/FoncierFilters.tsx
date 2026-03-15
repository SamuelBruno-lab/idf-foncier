"use client";

export type FoncierFiltersState = {
  insee: string;
  minScore: number;
  minArea: number;
  bestUse: string;
  limit: number;
};

type Props = {
  value: FoncierFiltersState;
  onChange: (value: FoncierFiltersState) => void;
  disabled?: boolean;
};

const VOCATION_OPTIONS = [
  { value: "", label: "Toutes vocations" },
  { value: "densification_residentielle", label: "Residentiel" },
  { value: "mixte_logements_activite", label: "Mixte" },
  { value: "activite_economique", label: "Activite economique" },
  { value: "division_parcellaire", label: "Division parcellaire" },
  { value: "dent_creuse", label: "Dent creuse" },
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
    onChange({ ...value, [key]: nextValue });
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">
          Code INSEE
        </label>
        <input
          type="text"
          value={value.insee}
          onChange={(e) => update("insee", e.target.value)}
          placeholder="92078"
          disabled={disabled}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-400"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">
          Sous-exploitation min
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
        <div className="mt-0.5 text-xs text-neutral-500">Score {value.minScore}/10</div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">
          Surface parcelle min (m²)
        </label>
        <input
          type="number"
          min={0}
          value={value.minArea}
          onChange={(e) => update("minArea", Number(e.target.value))}
          disabled={disabled}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-400"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">
          Vocation
        </label>
        <select
          value={value.bestUse}
          onChange={(e) => update("bestUse", e.target.value)}
          disabled={disabled}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-400"
        >
          {VOCATION_OPTIONS.map((opt) => (
            <option key={opt.value || "all"} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-neutral-600">
          Resultats
        </label>
        <select
          value={value.limit}
          onChange={(e) => update("limit", Number(e.target.value))}
          disabled={disabled}
          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-neutral-400"
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
