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

/** Ligne du bilan promoteur */
function BilanRow({ label, value, bold, green, red, detail }: {
  label: string; value: string; bold?: boolean; green?: boolean; red?: boolean; detail?: string;
}) {
  return (
    <div className={`flex items-baseline justify-between py-1.5 ${bold ? "border-t border-neutral-300 pt-2 font-semibold" : ""}`}>
      <div className={`text-sm ${green ? "text-emerald-700" : red ? "text-red-700" : "text-neutral-700"}`}>
        {label}
        {detail && <span className="ml-1 text-xs text-neutral-400">({detail})</span>}
      </div>
      <div className={`text-sm tabular-nums ${green ? "font-semibold text-emerald-700" : red ? "text-red-700" : bold ? "text-neutral-900" : "text-neutral-700"}`}>
        {value}
      </div>
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

  // Parse explanation_json
  const ej: Record<string, unknown> = (() => {
    const raw = item?.explanation_json;
    if (!raw) return {};
    if (typeof raw === "string") {
      try { return JSON.parse(raw); } catch { return {}; }
    }
    return raw;
  })();

  // Detect missing building data
  const coverageRatio = item?.coverage_ratio ?? (ej.coverage_ratio as number | null) ?? null;
  const hasMissingBuildingData = coverageRatio != null && coverageRatio === 0 && area != null && area > 300;

  const hdbscanZone = item?.hdbscan_zone_id;

  // PLU
  const pluZone = item?.plu_zone_code ?? (ej.plu_zone_code as string | null);
  const vocation = item?.zone_vocation ?? (ej.zone_vocation as string | null);
  const ces = item?.ces_applied ?? (ej.ces_applied as number | null);
  const maxHeight = item?.max_height_est ?? (ej.max_height_est as number | null);
  const setbackFront = item?.setback_front_m ?? (ej.setback_front_m as number | null);
  const setbackSide = item?.setback_side_m ?? (ej.setback_side_m as number | null);

  // Parking & taxe
  const nbLogements = item?.nb_logements_est ?? (ej.nb_logements_est as number | null);
  const nbParking = item?.nb_parking_places ?? (ej.nb_parking_places as number | null);
  const parkingCost = item?.parking_cost ?? (ej.cout_parking as number | null);
  const taxeAmenagement = item?.taxe_amenagement ?? (ej.taxe_amenagement as number | null);
  const taxeTaux = item?.taxe_amenagement_taux ?? (ej.taxe_amenagement_taux as number | null);

  // Bâti existant
  const existingGfa = item?.existing_gfa_est ?? (ej.existing_gfa_est as number | null) ?? null;
  const builtFootprint = item?.built_footprint_m2 ?? (ej.built_footprint_m2 as number | null) ?? null;
  const buildingCount = item?.building_count ?? (ej.building_count as number | null) ?? null;
  // Surface habitable existante estimée (SDP × 0.85 = ratio SDP→SHAB standard)
  const existingSurfaceHab = existingGfa != null ? existingGfa * 0.85 : null;

  // Bilan ICH
  const surfaceHab = (ej.surface_habitable as number | null) ?? (gfa != null ? gfa * 0.75 : null);
  const caTotal = item?.program_value_est ?? (ej.ca_total as number | null);
  const prixLogement = (ej.prix_par_logement as number | null);
  const marge = (ej.marge_promoteur as number | null);
  const coutConstruction = (ej.cout_construction as number | null);
  const coutVrd = (ej.cout_vrd as number | null);
  const coutPublicite = (ej.cout_publicite as number | null);
  const coutDette = (ej.cout_dette as number | null);
  const totalDepenses = (ej.total_depenses as number | null);
  const chargeFonciereM2 = (ej.charge_fonciere_m2_terrain as number | null);

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

      {/* Bâti existant */}
      <div className="mt-4 rounded-2xl border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold">Bati existant</h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <StatCard label="SDP existante" value={existingGfa != null && existingGfa > 0 ? `${formatNumber(existingGfa)} m²` : "0 m²"} />
          <StatCard label="Surface hab. existante" value={existingSurfaceHab != null && existingSurfaceHab > 0 ? `${formatNumber(existingSurfaceHab)} m²` : "0 m²"} />
          <StatCard label="Emprise au sol" value={builtFootprint != null && builtFootprint > 0 ? `${formatNumber(builtFootprint)} m²` : "0 m²"} />
          <StatCard label="Nb batiments" value={buildingCount != null ? `${buildingCount}` : "0"} />
        </div>
        {existingGfa != null && existingGfa > 0 && (
          <div className="mt-2 text-xs text-neutral-400">
            SDP existante estimee = emprise batie × nb niveaux. Surface hab. = SDP × 0.85.
          </div>
        )}
      </div>

      {/* Constructibilité projetée */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatCard label="Surface terrain" value={`${formatNumber(area)} m²`} />
        <StatCard label="SDP max (PLU)" value={`${formatNumber(gfa)} m²`} />
        <StatCard label="Surface hab. projetee" value={`${formatNumber(surfaceHab)} m²`} />
        <StatCard label="Rendement SDP→hab." value="75 %" />
        {!isEconomique && nbLogements != null && (
          <>
            <StatCard label="Logements estimes" value={`${nbLogements}`} />
            {prixLogement != null && <StatCard label="Prix / logement" value={formatCurrency(prixLogement)} />}
          </>
        )}
      </div>

      {/* Règles PLU */}
      <div className="mt-4 rounded-2xl border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold">Regles PLU{pluZone ? ` — Zone ${pluZone}` : ""}</h3>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <StatCard label="Hauteur max" value={maxHeight != null ? `${formatNumber(maxHeight, 1)} m` : "—"} small />
          <StatCard label="CES" value={ces != null ? formatPercent(ces) : "—"} small />
          <StatCard label="Vocation" value={vocation ? (VOCATION_LABELS[vocation] ?? vocation) : "—"} small />
          <StatCard label="Recul voie" value={setbackFront != null ? `${formatNumber(setbackFront, 1)} m` : "—"} small />
          <StatCard label="Prospect" value={setbackSide != null ? `${formatNumber(setbackSide, 1)} m` : "—"} small />
          <StatCard label="Zone" value={item?.dominant_zone_family ?? "—"} small />
        </div>
      </div>

      {/* ═══════════════════════════════════════════ */}
      {/* BILAN PROMOTEUR ICH (compte à rebours)      */}
      {/* ═══════════════════════════════════════════ */}
      <div className="mt-4 rounded-2xl border border-neutral-200 p-4">
        <h3 className="text-sm font-semibold">Bilan promoteur (compte a rebours)</h3>
        <div className="mt-2 text-xs text-neutral-400">Methode ICH — prix max terrain</div>

        <div className="mt-4 space-y-0">
          {/* RECETTES */}
          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-600">Recettes</div>
          <BilanRow
            label="CA total"
            value={formatCurrency(caTotal)}
            green
            bold
            detail={`${formatNumber(surfaceHab)} m² hab × ${formatNumber(item?.median_price_m2)} €/m²`}
          />

          {/* DÉPENSES */}
          <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-red-600">Depenses</div>
          <BilanRow
            label="1. Marge promoteur"
            value={formatCurrency(marge)}
            red
            detail="8 % du CA"
          />
          <BilanRow
            label="2. Construction"
            value={formatCurrency(coutConstruction)}
            detail="1 800 €/m² SDP IDF (hono compris)"
          />
          <BilanRow
            label="3. VRD"
            value={formatCurrency(coutVrd)}
            detail={`100 €/m² terrain (${formatNumber(area)} m²)`}
          />
          <BilanRow
            label="4. Publicite"
            value={formatCurrency(coutPublicite)}
            detail="2,5 % du CA"
          />
          <BilanRow
            label="5. Dette"
            value={formatCurrency(coutDette)}
            detail="6 % × (constr + pub + VRD)"
          />
          <BilanRow
            label="6. Parking souterrain"
            value={formatCurrency(parkingCost)}
            detail={`${nbParking} places × 13 500 €`}
          />
          <BilanRow
            label="7. Taxe amenagement"
            value={formatCurrency(taxeAmenagement)}
            detail={`${formatNumber(gfa)} m² × 854 € × ${taxeTaux != null ? formatPercent(taxeTaux) : "5 %"}`}
          />

          {/* TOTAL DÉPENSES */}
          <BilanRow
            label="Total depenses"
            value={formatCurrency(totalDepenses)}
            bold
            red
          />

          {/* RÉSULTAT */}
          <div className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-neutral-600">Resultat</div>
          <BilanRow
            label="Charge fonciere max"
            value={formatCurrency(landValue)}
            bold
            green={landValue != null && landValue > 0}
            red={landValue != null && landValue <= 0}
          />
          {chargeFonciereM2 != null && (
            <BilanRow
              label="Prix max / m² terrain"
              value={`${formatNumber(chargeFonciereM2)} €/m²`}
              detail={`${formatCurrency(landValue)} ÷ ${formatNumber(area)} m²`}
            />
          )}
        </div>
      </div>

      {/* Sous-exploitation */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <StatCard
          label="Sous-exploitation"
          value={hasMissingBuildingData ? "N/A (bati absent)" : formatPercent(item?.underuse_ratio)}
          warning={hasMissingBuildingData}
        />
        <StatCard
          label="Potentiel residuel"
          value={hasMissingBuildingData ? "A verifier" : `${formatNumber(item?.residual_potential_est)} m²`}
          warning={hasMissingBuildingData}
        />
        <StatCard
          label="Taux emprise (CES reel)"
          value={coverageRatio != null ? formatPercent(coverageRatio) : "—"}
        />
        <StatCard
          label={hdbscanZone ? "Prix micro-zone HDBSCAN" : "Prix median communal"}
          value={item?.median_price_m2 != null ? `${formatNumber(item.median_price_m2)} €/m²` : "—"}
        />
      </div>

      {/* Données techniques */}
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
