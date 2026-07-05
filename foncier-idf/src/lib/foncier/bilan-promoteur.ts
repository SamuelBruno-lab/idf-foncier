/**
 * Bilan promoteur (methode a rebours / compte a rebours CNAM-ICH) --
 * module pur, aucun acces DB. Porte la cascade validee sur le cas reel du
 * 109 rue Constant Coquelin, Vitry-sur-Seine (prototype Python
 * estimation_auto.py), avec deux corrections par rapport au prototype :
 * toutes les constantes sont parametrees (chargees par l'appelant depuis
 * dim_bilan_promoteur_hypotheses, jamais codees en dur ici), et une ligne
 * demolition/depollution est ajoutee (absente du prototype).
 */

export type BilanPromoteurHypotheses = {
  ratioShabSdp: number;
  coutConstructionEurM2Defaut: number;
  coutVrdEurM2Terrain: number;
  coutDemolitionEurM2Emprise: number;
  coutDepollutionEurM2Defaut: number | null;
  tauxCommercialisationPct: number;
  tauxFraisFinanciersTaxePct: number;
  tauxMargePromoteurBlocPct: number;
  tauxMargePromoteurDecoupePct: number;
  coefficientRendementNetInvestisseur: number;
};

/** Miroir des defauts de dim_bilan_promoteur_hypotheses (sql/75). A ne
 * garder synchronise que comme filet de secours si la table n'a pas
 * encore ete lue -- la source de verite reste la table. */
export const BILAN_PROMOTEUR_HYPOTHESES_DEFAUT: BilanPromoteurHypotheses = {
  ratioShabSdp: 0.8,
  coutConstructionEurM2Defaut: 2000,
  coutVrdEurM2Terrain: 100,
  coutDemolitionEurM2Emprise: 150,
  coutDepollutionEurM2Defaut: null,
  tauxCommercialisationPct: 3,
  tauxFraisFinanciersTaxePct: 6,
  tauxMargePromoteurBlocPct: 8,
  tauxMargePromoteurDecoupePct: 12,
  coefficientRendementNetInvestisseur: 0.68,
};

export type ModeVente = "bloc" | "decoupe";

export type BilanPromoteurInput = {
  surfaceTerrainM2: number;
  /** CES applique a ce scenario (0-1) -- existant, PLU, ou hypothese utilisateur selon le scenario. */
  cesReference: number;
  /** Nombre de niveaux du programme neuf/surelevation -- determine par l'appelant selon le scenario
   * (ex: floors_est PLU pour demolition-reconstruction, delta de niveaux pour surelevation). */
  niveaux: number;
  prixNeufEurM2: number;
  /** Sinon repli sur hypotheses.coutConstructionEurM2Defaut. */
  coutConstructionEurM2?: number;
  modeVente: ModeVente;
  inclutDemolition: boolean;
  /** Requis si inclutDemolition=true -- emprise batie a demolir (m2), pas la surface totale du terrain. */
  empriseADemolirM2?: number;
  /** Saisie manuelle si le terrain est identifie a risque (ex: ancien site industriel).
   * Sinon repli sur hypotheses.coutDepollutionEurM2Defaut (NULL par defaut -- jamais invente). */
  coutDepollutionEurM2?: number;
  hypotheses: BilanPromoteurHypotheses;
};

export type BilanPromoteurOutput = {
  sdpDevM2: number;
  shabM2: number;
  recettesEur: number;
  coutConstructionEur: number;
  coutVrdEur: number;
  /** 0 si inclutDemolition=false. */
  coutDemolitionEur: number;
  /** 0 si non chiffre -- voir avertissements dans ce cas. */
  coutDepollutionEur: number;
  coutCommercialisationEur: number;
  fraisFinanciersTaxeEur: number;
  margePromoteurEur: number;
  /** = prix maximum du foncier acceptable pour que l'operation degage la marge cible. */
  chargeFoncierePlafondEur: number;
  avertissements: string[];
};

export function calculerBilanPromoteur(input: BilanPromoteurInput): BilanPromoteurOutput {
  const h = input.hypotheses;
  const avertissements: string[] = [];

  const coutConstructionEurM2 = input.coutConstructionEurM2 ?? h.coutConstructionEurM2Defaut;

  const sdpDevM2 = input.surfaceTerrainM2 * input.cesReference * input.niveaux;
  const shabM2 = sdpDevM2 * h.ratioShabSdp;
  const recettesEur = shabM2 * input.prixNeufEurM2;

  const coutConstructionEur = sdpDevM2 * coutConstructionEurM2;
  const coutVrdEur = input.surfaceTerrainM2 * h.coutVrdEurM2Terrain;

  let coutDemolitionEur = 0;
  if (input.inclutDemolition) {
    if (input.empriseADemolirM2 == null) {
      avertissements.push(
        "inclutDemolition=true mais empriseADemolirM2 non fournie : cout de demolition compte comme 0, le resultat sous-estime le cout reel de l'operation."
      );
    } else {
      coutDemolitionEur = input.empriseADemolirM2 * h.coutDemolitionEurM2Emprise;
    }
  }

  const coutDepollutionEurM2 = input.coutDepollutionEurM2 ?? h.coutDepollutionEurM2Defaut;
  let coutDepollutionEur = 0;
  if (coutDepollutionEurM2 != null) {
    coutDepollutionEur = input.surfaceTerrainM2 * coutDepollutionEurM2;
  } else {
    avertissements.push(
      "Cout de depollution non chiffre (aucun diagnostic saisi) : compte comme 0 dans ce calcul. Un diagnostic terrain est requis avant tout engagement si le site est suspect (ancien usage industriel, ICPE, etc.)."
    );
  }

  const coutCommercialisationEur = recettesEur * (h.tauxCommercialisationPct / 100);
  const fraisFinanciersTaxeEur = recettesEur * (h.tauxFraisFinanciersTaxePct / 100);
  const tauxMargePct =
    input.modeVente === "decoupe" ? h.tauxMargePromoteurDecoupePct : h.tauxMargePromoteurBlocPct;
  const margePromoteurEur = recettesEur * (tauxMargePct / 100);

  const chargeFoncierePlafondEur =
    recettesEur -
    (coutConstructionEur +
      coutVrdEur +
      coutDemolitionEur +
      coutDepollutionEur +
      coutCommercialisationEur +
      fraisFinanciersTaxeEur +
      margePromoteurEur);

  return {
    sdpDevM2,
    shabM2,
    recettesEur,
    coutConstructionEur,
    coutVrdEur,
    coutDemolitionEur,
    coutDepollutionEur,
    coutCommercialisationEur,
    fraisFinanciersTaxeEur,
    margePromoteurEur,
    chargeFoncierePlafondEur,
    avertissements,
  };
}
