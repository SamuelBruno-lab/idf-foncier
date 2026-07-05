/**
 * Strategie mixte -- fonction de COMPOSITION, pas un 3e moteur de calcul.
 * Appelle cashflow-investisseur.ts sur la partie conservee (location
 * existante) et bilan-promoteur.ts sur la partie ajoutee (surelevation ou
 * construction neuve sur la meme parcelle), puis juxtapose les flux dans
 * le temps.
 *
 * Hypothese cle : la partie ajoutee est VENDUE (logique bilan promoteur,
 * un flux de recettes ponctuel a la livraison), la partie conservee reste
 * LOUEE (cash-flow recurrent) -- coherent avec la demande "location
 * existant + promotion surelevation/construction neuve".
 *
 * Le terrain est deja possede (pas d'achat) : le "profit reel" de la
 * partie ajoutee n'est donc PAS charge_fonciere_plafond (qui suppose un
 * achat de terrain a ce prix plafond) mais charge_fonciere_plafond +
 * marge_promoteur (la marge cible redevient du profit reel puisqu'aucune
 * charge fonciere n'est effectivement payee).
 */

import {
  calculerBilanPromoteur,
  type BilanPromoteurInput,
  type BilanPromoteurOutput,
} from "./bilan-promoteur";
import {
  calculerCashflowInvestisseur,
  type CashflowInvestisseurInput,
  type CashflowInvestisseurOutput,
} from "./cashflow-investisseur";

export type StrategieMixteInput = {
  partieConservee: CashflowInvestisseurInput;
  partieAjoutee: {
    scenarioType: "surelevation" | "construction_neuve_meme_parcelle";
    bilanInput: BilanPromoteurInput;
    /** Duree des travaux en annees -- 1 par defaut. Les couts de construction/VRD/
     * demolition/depollution sont repartis uniformement sur cette duree. */
    dureeTravauxAnnees?: number;
  };
};

export type StrategieMixteOutput = {
  partieConservee: { cashflow: CashflowInvestisseurOutput };
  partieAjoutee: {
    scenarioType: "surelevation" | "construction_neuve_meme_parcelle";
    bilan: BilanPromoteurOutput;
  };
  synthese: {
    /** Flux net annuel, annees de travaux negatives (cout construction), annee de
     * livraison positive (recettes nettes de commercialisation/frais), puis
     * uniquement le cash-flow locatif de la partie conservee. */
    cashflowAnneeParAnnee: number[];
    /** = bilan.chargeFoncierePlafondEur + bilan.margePromoteurEur : le terrain
     * est deja possede, la "charge fonciere plafond" theorique redevient du
     * profit reel puisqu'aucun achat de terrain n'a lieu. */
    profitReelPartieAjouteeEur: number;
    /** TRI (taux de rendement interne) estime sur la serie de flux ci-dessus,
     * null si non calculable de facon fiable (pas de changement de signe dans
     * la serie, ou racine hors d'un intervalle raisonnable) -- jamais une
     * valeur inventee. */
    triEstimePct: number | null;
  };
};

export function calculerStrategieMixte(input: StrategieMixteInput): StrategieMixteOutput {
  const cashflow = calculerCashflowInvestisseur(input.partieConservee);
  const bilan = calculerBilanPromoteur(input.partieAjoutee.bilanInput);

  const dureeTravaux = input.partieAjoutee.dureeTravauxAnnees ?? 1;
  const dureeTotale = Math.max(dureeTravaux, input.partieConservee.dureeAnnees);

  const coutTravauxTotalEur =
    bilan.coutConstructionEur + bilan.coutVrdEur + bilan.coutDemolitionEur + bilan.coutDepollutionEur;
  const coutTravauxParAnEur = coutTravauxTotalEur / dureeTravaux;
  const netLivraisonEur = bilan.recettesEur - bilan.coutCommercialisationEur - bilan.fraisFinanciersTaxeEur;
  const profitReelPartieAjouteeEur = bilan.chargeFoncierePlafondEur + bilan.margePromoteurEur;

  const cashflowAnneeParAnnee: number[] = [];
  for (let annee = 1; annee <= dureeTotale; annee++) {
    const conservee = cashflow.cashflowParAnnee.find((c) => c.annee === annee);
    let flux = conservee ? conservee.cashflowNetEur : 0;
    if (annee <= dureeTravaux) flux -= coutTravauxParAnEur;
    if (annee === dureeTravaux) flux += netLivraisonEur;
    cashflowAnneeParAnnee.push(flux);
  }

  return {
    partieConservee: { cashflow },
    partieAjoutee: { scenarioType: input.partieAjoutee.scenarioType, bilan },
    synthese: {
      cashflowAnneeParAnnee,
      profitReelPartieAjouteeEur,
      triEstimePct: calculerTRI(cashflowAnneeParAnnee),
    },
  };
}

// ── TRI (IRR) par bisection ──────────────────────────────────────────
// Retourne null si la serie n'a pas de changement de signe exploitable
// dans un intervalle de taux raisonnable (-99% a +1000%) -- pas de valeur
// inventee dans ce cas.

function valeurActuelleNette(taux: number, flux: number[]): number {
  return flux.reduce((acc, f, idx) => acc + f / Math.pow(1 + taux, idx + 1), 0);
}

function calculerTRI(flux: number[]): number | null {
  const hasPositif = flux.some((f) => f > 0);
  const hasNegatif = flux.some((f) => f < 0);
  if (!hasPositif || !hasNegatif) return null;

  let bas = -0.99;
  let haut = 10;
  let vanBas = valeurActuelleNette(bas, flux);
  let vanHaut = valeurActuelleNette(haut, flux);
  if (vanBas * vanHaut > 0) return null;

  for (let i = 0; i < 200; i++) {
    const milieu = (bas + haut) / 2;
    const vanMilieu = valeurActuelleNette(milieu, flux);
    if (Math.abs(vanMilieu) < 1e-6) return milieu * 100;
    if (vanMilieu > 0 === vanBas > 0) {
      bas = milieu;
      vanBas = vanMilieu;
    } else {
      haut = milieu;
    }
  }
  return ((bas + haut) / 2) * 100;
}
