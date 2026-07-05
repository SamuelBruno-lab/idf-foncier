/**
 * Cash-flow investisseur -- module pur, aucun acces DB. Reprend les
 * formules deja en production dans /api/rendement/route.ts et
 * /api/rental-strategies/route.ts (rendement brut/net), projetees sur
 * plusieurs annees. Pas un nouveau moteur : une simple projection
 * temporelle du meme calcul.
 */

export type RendementHypotheses = {
  vacancePct: number;
  chargesPct: number;
  taxeFoncierePct: number;
};

/** = loyer_m2 x 12 / prix_m2 x 100, formule identique a /api/rendement/route.ts. */
export function calculerRendementBrutPct(
  loyerMensuelEur: number,
  prixAchatEur: number
): number | null {
  if (!prixAchatEur || prixAchatEur <= 0) return null;
  return ((loyerMensuelEur * 12) / prixAchatEur) * 100;
}

/** = brut x (1 - vacance% - charges% - TF%), formule identique a /api/rendement/route.ts. */
export function calculerRendementNetPct(
  rendementBrutPct: number,
  hypotheses: RendementHypotheses
): number {
  return (
    rendementBrutPct *
    (1 - (hypotheses.vacancePct + hypotheses.chargesPct + hypotheses.taxeFoncierePct) / 100)
  );
}

export type FinancementCredit = {
  montantEmprunteEur: number;
  tauxAnnuelPct: number;
  dureeAnnees: number;
};

/** Mensualite d'un pret amortissable classique, annualisee. */
function mensualiteCreditAnnuelle(f: FinancementCredit): number {
  const tauxMensuel = f.tauxAnnuelPct / 100 / 12;
  const nbMensualites = f.dureeAnnees * 12;
  if (tauxMensuel === 0) return (f.montantEmprunteEur / nbMensualites) * 12;
  const mensualite =
    (f.montantEmprunteEur * tauxMensuel) / (1 - Math.pow(1 + tauxMensuel, -nbMensualites));
  return mensualite * 12;
}

export type CashflowInvestisseurInput = {
  loyerMensuelEur: number;
  prixAchatEur: number;
  hypotheses: RendementHypotheses;
  dureeAnnees: number;
  /** Indexation annuelle du loyer, en % -- 0 par defaut (loyer constant). */
  tauxIndexationLoyerPct?: number;
  financement?: FinancementCredit;
};

export type CashflowAnnuel = {
  annee: number;
  loyerBrutEur: number;
  chargesVacanceTaxeEur: number;
  mensualiteCreditEur: number;
  cashflowNetEur: number;
};

export type CashflowInvestisseurOutput = {
  rendementBrutPct: number | null;
  rendementNetPct: number | null;
  cashflowParAnnee: CashflowAnnuel[];
  avertissements: string[];
};

export function calculerCashflowInvestisseur(
  input: CashflowInvestisseurInput
): CashflowInvestisseurOutput {
  const avertissements: string[] = [];
  const rendementBrutPct = calculerRendementBrutPct(input.loyerMensuelEur, input.prixAchatEur);
  const rendementNetPct =
    rendementBrutPct != null ? calculerRendementNetPct(rendementBrutPct, input.hypotheses) : null;

  const tauxIndexation = input.tauxIndexationLoyerPct ?? 0;
  const mensualiteAnnuelle = input.financement ? mensualiteCreditAnnuelle(input.financement) : 0;
  if (input.financement && tauxIndexation === 0) {
    avertissements.push(
      "Loyer suppose constant sur toute la duree (aucune indexation fournie) -- projection prudente, le loyer reel evolue generalement avec l'indice de reference des loyers."
    );
  }

  const cashflowParAnnee: CashflowAnnuel[] = [];
  for (let annee = 1; annee <= input.dureeAnnees; annee++) {
    const loyerMensuelIndexe =
      input.loyerMensuelEur * Math.pow(1 + tauxIndexation / 100, annee - 1);
    const loyerBrutEur = loyerMensuelIndexe * 12;
    const tauxChargesTotal =
      (input.hypotheses.vacancePct + input.hypotheses.chargesPct + input.hypotheses.taxeFoncierePct) /
      100;
    const chargesVacanceTaxeEur = loyerBrutEur * tauxChargesTotal;
    const mensualiteCreditEur =
      input.financement && annee <= input.financement.dureeAnnees ? mensualiteAnnuelle : 0;
    const cashflowNetEur = loyerBrutEur - chargesVacanceTaxeEur - mensualiteCreditEur;

    cashflowParAnnee.push({
      annee,
      loyerBrutEur,
      chargesVacanceTaxeEur,
      mensualiteCreditEur,
      cashflowNetEur,
    });
  }

  return { rendementBrutPct, rendementNetPct, cashflowParAnnee, avertissements };
}
