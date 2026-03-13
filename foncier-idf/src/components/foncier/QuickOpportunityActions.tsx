"use client";

type Props = {
  onLoad: (profile: "promoteur" | "marchand") => void;
  onExportCsv: () => void;
  loading?: boolean;
};

export default function QuickOpportunityActions({
  onLoad,
  onExportCsv,
  loading = false,
}: Props) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-neutral-800">
        Actions rapides
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onLoad("promoteur")}
          disabled={loading}
          className="rounded-2xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Trouver 50 terrains mutables
        </button>

        <button
          type="button"
          onClick={() => onLoad("marchand")}
          disabled={loading}
          className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cibles marchand de biens
        </button>

        <button
          type="button"
          onClick={onExportCsv}
          disabled={loading}
          className="rounded-2xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Exporter CSV
        </button>
      </div>
    </div>
  );
}
