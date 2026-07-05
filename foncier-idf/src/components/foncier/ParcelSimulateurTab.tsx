"use client";

/**
 * Simulateur de prefaisabilite interactif (Phase 2c) -- pattern repris de
 * RevenueSimulator.tsx (src/app/eurealimmo-reseau/) : useState pour les
 * inputs, useMemo pour le recalcul, 100% cote client (aucun appel reseau
 * pendant l'interaction avec un slider/input -- seul le montage initial
 * fait 2 appels : gating par scenario + donnees de prefaisabilite).
 *
 * Les hypotheses financieres par defaut sont le miroir TypeScript de
 * dim_bilan_promoteur_hypotheses (sql/75) -- BILAN_PROMOTEUR_HYPOTHESES_DEFAUT.
 * Un ecart entre les deux devra etre resynchronise manuellement si les
 * valeurs par defaut de la table evoluent en base.
 */

import { useEffect, useMemo, useState } from "react";
import type { ParcelDetail } from "@/lib/foncier-types";
import { PRIX_NEUF_DEFAUT } from "@/lib/foncier-helpers";
import {
  calculerBilanPromoteur,
  BILAN_PROMOTEUR_HYPOTHESES_DEFAUT,
  type ModeVente,
} from "@/lib/foncier/bilan-promoteur";
import {
  calculerCashflowInvestisseur,
  type RendementHypotheses,
} from "@/lib/foncier/cashflow-investisseur";
import { calculerStrategieMixte } from "@/lib/foncier/strategie-mixte";
import {
  computeLargestInscribedRectangle,
  extractLargestRing,
  type RectangleInscrit,
} from "@/lib/foncier/enveloppe-batiment";

type ScenarioType =
  | "demolition_reconstruction"
  | "surelevation"
  | "construction_neuve_meme_parcelle"
  | "changement_usage"
  | "strategie_mixte";

type Profil = "promoteur" | "investisseur" | "mixte";

const SCENARIOS: { type: ScenarioType; label: string }[] = [
  { type: "demolition_reconstruction", label: "Demolition-reconstruction" },
  { type: "surelevation", label: "Surelevation" },
  { type: "construction_neuve_meme_parcelle", label: "2e batiment" },
  { type: "changement_usage", label: "Changement d'usage" },
  { type: "strategie_mixte", label: "Strategie mixte" },
];

type GatingResult = { gating_ok: boolean; reasons?: Record<string, unknown> };

type Prefaisabilite = {
  parcel_id: string;
  height_existing_m: number | null;
  height_existing_source: string | null;
  setback_facade_existing_m: number | null;
  setback_lateral_existing_m: number | null;
  setback_fond_existing_m: number | null;
  nb_facades: number | null;
  setback_side_min_m_worst_case: number | null;
  setback_rear_min_m_worst_case: number | null;
  setback_plu_is_range: boolean;
  surelevation_possible_hauteur: boolean;
  extension_possible_ces: boolean;
};

