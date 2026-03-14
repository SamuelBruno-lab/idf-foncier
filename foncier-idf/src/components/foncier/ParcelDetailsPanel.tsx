"use client";

import type { ParcelDetail } from "@/lib/foncier-types";

type ParcelListFallback = {
  parcel_id: string;
  insee_code: string;
  area_m2: number | null;
  mutability_score: number | null;
  best_use: string | null;
  land_value_est: number | null;
  estimated_gfa: number | null;
};

type Props = {
  item: ParcelDetail | null;
  fallbackItem?: ParcelListFallback | null;
  loading?: boolean;
};

function formatCurrency(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

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
  const landValue = item?.land_value_est ?? fallbackItem?.land_value_est ?? null;
  const gfa = item?.estimated_gfa ?? fallbackItem?.estimated_gfa ?? null;

  // Parse explanation_json if it's a string (Supabase sometimes returns JSONB as string)
  const explanationObj: Record<string, unknown> = (() => {
    const ej = item?.explanation_json;
    if (!ej) return {};
    if (typeof ej === "string") {
      try { return JSON.parse(ej); } catch { return {}; }
    }
    return ej;
  })();

  // Detect missing building data: coverage_ratio = 0 on a large parcel
  // is almost certainly missing data, not an empty plot
  const coverageRatio = item?.coverage_ratio ??
    (explanationObj.coverage_ratio as number | null | undefined) ?? null;
  const hasMissingBuildingData = coverageRatio != null && coverageRatio === 0 && area != null && area > 300;

  // HDBSCAN micro-zone info
  const hdbscanZone = item?.hdbscan_zone_id;

  return (
    <div className="h-full overflow-y-auto p-4">
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
          {item?.city_name ? (
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-neutral-700">
              {item.city_name}
            </span>
          ) : null}
        </div>
      </div>

      {/* Warning: missing building data */}
      {hasMissingBuildingData && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Donnees bati manquantes.</span>{" "}
          Le score de sous-exploitation est surestime : aucun batiment detecte
          sur cette parcelle de {formatNumber(area)} m², probablement en raison
          de donnees IGN/cadastre incompletes. Verifier sur le terrain.
        </div>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatCard label="Surface parcelle" value={`${formatNumber(area)} m²`} />
        <StatCard label="Potentiel estimé" value={`${formatNumber(gfa)} m²`} />
        <StatCard label="Valeur foncière" value={formatCurrency(landValue)} />
        <StatCard
          label="Valeur programme"
          value={formatCurrency(item?.program_value_est)}
        />
        <StatCard
          label="Zone dominante"
          value={item?.dominant_zone_family ?? "—"}
        />
        <StatCard
          label="Sous-exploitation"
          value={
            hasMissingBuildingData
              ? "N/A (bâti non détecté)"
              : formatPercent(item?.underuse_ratio)
          }
          warning={hasMissingBuildingData}
        />
        <StatCard
          label="Potentiel résiduel"
          value={
            hasMissingBuildingData
              ? "À vérifier"
              : `${formatNumber(item?.residual_potential_est)} m²`
          }
          warning={hasMissingBuildingData}
        />
        <StatCard
          label={hdbscanZone ? "Prix micro-zone HDBSCAN" : "Prix médian communal"}
          value={
            item?.median_price_m2 != null
              ? `${formatNumber(item.median_price_m2)} €/m²`
              : "—"
          }
        />
      </div>

      <div className="mt-4 rounded-2xl border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold">Pourquoi cette parcelle ressort</h3>
        <ul className="mt-3 space-y-2 text-sm text-neutral-700">
          {hasMissingBuildingData ? (
            <li className="text-amber-700">
              Attention : emprise batie = 0 (donnees bati absentes). Le score de
              mutabilite peut etre surestime.
            </li>
          ) : (
            item?.underuse_ratio != null && item.underuse_ratio >= 0.6 && (
              <li>Sous-densité élevée ({formatPercent(item.underuse_ratio)} du potentiel non exploité)</li>
            )
          )}
          {item?.dominant_zone_family === "U" && (
            <li>Zone urbaine (U) — constructibilité favorable</li>
          )}
          {item?.dominant_zone_family === "AU" && (
            <li>Zone à urbaniser (AU) — potentiel de développement</li>
          )}
          {item?.median_price_m2 != null && item.median_price_m2 >= 4500 && (
            <li>Marché local soutenu ({formatNumber(item.median_price_m2)} €/m²)</li>
          )}
          {item?.median_price_m2 != null && item.median_price_m2 < 4500 && item.median_price_m2 >= 2000 && (
            <li>
              Prix local : {formatNumber(item.median_price_m2)} €/m²
              {hdbscanZone ? " (micro-zone HDBSCAN)" : " (médiane communale)"}
            </li>
          )}
          {area != null && area >= 600 && (
            <li>Grande parcelle ({formatNumber(area)} m²)</li>
          )}
          {!hasMissingBuildingData && item?.residual_potential_est != null && item.residual_potential_est >= 500 && (
            <li>Fort potentiel résiduel ({formatNumber(item.residual_potential_est)} m² constructibles)</li>
          )}
        </ul>
      </div>

      {Object.keys(explanationObj).length > 0 ? (
        <div className="mt-4 rounded-2xl border border-neutral-200 p-4">
          <h3 className="text-sm font-semibold">Données techniques</h3>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-neutral-950 p-3 text-xs text-neutral-100">
            {JSON.stringify(explanationObj, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
