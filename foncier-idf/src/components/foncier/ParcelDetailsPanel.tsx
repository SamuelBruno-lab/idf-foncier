"use client";

import type { ParcelDetail } from "@/lib/foncier-types";
import {
  formatNumber,
  computeResidualGfa,
  computeResidualHabitable,
  computeTheoreticalUnits,
  computeDeltaNeufAncien,
  getOperationBadge,
  getBadgeColor,
  PRIX_NEUF_DEFAUT,
} from "@/lib/foncier-helpers";
import LocationActionButtons from "@/components/LocationActionButtons";

type Props = {
  item: ParcelDetail | null;
  loading?: boolean;
  latitude?: number | null;
  longitude?: number | null;
};

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-xs text-neutral-500">{label}</span>
      <span className="text-sm font-medium text-neutral-900">{value}</span>
    </div>
  );
}

const VOCATION_LABELS: Record<string, string> = {
  residentiel: "Residentiel",
  mixte: "Mixte",
  economique: "Economique",
  equipement: "Equipement",
  naturel: "Naturel",
};

export default function ParcelDetailsPanel({ item, loading = false, latitude, longitude }: Props) {
  if (loading) {
    return <div className="p-4 text-sm text-neutral-500">Chargement...</div>;
  }

  if (!item) {
    return (
      <div className="p-4 text-sm text-neutral-500">
        Selectionnez une parcelle pour voir le detail.
      </div>
    );
  }

  // Parse explanation_json for fallback values
  const ej: Record<string, unknown> = (() => {
    const raw = item.explanation_json;
    if (!raw) return {};
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return {}; }
    }
    return raw;
  })();

  const existingGfa = item.existing_gfa_est ?? (ej.existing_gfa_est as number | null) ?? 0;
  const estimatedGfa = item.estimated_gfa ?? (ej.estimated_gfa as number | null) ?? 0;
  const builtFootprint = item.built_footprint_m2 ?? (ej.built_footprint_m2 as number | null) ?? 0;
  const buildingCount = item.building_count ?? (ej.building_count as number | null) ?? 0;
  const underuseRatio = item.underuse_ratio ?? (ej.underuse_ratio as number | null) ?? null;
  const residualPotential = item.residual_potential_est ?? (ej.residual_potential_est as number | null) ?? 0;
  const medianPrice = item.median_price_m2 ?? (ej.median_price_m2 as number | null) ?? null;
  const zoneCode = item.plu_zone_code ?? (ej.plu_zone_code as string | null) ?? null;
  const vocation = item.zone_vocation ?? (ej.zone_vocation as string | null) ?? null;

  // Surface habitable cascade
  const surfaceHabReelle = item.surface_habitable_reelle ?? null;
  const surfaceHabSource = item.surface_hab_source ?? null;
  const dpeCount = item.dpe_count ?? 0;
  const surfaceDvf = item.surface_dvf ?? null;
  const surfaceEstimation = item.surface_estimation ?? null;

  // Calculs derives
  const residualGfa = computeResidualGfa(estimatedGfa, existingGfa);
  const residualHab = computeResidualHabitable(residualGfa);
  const units = computeTheoreticalUnits(residualHab);
  const badge = getOperationBadge(units);
  const badgeColor = getBadgeColor(badge);
  const deltaNeuf = computeDeltaNeufAncien(PRIX_NEUF_DEFAUT, medianPrice);

  const underusePct = underuseRatio != null
    ? `${Math.round(underuseRatio * 100)} %`
    : "—";

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Header + Badge */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold">{item.parcel_id}</div>
          {item.city_name && (
            <div className="text-xs text-neutral-500">{item.city_name}</div>
          )}
        </div>
        {units > 0 && (
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium text-white ${badgeColor}`}>
            {badge}
          </span>
        )}
      </div>

      {/* Bloc 1 — Situation */}
      <div className="rounded-xl border border-neutral-200 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Situation
        </h3>
        <div className="divide-y divide-neutral-100">
          <Row label="Commune" value={item.city_name ?? item.insee_code ?? "—"} />
          <Row label="Zone PLU" value={zoneCode ?? "—"} />
          <Row label="Vocation" value={VOCATION_LABELS[vocation ?? ""] ?? vocation ?? "—"} />
        </div>
      </div>

      {/* Bloc 2 — Existant */}
      <div className="rounded-xl border border-neutral-200 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Existant
        </h3>
        <div className="divide-y divide-neutral-100">
          <Row label="Surface parcelle" value={`${formatNumber(item.area_m2)} m²`} />
          <Row label="SDP existante" value={`${formatNumber(existingGfa)} m²`} />
          <Row label="Emprise batie" value={`${formatNumber(builtFootprint)} m²`} />
          <Row label="Batiments" value={String(buildingCount)} />
        </div>
      </div>

      {/* Bloc 2b — Surface habitable (cascade DPE > DVF > estimation) */}
      {surfaceHabReelle != null && (
        <div className="rounded-xl border border-neutral-200 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Surface habitable
          </h3>
          <div className="divide-y divide-neutral-100">
            <div className="flex items-baseline justify-between py-1.5">
              <span className="text-xs text-neutral-500">Surface habitable</span>
              <span className="text-sm font-bold text-neutral-900">
                {formatNumber(surfaceHabReelle)} m²
              </span>
            </div>
            <div className="flex items-baseline justify-between py-1.5">
              <span className="text-xs text-neutral-500">Source</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                surfaceHabSource === "dpe"
                  ? "bg-green-100 text-green-700"
                  : surfaceHabSource === "dvf"
                    ? "bg-blue-100 text-blue-700"
                    : "bg-neutral-100 text-neutral-500"
              }`}>
                {surfaceHabSource === "dpe"
                  ? `DPE ADEME (${dpeCount} DPE)`
                  : surfaceHabSource === "dvf"
                    ? "DVF (transaction)"
                    : "Estimation BD TOPO"}
              </span>
            </div>
            {surfaceHabSource !== "estimation" && surfaceEstimation != null && surfaceEstimation > 0 && (
              <Row label="Estimation BD TOPO" value={`${formatNumber(surfaceEstimation)} m²`} />
            )}
            {surfaceDvf != null && surfaceDvf > 0 && surfaceHabSource !== "dvf" && (
              <Row label="Surface DVF" value={`${formatNumber(surfaceDvf)} m²`} />
            )}
          </div>
          <div className="mt-2 text-[10px] text-neutral-400">
            {surfaceHabSource === "dpe"
              ? "Donnee reelle issue du DPE (ADEME open data)"
              : surfaceHabSource === "dvf"
                ? "Surface reelle batie de la derniere transaction DVF"
                : "Estimation = SDP existante x 0.85 (pas de DPE ni DVF)"}
          </div>
        </div>
      )}

      {/* Bloc 3 — Potentiel */}
      <div className="rounded-xl border border-neutral-200 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Potentiel
        </h3>
        <div className="divide-y divide-neutral-100">
          <Row label="SDP potentielle" value={`${formatNumber(estimatedGfa)} m²`} />
          <Row label="Potentiel residuel" value={`${formatNumber(residualPotential)} m² SDP`} />
          <Row label="Sous-exploitation" value={underusePct} />
          <Row label="Surface hab. residuelle estimee" value={`${formatNumber(residualHab)} m²`} />
          <Row label="Projection logements" value={units > 0 ? `~${units} logements` : "—"} />
        </div>
        <div className="mt-2 text-[10px] text-neutral-400">
          SHAB = SDP residuelle x 0.85 | 1 logement = 65 m² hab.
        </div>
      </div>

      {/* Bloc 4 — Marche local */}
      <div className="rounded-xl border border-neutral-200 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Marche local
        </h3>
        <div className="divide-y divide-neutral-100">
          <Row
            label="Ancien median (DVF HDBSCAN)"
            value={medianPrice != null ? `${formatNumber(medianPrice)} €/m²` : "—"}
          />
          <Row
            label="Neuf estime"
            value={`${formatNumber(PRIX_NEUF_DEFAUT)} €/m²`}
          />
          {deltaNeuf != null && (
            <Row
              label="Ecart neuf / ancien"
              value={`+${deltaNeuf} %`}
            />
          )}
        </div>
      </div>

      {/* Bloc 5 — Actions terrain */}
      <div className="rounded-xl border border-neutral-200 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Explorer le terrain
        </h3>
        <LocationActionButtons
          lat={latitude}
          lng={longitude}
          city={item.city_name}
        />
        <div className="mt-2 text-[10px] text-neutral-400">
          Vues cartographiques fournies par Google Maps et le Geoportail.
        </div>
      </div>
    </div>
  );
}