function formatEur(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

const RENDEMENT_HYPOTHESES_DEFAUT: RendementHypotheses = {
  vacancePct: 5,
  chargesPct: 15,
  taxeFoncierePct: 8,
};

export default function ParcelSimulateurTab({
  parcelId,
  item,
}: {
  parcelId: string;
  item: ParcelDetail | null;
}) {
  const [scenarioType, setScenarioType] = useState<ScenarioType>("surelevation");
  const [profil, setProfil] = useState<Profil>("promoteur");

  const [gating, setGating] = useState<Record<ScenarioType, GatingResult | null>>(
    {} as Record<ScenarioType, GatingResult | null>
  );
  const [prefaisabilite, setPrefaisabilite] = useState<Prefaisabilite | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [batimentFantome, setBatimentFantome] = useState<RectangleInscrit | null>(null);
  const [enveloppeAireM2, setEnveloppeAireM2] = useState<number | null>(null);
  const [loadingFantome, setLoadingFantome] = useState(true);

  // Inputs bilan promoteur
  const [prixNeufEurM2, setPrixNeufEurM2] = useState(PRIX_NEUF_DEFAUT);
  const [coutConstructionEurM2, setCoutConstructionEurM2] = useState(
    BILAN_PROMOTEUR_HYPOTHESES_DEFAUT.coutConstructionEurM2Defaut
  );
  const [modeVente, setModeVente] = useState<ModeVente>("bloc");
  const [inclutDemolition, setInclutDemolition] = useState(false);
  const [coutDepollutionEurM2, setCoutDepollutionEurM2] = useState<string>("");

  // Inputs investisseur / stratégie mixte
  const [loyerMensuelEur, setLoyerMensuelEur] = useState(1200);
  const [prixAchatEur, setPrixAchatEur] = useState(300000);
  const [dureeAnnees, setDureeAnnees] = useState(10);

  useEffect(() => {
    let cancelled = false;
    setLoadingContext(true);

    Promise.all([
      fetch(`/api/foncier/prefaisabilite/${parcelId}`).then((r) => (r.ok ? r.json() : null)),
      ...SCENARIOS.map((s) =>
        fetch(`/api/foncier/scenario-gating?parcel_id=${parcelId}&scenario_type=${s.type}`).then(
          (r) => (r.ok ? r.json() : null)
        )
      ),
    ]).then(([pref, ...gatingResults]) => {
      if (cancelled) return;
      setPrefaisabilite(pref);
      const g: Record<ScenarioType, GatingResult | null> = {} as Record<
        ScenarioType,
        GatingResult | null
      >;
      SCENARIOS.forEach((s, i) => {
        g[s.type] = gatingResults[i];
      });
      setGating(g);
      setLoadingContext(false);
    });

    return () => {
      cancelled = true;
    };
  }, [parcelId]);

  // Batiment fantome : enveloppe constructible (sql/76, erosion cote par
  // cote par les vrais reculs) + rectangle inscrit optimal (heuristique,
  // src/lib/foncier/enveloppe-batiment.ts) -- calcul fait une seule fois au
  // montage (ne depend pas des sliders du bilan financier), affiche comme
  // "positionnement" concret plutot qu'un simple chiffre de surface.
  useEffect(() => {
    let cancelled = false;
    setLoadingFantome(true);

    fetch(`/api/foncier/enveloppe-constructible/${parcelId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { geojson?: { type: string; coordinates: unknown }; area_m2?: number } | null) => {
        if (cancelled) return;
        if (!data?.geojson) {
          setBatimentFantome(null);
          setEnveloppeAireM2(null);
          return;
        }
        setEnveloppeAireM2(data.area_m2 ?? null);
        const ring = extractLargestRing(data.geojson);
        setBatimentFantome(ring ? computeLargestInscribedRectangle(ring) : null);
      })
      .catch(() => {
        if (!cancelled) {
          setBatimentFantome(null);
          setEnveloppeAireM2(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingFantome(false);
      });

    return () => {
      cancelled = true;
    };
  }, [parcelId]);

  // Emprise à demolir par défaut = emprise batie existante
  const empriseADemolirM2 = item?.built_footprint_m2 ?? 0;

  // Niveaux/CES par scenario -- determines comment le bilan promoteur est
  // parametre selon ce qui est effectivement construit dans ce scenario.
  const parametresConstruction = useMemo(() => {
    const surfaceTerrain = item?.area_m2 ?? 0;
    const cesApplique = item?.ces_applied ?? 0;
    const cesExistant = item?.coverage_ratio ?? 0;
    const hauteurMaxPlu = item?.max_height_est ?? null;
    const hauteurExistante = prefaisabilite?.height_existing_m ?? null;
    const niveauxPlu = hauteurMaxPlu != null ? Math.max(1, Math.floor(hauteurMaxPlu / 3)) : 3;

    switch (scenarioType) {
      case "demolition_reconstruction":
        return { surfaceTerrainM2: surfaceTerrain, cesReference: cesApplique, niveaux: niveauxPlu };
      case "construction_neuve_meme_parcelle":
        return {
          surfaceTerrainM2: surfaceTerrain,
          cesReference: Math.max(0, cesApplique - cesExistant),
          niveaux: niveauxPlu,
        };
      case "surelevation":
      case "strategie_mixte": {
        // Strategie mixte : par defaut, l'ajout se fait par surelevation
        // (garder l'emprise batie existante, ajouter des niveaux) --
        // dimensionnement identique au scenario surelevation seul.
        const niveauxAjoutes =
          hauteurMaxPlu != null && hauteurExistante != null
            ? Math.max(1, Math.floor((hauteurMaxPlu - hauteurExistante) / 3))
            : 1;
        return {
          surfaceTerrainM2: item?.built_footprint_m2 ?? 0,
          cesReference: 1, // on reconstruit sur l'emprise batie existante, pas la parcelle entiere
          niveaux: niveauxAjoutes,
        };
      }
      default:
        return { surfaceTerrainM2: surfaceTerrain, cesReference: cesApplique, niveaux: niveauxPlu };
    }
  }, [scenarioType, item, prefaisabilite]);

  const bilanInput = useMemo(
    () => ({
      ...parametresConstruction,
      prixNeufEurM2,
      coutConstructionEurM2,
      modeVente,
      inclutDemolition: scenarioType === "demolition_reconstruction" ? true : inclutDemolition,
      empriseADemolirM2:
        scenarioType === "demolition_reconstruction" ? empriseADemolirM2 : undefined,
      coutDepollutionEurM2: coutDepollutionEurM2 === "" ? undefined : Number(coutDepollutionEurM2),
      hypotheses: BILAN_PROMOTEUR_HYPOTHESES_DEFAUT,
    }),
    [
      parametresConstruction,
      prixNeufEurM2,
      coutConstructionEurM2,
      modeVente,
      inclutDemolition,
      empriseADemolirM2,
      coutDepollutionEurM2,
      scenarioType,
    ]
  );

  const cashflowInput = useMemo(
    () => ({
      loyerMensuelEur,
      prixAchatEur,
      hypotheses: RENDEMENT_HYPOTHESES_DEFAUT,
      dureeAnnees,
    }),
    [loyerMensuelEur, prixAchatEur, dureeAnnees]
  );

  const resultat = useMemo(() => {
    if (scenarioType === "changement_usage") return null; // pas de construction neuve, cf. note UI
    if (profil === "investisseur") {
      return { type: "cashflow" as const, data: calculerCashflowInvestisseur(cashflowInput) };
    }
    if (scenarioType === "strategie_mixte" || profil === "mixte") {
      const scenarioAjoute =
        scenarioType === "construction_neuve_meme_parcelle"
          ? "construction_neuve_meme_parcelle"
          : "surelevation";
      return {
        type: "mixte" as const,
        data: calculerStrategieMixte({
          partieConservee: cashflowInput,
          partieAjoutee: { scenarioType: scenarioAjoute, bilanInput },
        }),
      };
    }
    return { type: "bilan" as const, data: calculerBilanPromoteur(bilanInput) };
  }, [scenarioType, profil, bilanInput, cashflowInput]);

  const gatingActuel = gating[scenarioType];

  return (
    <div className="space-y-4">
      {/* Sélecteur de scénario */}
      <div className="rounded-xl border border-neutral-200 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Scenario
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {SCENARIOS.map((s) => {
            const g = gating[s.type];
            const disabled = loadingContext || (g != null && !g.gating_ok);
            const selected = scenarioType === s.type;
            return (
              <button
                key={s.type}
                type="button"
                disabled={disabled}
                onClick={() => setScenarioType(s.type)}
                title={
                  g && !g.gating_ok
                    ? `Non faisable : ${JSON.stringify(g.reasons ?? {})}`
                    : undefined
                }
                className={`rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                  selected
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : disabled
                      ? "cursor-not-allowed border-neutral-100 text-neutral-300"
                      : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        {gatingActuel && !gatingActuel.gating_ok && (
          <p className="mt-2 text-[11px] text-amber-600">
            Non faisable en l&apos;etat : {JSON.stringify(gatingActuel.reasons ?? {})}
          </p>
        )}
      </div>

      {/* Sélecteur de profil */}
      <div className="rounded-xl border border-neutral-200 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Profil
        </h3>
        <div className="grid grid-cols-3 gap-2">
          {(["promoteur", "investisseur", "mixte"] as Profil[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setProfil(p)}
              className={`rounded-lg border px-2 py-2 text-xs font-medium capitalize transition-colors ${
                profil === p
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-neutral-200 text-neutral-600 hover:border-neutral-300"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Comparatif existant / PLU */}
      {prefaisabilite && (
        <div className="rounded-xl border border-neutral-200 p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Existant vs PLU
          </h3>
          <div className="divide-y divide-neutral-100 text-xs">
            <div className="flex justify-between py-1.5">
              <span className="text-neutral-500">CES</span>
              <span className="font-medium">
                {item?.coverage_ratio != null ? Math.round(item.coverage_ratio * 100) : "—"}% existant
                / {item?.ces_applied != null ? Math.round(item.ces_applied * 100) : "—"}% PLU
              </span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-neutral-500">Hauteur</span>
              <span className="font-medium">
                {prefaisabilite.height_existing_m != null
                  ? `${prefaisabilite.height_existing_m.toFixed(1)} m`
                  : "inconnue (re-pipeline requis)"}{" "}
                existant / {item?.max_height_est ?? "—"} m PLU
              </span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-neutral-500">Recul lateral</span>
              <span className="font-medium">
                {prefaisabilite.setback_lateral_existing_m?.toFixed(1) ?? "—"} m existant /{" "}
                {prefaisabilite.setback_side_min_m_worst_case != null
                  ? `≥ ${prefaisabilite.setback_side_min_m_worst_case} m PLU (eventail)`
                  : "—"}
              </span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-neutral-500">Recul fond</span>
              <span className="font-medium">
                {prefaisabilite.setback_fond_existing_m?.toFixed(1) ?? "—"} m existant /{" "}
                {prefaisabilite.setback_rear_min_m_worst_case != null
                  ? `≥ ${prefaisabilite.setback_rear_min_m_worst_case} m PLU (eventail)`
                  : "—"}
              </span>
            </div>
          </div>
          <p className="mt-2 text-[10px] text-neutral-400">
            Facade determinee par adjacence cadastrale ({prefaisabilite.nb_facades ?? 0} cote(s)) --
            reculs PLU affiches en eventail (pire cas), l&apos;indice reglementaire exact de la
            parcelle n&apos;est pas vectorise en open data.
          </p>
        </div>
      )}

      {/* Batiment fantome -- positionnement geometrique reel dans l'enveloppe constructible */}
      <div className="rounded-xl border border-neutral-200 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Batiment fantome (positionnement)
        </h3>
        {loadingFantome ? (
          <p className="text-xs text-neutral-400">Calcul de l&apos;enveloppe constructible...</p>
        ) : batimentFantome ? (
          <div className="space-y-1 text-xs">
            <div className="flex justify-between py-1">
              <span className="text-neutral-500">Enveloppe constructible</span>
              <span className="font-medium">
                {enveloppeAireM2 != null ? Math.round(enveloppeAireM2) : "—"} m²
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-neutral-500">Rectangle inscrit (fantome)</span>
              <span className="font-medium">
                {batimentFantome.largeurM.toFixed(1)} × {batimentFantome.hauteurM.toFixed(1)} m
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-neutral-500">Aire du fantome</span>
              <span className="font-medium">{Math.round(batimentFantome.aireM2)} m²</span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-neutral-500">Orientation</span>
              <span className="font-medium">{batimentFantome.angleDeg.toFixed(0)}°</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-neutral-400">
            Enveloppe non calculable (reculs excessifs vis-a-vis de la taille de la parcelle, ou
            classification des cotes non encore executee pour cette commune).
          </p>
        )}
        <p className="mt-2 text-[10px] text-neutral-400">
          Rectangle le plus grand inscriptible dans l&apos;enveloppe constructible (parcelle erodee
          par le recul reel de chaque cote) -- heuristique de positionnement, pas un plan
          architectural. Aucun rendu carte pour l&apos;instant (donnees exposees en coordonnees
          Lambert-93).
        </p>
      </div>

      {/* Inputs */}
      {scenarioType !== "changement_usage" && (profil === "promoteur" || profil === "mixte") && (
        <div className="rounded-xl border border-neutral-200 p-3 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Hypotheses bilan promoteur
          </h3>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">
              Prix neuf ({formatEur(prixNeufEurM2)}/m²)
            </label>
            <input
              type="range"
              min={2000}
              max={12000}
              step={100}
              value={prixNeufEurM2}
              onChange={(e) => setPrixNeufEurM2(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">
              Cout construction ({formatEur(coutConstructionEurM2)}/m²)
            </label>
            <input
              type="range"
              min={800}
              max={4000}
              step={50}
              value={coutConstructionEurM2}
              onChange={(e) => setCoutConstructionEurM2(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div className="flex gap-2">
            {(["bloc", "decoupe"] as ModeVente[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModeVente(m)}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium ${
                  modeVente === m
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-neutral-200 text-neutral-600"
                }`}
              >
                Vente {m === "bloc" ? "en bloc" : "a la decoupe"}
              </button>
            ))}
          </div>
          {scenarioType !== "demolition_reconstruction" && (
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              <input
                type="checkbox"
                checked={inclutDemolition}
                onChange={(e) => setInclutDemolition(e.target.checked)}
              />
              Inclure demolition ({empriseADemolirM2.toFixed(0)} m² emprise existante)
            </label>
          )}
          <div>
            <label className="mb-1 block text-xs text-neutral-500">
              Cout depollution €/m² (laisser vide si non diagnostique)
            </label>
            <input
              type="number"
              value={coutDepollutionEurM2}
              onChange={(e) => setCoutDepollutionEurM2(e.target.value)}
              placeholder="Non diagnostique"
              className="w-full rounded-lg border border-neutral-200 px-2 py-1.5 text-xs"
            />
          </div>
        </div>
      )}

      {(profil === "investisseur" || profil === "mixte") && (
        <div className="rounded-xl border border-neutral-200 p-3 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            Hypotheses locatif
          </h3>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">
              Loyer mensuel ({formatEur(loyerMensuelEur)})
            </label>
            <input
              type="range"
              min={300}
              max={5000}
              step={50}
              value={loyerMensuelEur}
              onChange={(e) => setLoyerMensuelEur(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">
              Prix d&apos;achat ({formatEur(prixAchatEur)})
            </label>
            <input
              type="range"
              min={50000}
              max={2000000}
              step={10000}
              value={prixAchatEur}
              onChange={(e) => setPrixAchatEur(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Duree ({dureeAnnees} ans)</label>
            <input
              type="range"
              min={1}
              max={25}
              step={1}
              value={dureeAnnees}
              onChange={(e) => setDureeAnnees(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      )}

      {/* Résultat */}
      <div className="rounded-xl border border-neutral-200 p-3">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Resultat
        </h3>
        {scenarioType === "changement_usage" ? (
          <p className="text-xs text-neutral-500">
            Pas de construction neuve pour ce scenario. Evaluation economique = comparer la valeur
            locative/de vente entre la destination actuelle et la destination cible -- hors perimetre
            de ce moteur (necessite une estimation manuelle par destination).
          </p>
        ) : resultat && resultat.type === "bilan" ? (
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-neutral-500">SDP developpee</span>
              <span>{Math.round(resultat.data.sdpDevM2)} m²</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Recettes</span>
              <span>{formatEur(resultat.data.recettesEur)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Construction</span>
              <span>-{formatEur(resultat.data.coutConstructionEur)}</span>
            </div>
            {resultat.data.coutDemolitionEur > 0 && (
              <div className="flex justify-between">
                <span className="text-neutral-500">Demolition</span>
                <span>-{formatEur(resultat.data.coutDemolitionEur)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-neutral-500">VRD</span>
              <span>-{formatEur(resultat.data.coutVrdEur)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Commercialisation + frais</span>
              <span>
                -{formatEur(resultat.data.coutCommercialisationEur + resultat.data.fraisFinanciersTaxeEur)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Marge promoteur</span>
              <span>-{formatEur(resultat.data.margePromoteurEur)}</span>
            </div>
            <div className="flex justify-between border-t border-neutral-100 pt-1 font-semibold">
              <span>Charge fonciere plafond</span>
              <span>{formatEur(resultat.data.chargeFoncierePlafondEur)}</span>
            </div>
            {resultat.data.avertissements.map((a, i) => (
              <p key={i} className="mt-1 text-[10px] text-amber-600">
                {a}
              </p>
            ))}
          </div>
        ) : resultat && resultat.type === "cashflow" ? (
          <div className="space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-neutral-500">Rendement brut</span>
              <span>{resultat.data.rendementBrutPct?.toFixed(2) ?? "—"} %</span>
            </div>
            <div className="flex justify-between">
              <span className="text-neutral-500">Rendement net</span>
              <span>{resultat.data.rendementNetPct?.toFixed(2) ?? "—"} %</span>
            </div>
            <div className="max-h-40 overflow-y-auto">
              {resultat.data.cashflowParAnnee.map((c) => (
                <div key={c.annee} className="flex justify-between py-0.5">
                  <span className="text-neutral-500">Annee {c.annee}</span>
                  <span>{formatEur(c.cashflowNetEur)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : resultat && resultat.type === "mixte" ? (
          <div className="space-y-2 text-xs">
            <div>
              <div className="font-semibold text-neutral-700">Partie conservee (location)</div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Rendement net</span>
                <span>{resultat.data.partieConservee.cashflow.rendementNetPct?.toFixed(2) ?? "—"} %</span>
              </div>
            </div>
            <div>
              <div className="font-semibold text-neutral-700">Partie ajoutee (promotion)</div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Profit reel estime</span>
                <span>{formatEur(resultat.data.synthese.profitReelPartieAjouteeEur)}</span>
              </div>
            </div>
            <div className="flex justify-between border-t border-neutral-100 pt-1 font-semibold">
              <span>TRI estime</span>
              <span>
                {resultat.data.synthese.triEstimePct != null
                  ? `${resultat.data.synthese.triEstimePct.toFixed(1)} %`
                  : "non calculable (donnees insuffisantes)"}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-neutral-400">Chargement...</p>
        )}
      </div>
    </div>
  );
}
