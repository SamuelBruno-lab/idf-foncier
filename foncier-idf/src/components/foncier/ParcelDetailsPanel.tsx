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
  activite_economique: "Activité économique",
  bureaux_commerces: "Bureaux / Commerces",
  mixte_logements_activite: "Mixte logements + activité",
  analyse_complementaire: "Analyse complémentaire",
};

const VOCATION_LABELS: Record<string, string> = {
  residentiel: "Résidentiel",
  economique: "Économique",
  mixte: "Mixte",
};

const VOCATION_COLORS: Record<string, string> = {
  residentiel: "bg-blue-100 text-blue-800",
  economique: "bg-purple-100 text-purple-800",
  mixte: "bg-teal-100 text-teal-800",
};

function StatCard({ label, value, warning, small }: { label: string; value: string; warning?: boolean; small?: boolean }) {
  return (
    <div className={`rounded-2xl border p-3 ${warning ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white"}`}>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`mt-1 font-semibold ${warning ? "text-amber-700" : "text-neutral-900"} ${small ? "text-xs" : "text-sm"}`}>{value}</div>
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

  // Detect missing building data
  const coverageRatio = item?.coverage_ratio ??
    (explanationObj.coverage_ratio as number | null | undefined) ?? null;
  const hasMissingBuildingData = coverageRatio != null && coverageRatio === 0 && area != null && area > 300;

  // HDBSCAN micro-zone info
  const hdbscanZone = item?.hdbscan_zone_id;

  // PLU info
  const pluZone = item?.plu_zone_code;
  const vocation = item?.zone_vocation ?? (explanationObj.zone_vocation as string | null) ?? null;
  const ces = item?.ces_applied ?? (explanationObj.ces_applied as number | null) ?? null;
  const maxHeight = item?.max_height_est ?? (explanationObj.max_height_est as number | null) ?? null;
  const setbackFront = item?.setback_front_m ?? (explanationObj.setback_front_m as number | null) ?? null;
  const setbackSide = item?.setback_side_m ?? (explanationObj.setback_side_m as number | null) ?? null;

  // Parking & taxe
  const nbLogements = item?.nb_logements_est ?? (explanationObj.nb_logements_est as number | null) ?? null;
  const nbParking = item?.nb_parking_places ?? (explanationObj.nb_parking_places as number | null) ?? null;
  const parkingCost = item?.parking_cost ?? (explanationObj.parking_cost as number | null) ?? null;
  const parkingSurface = item?.parking_surface_m2 ?? (explanationObj.parking_surface_m2 as number | null) ?? null;
  const taxeAmenagement = item?.taxe_amenagement ?? (explanationObj.taxe_amenagement as number | null) ?? null;
  const taxeTaux = item?.taxe_amenagement_taux ?? (explanationObj.taxe_amenagement_taux as number | null) ?? null;

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
          {vocation && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${VOCATION_COLORS[vocation] ?? "bg-neutral-100 text-neutral-700"}`}>
              {VOCATION_LABELS[vocation] ?? vocation}
            </span>
          )}
          {pluZone && (
            <span className="rounded-full bg-neutral-200 px-2.5 py-1 text-xs font-medium text-neutral-700">
              PLU {pluZone}
            </span>
          )}
          {item?.city_name ? (
            <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-neutral-700">
              {item.city_name}
            </span>
          ) : null}
        </div>
      </div>

      {/* Warning: zone économique */}
      {isEconomique && (
        <div className="mt-3 rounded-xl border border-purple-300 bg-purple-50 px-4 py-3 text-sm text-purple-800">
          <span className="font-semibold">Zone à vocation économique (PLU).</span>{" "}
          La construction de logements n&apos;est pas autorisée dans cette zone.
          Seuls les projets d&apos;activités, bureaux ou commerces sont envisageables.
        </div>
      )}

      {/* Warning: missing building data */}
      {hasMissingBuildingData && (
        <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Donnees bati manquantes.</span>{" "}
          Le score de sous-exploitation est surestime : aucun batiment detecte
          sur cette parcelle de {formatNumber(area)} m², probablement en raison
          de donnees IGN/cadastre incompletes. Verifier sur le terrain.
        </div>
      )}

      {/* Stats principales */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatCard label="Surface parcelle" value={`${formatNumber(area)} m²`} />
        <StatCard label="SDP potentielle" value={`${formatNumber(gfa)} m²`} />
        <StatCard label="Charge foncière résiduelle" value={formatCurrency(landValue)} />
        <StatCard
          label="CA programme"
          value={formatCurrency(item?.program_value_est)}
        />
      </div>

      {/* Règles PLU */}
      <div className="mt-4 rounded-2xl border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold">Règles PLU{pluZone ? ` — Zone ${pluZone}` : ""}</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatCard
            label="Hauteur max"
            value={maxHeight != null ? `${formatNumber(maxHeight, 1)} m` : "—"}
            small
          />
          <StatCard
            label="Emprise au sol (CES)"
            value={ces != null ? formatPercent(ces) : "—"}
            small
          />
          <StatCard
            label="Recul / voie"
            value={setbackFront != null ? `${formatNumber(setbackFront, 1)} m` : "—"}
            small
          />
          <StatCard
            label="Prospect latéral"
            value={setbackSide != null ? `${formatNumber(setbackSide, 1)} m` : "—"}
            small
          />
          <StatCard
            label="Zone dominante"
            value={item?.dominant_zone_family ?? "—"}
            small
          />
          <StatCard
            label="Vocation PLU"
            value={vocation ? (VOCATION_LABELS[vocation] ?? vocation) : "—"}
            small
          />
        </div>
      </div>

      {/* Bilan parking souterrain */}
      <div className="mt-4 rounded-2xl border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold">Parking souterrain</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {!isEconomique && (
            <StatCard
              label="Logements estimés"
              value={nbLogements != null ? `${nbLogements}` : "—"}
              small
            />
          )}
          <StatCard
            label="Places parking PLU"
            value={nbParking != null ? `${nbParking}` : "—"}
            small
          />
          <StatCard
            label="Surface sous-sol"
            value={parkingSurface != null ? `${formatNumber(parkingSurface)} m² (${nbParking} × 27 m²)` : "—"}
            small
          />
          <StatCard
            label="Coût sous-sol"
            value={parkingCost != null ? `${formatCurrency(parkingCost)} (${nbParking} × 13 500 €)` : "—"}
            small
          />
        </div>
      </div>

      {/* Taxe d'aménagement */}
      <div className="mt-4 rounded-2xl border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold">Taxe d&apos;aménagement</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <StatCard
            label="Valeur forfaitaire IDF"
            value="854 €/m²"
            small
          />
          <StatCard
            label="Taux communal"
            value={taxeTaux != null ? formatPercent(taxeTaux) : "—"}
            small
          />
          <StatCard
            label="SDP taxable"
            value={gfa != null ? `${formatNumber(gfa)} m²` : "—"}
            small
          />
          <StatCard
            label="Montant taxe"
            value={taxeAmenagement != null ? formatCurrency(taxeAmenagement) : "—"}
            small
          />
        </div>
        {gfa != null && taxeTaux != null && (
          <div className="mt-2 text-xs text-neutral-500">
            Calcul : {formatNumber(gfa)} m² × 854 €/m² × {formatPercent(taxeTaux)} = {formatCurrency(taxeAmenagement)}
          </div>
        )}
      </div>

      {/* Sous-exploitation */}
      <div className="mt-4 grid grid-cols-2 gap-3">
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
        <StatCard
          label="Emprise bâtie"
          value={coverageRatio != null ? formatPercent(coverageRatio) : "—"}
        />
      </div>

      {/* Pourquoi cette parcelle ressort */}
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
          {isEconomique && (
            <li className="text-purple-700">Zone à vocation économique — pas de logements autorisés</li>
          )}
          {vocation === "mixte" && (
            <li className="text-teal-700">Zone mixte — logements et activités possibles</li>
          )}
          {pluZone && (
            <li>Sous-zone PLU : {pluZone} — H max {formatNumber(maxHeight, 1)} m, CES {ces != null ? formatPercent(ces) : "—"}</li>
          )}
          {item?.dominant_zone_family === "U" && !pluZone && (
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
          {parkingCost != null && parkingCost > 0 && (
            <li>Coût sous-sol estimé : {formatCurrency(parkingCost)} ({nbParking} places × 13 500 €)</li>
          )}
          {taxeAmenagement != null && taxeAmenagement > 0 && (
            <li>Taxe d&apos;aménagement : {formatCurrency(taxeAmenagement)}</li>
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
