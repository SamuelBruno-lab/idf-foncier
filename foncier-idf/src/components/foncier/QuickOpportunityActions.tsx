"use client";

type Props = {
  onLoad: (profile: "promoteur" | "marchand") => void;
  onExportCsv: () => void;
  loading?: boolean;
  resultCount?: number;
};

export default function QuickOpportunityActions({
  onLoad,
  onExportCsv,
  loading = false,
  resultCount = 0,
}: Props) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-medium text-neutral-800">
        Actions rapides
      </div>

      <button
        type="button"
        onClick={() => onLoad("promoteur")}
        disabled={loading}
        className="w-full rounded-2xl bg-neutral-900 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            Recherche en cours…
          </span>
        ) : (
          "Trouver 50 terrains mutables en IDF"
        )}
      </button>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onLoad("marchand")}
          disabled={loading}
          className="flex-1 rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Cibles marchand de biens
        </button>

        <button
          type="button"
          onClick={onExportCsv}
          disabled={loading || resultCount === 0}
          className="rounded-2xl border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          CSV
        </button>
      </div>
    </div>
  );
}
