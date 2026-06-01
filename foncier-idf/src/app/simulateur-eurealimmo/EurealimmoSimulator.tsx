"use client";

import { useMemo, useState } from "react";

// =============================================================================
// PARAMÈTRES CONTRACTUELS — extraits du contrat Diara (et applicables au cap 60)
// =============================================================================
const CONTRACT = {
  // Article 6.1 — Rétrocession 95 % / retenue Eurealimmo 5 %
  retentionPct: 0.05,
  // Article 6.2 — Forfait mensuel
  monthlyFee: 59,
  // Article 6.3 — Franchise 6 mois (Fondateurs uniquement)
  franchiseMonths: 6,
  // Article 7.2 — Referral fees (payés par Eurealimmo)
  refHnwiAssoFondatrice: 0.2, // Diara Associée Fondatrice : 20 % HNWI à vie
  refStdAssoFondatrice: 0.15, // 15 % Standard à vie
  refHnwiAutresFondateurs: 0.18, // Autres Fondateurs (boule de neige Niveau 1) : 18 % HNWI
  refStdAutresFondateurs: 0.15, // 15 % Standard
  refSignatureBonusStd: 200, // 200 € credits par signature Standard
  // Article 8 — Prime de cession Diara (paliers SANS PLAFOND)
  cessionPaliers: [
    { name: "BASE", unitsMin: 5, hnwiMin: 0, pct: 0.05 },
    { name: "BONUS 1", unitsMin: 10, hnwiMin: 0, pct: 0.06 },
    { name: "BONUS 2", unitsMin: 15, hnwiMin: 0, pct: 0.07 },
    { name: "BONUS 3", unitsMin: 20, hnwiMin: 3, pct: 0.09 },
  ] as const,
  // Cap Fondateurs
  capFondateurs: 60,
  // Frais CCI par mandataire rattaché
  fraisCciParMandataire: 50,
};

// Couleurs marque
const GOLD = "#c8a25d";
const DM_DARK = "#064e3b";
const DM_GREEN = "#10b981";
const SOLANA = "#9945ff";
const RED = "#dc2626";
const TEXT = "#0f172a";
const MUTED = "#64748b";
const BG_SUBTLE = "#f8fafc";
const BORDER = "#e2e8f0";

function eur(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

function eurM(n: number): string {
  // Format compact M€/k€
  if (Math.abs(n) >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, "")} M€`;
  }
  if (Math.abs(n) >= 10_000) {
    return `${Math.round(n / 1000).toLocaleString("fr-FR")} k€`;
  }
  return eur(n);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)} %`;
}

// =============================================================================
// COMPOSANTS UI
// =============================================================================
function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
  hint,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (n: number) => void;
  hint?: string;
  format?: (n: number) => string;
}) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 12.5, fontWeight: 600, color: TEXT }}>
          {label}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: DM_DARK,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {format ? format(value) : `${value.toLocaleString("fr-FR")} ${unit ?? ""}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          accentColor: DM_GREEN,
          cursor: "pointer",
        }}
      />
      {hint && (
        <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>{hint}</div>
      )}
    </label>
  );
}

function Row({
  label,
  detail,
  amount,
  color,
}: {
  label: string;
  detail?: string;
  amount: number;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderBottom: `1px solid ${BORDER}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: color ?? TEXT,
          }}
        >
          {label}
        </div>
        {detail && (
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
            {detail}
          </div>
        )}
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: amount < 0 ? RED : color ?? DM_DARK,
          fontVariantNumeric: "tabular-nums",
          marginLeft: 12,
          whiteSpace: "nowrap",
        }}
      >
        {amount < 0 ? "−" : ""}
        {eur(Math.abs(amount))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  color,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        padding: 12,
        borderRadius: 8,
        border: `1px solid ${BORDER}`,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: MUTED,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 800,
          color: color ?? DM_DARK,
        }}
      >
        {value}
      </div>
      {hint && (
        <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{hint}</div>
      )}
    </div>
  );
}

// =============================================================================
// COMPOSANT PRINCIPAL
// =============================================================================
export default function EurealimmoSimulator() {
  // ---- Profil du réseau ----
  const [nbFondateurs, setNbFondateurs] = useState(15);
  const [pctHnwi, setPctHnwi] = useState(40); // % de Fondateurs HNWI
  const [ventesFondateurHnwi, setVentesFondateurHnwi] = useState(2);
  const [ventesFondateurStd, setVentesFondateurStd] = useState(4);
  const [ticketHnwi, setTicketHnwi] = useState(2_000_000);
  const [ticketStd, setTicketStd] = useState(500_000);
  const [commissionPct, setCommissionPct] = useState(4);

  // ---- Effet boule de neige : filleuls Niveau 2 (les filleuls des Fondateurs) ----
  const [filleulsParFondateur, setFilleulsParFondateur] = useState(2);

  // ---- Charges Eurealimmo ----
  const [chargesFixes, setChargesFixes] = useState(2_500);
  const [salaireGerant, setSalaireGerant] = useState(0);

  // ---- Exit scenario ----
  const [produitNetCession, setProduitNetCession] = useState(10_000_000);
  const [palierDiara, setPalierDiara] = useState<0 | 1 | 2 | 3>(2); // index dans cessionPaliers
  const [exitMultiple, setExitMultiple] = useState(8); // multiple EBITDA

  // =============================================================================
  // CALCULS
  // =============================================================================
  const calc = useMemo(() => {
    const nbHnwi = Math.round((nbFondateurs * pctHnwi) / 100);
    const nbStd = nbFondateurs - nbHnwi;

    // ---- CA brut commission Eurealimmo (ventes propres Fondateurs) ----
    const caHnwi = nbHnwi * ventesFondateurHnwi * ticketHnwi * (commissionPct / 100);
    const caStd = nbStd * ventesFondateurStd * ticketStd * (commissionPct / 100);
    const caTotalFondateurs = caHnwi + caStd;

    // ---- Marge Eurealimmo sur ventes propres Fondateurs : 5 % retenu ----
    const margeFondateurs = caTotalFondateurs * CONTRACT.retentionPct;

    // ---- Effet boule de neige Niveau 1 : filleuls des Fondateurs (autres) ----
    // Chaque Fondateur recrute X filleuls qui font des ventes (mix HNWI/Std identique)
    const nbFilleulsTotal = nbFondateurs * filleulsParFondateur;
    const nbFilleulsHnwi = Math.round((nbFilleulsTotal * pctHnwi) / 100);
    const nbFilleulsStd = nbFilleulsTotal - nbFilleulsHnwi;

    const caFilleulsHnwi =
      nbFilleulsHnwi * ventesFondateurHnwi * ticketHnwi * (commissionPct / 100);
    const caFilleulsStd =
      nbFilleulsStd * ventesFondateurStd * ticketStd * (commissionPct / 100);
    const caFilleulsTotal = caFilleulsHnwi + caFilleulsStd;

    // Marge nette Eurealimmo sur filleuls = 5 % retenu MOINS referral payé au parrain
    // Niveau 1 (Fondateurs autres que Diara) : referral 18 % HNWI / 15 % Standard
    const referralFilleulsHnwi = caFilleulsHnwi * CONTRACT.retentionPct * CONTRACT.refHnwiAutresFondateurs;
    const referralFilleulsStd = caFilleulsStd * CONTRACT.retentionPct * CONTRACT.refStdAutresFondateurs;
    const margeFilleuls =
      caFilleulsTotal * CONTRACT.retentionPct - referralFilleulsHnwi - referralFilleulsStd;

    // ---- Forfait mensuel (tous les mandataires : Fondateurs + filleuls) ----
    // Fondateurs : franchise 6 mois Y1, puis 12 mois plein
    // Filleuls : 12 mois plein (pas de franchise pour eux dans le contrat type)
    const forfaitAnnuelFondateur =
      CONTRACT.monthlyFee * (12 - CONTRACT.franchiseMonths); // Y1
    const forfaitAnnuelFondateurY2 = CONTRACT.monthlyFee * 12;
    const forfaitAnnuelFilleul = CONTRACT.monthlyFee * 12; // pas de franchise

    const totalForfaitsY1 =
      nbFondateurs * forfaitAnnuelFondateur +
      nbFilleulsTotal * forfaitAnnuelFilleul;
    const totalForfaitsY2 =
      nbFondateurs * forfaitAnnuelFondateurY2 +
      nbFilleulsTotal * forfaitAnnuelFilleul;

    // ---- Bonus signature Standard (coût pour Eurealimmo en credits) ----
    // Le bonus est en credits DATAMERRY donc pas de cash sortant, mais c'est une remise
    const bonusSignatureStdY1 =
      (nbStd + nbFilleulsStd) * CONTRACT.refSignatureBonusStd;

    // ---- Frais CCI (one-shot Y1) ----
    const fraisCciY1 =
      (nbFondateurs + nbFilleulsTotal) * CONTRACT.fraisCciParMandataire;

    // ---- CA NET Eurealimmo ----
    const caNetY1 =
      margeFondateurs + margeFilleuls + totalForfaitsY1 - bonusSignatureStdY1 - fraisCciY1;
    const caNetY2 = margeFondateurs + margeFilleuls + totalForfaitsY2;

    // ---- Bénéfice avant IS ----
    const beneficeAvantIsY1 = caNetY1 - chargesFixes - salaireGerant;
    const beneficeAvantIsY2 = caNetY2 - chargesFixes - salaireGerant;

    // ---- IS PME : 15 % jusqu'à 42 500 € puis 25 % au-delà ----
    function calcIs(benef: number): number {
      if (benef <= 0) return 0;
      const taux15 = Math.min(benef, 42_500) * 0.15;
      const taux25 = Math.max(0, benef - 42_500) * 0.25;
      return taux15 + taux25;
    }
    const isY1 = calcIs(beneficeAvantIsY1);
    const isY2 = calcIs(beneficeAvantIsY2);

    const beneficeNetY1 = beneficeAvantIsY1 - isY1;
    const beneficeNetY2 = beneficeAvantIsY2 - isY2;

    // ---- Valorisation EBITDA × multiple ----
    const ebitda = beneficeAvantIsY2; // proxy EBITDA = bénéfice avant IS (régime de croisière)
    const valorisationEbitda = Math.max(0, ebitda * exitMultiple);

    // ---- Prime de cession à payer à Diara (si exit) ----
    const palier = CONTRACT.cessionPaliers[palierDiara];
    const primeDiara = palier ? produitNetCession * palier.pct : 0;
    const netSamuel = produitNetCession - primeDiara;

    // ---- Projection 5 ans (cumul bénéfice net) ----
    const benefice5Ans = beneficeNetY1 + 4 * beneficeNetY2;
    const valeurTotale5Ans = benefice5Ans + valorisationEbitda;

    return {
      // Réseau
      nbHnwi,
      nbStd,
      nbFilleulsTotal,
      nbFilleulsHnwi,
      nbFilleulsStd,
      // CA brut
      caHnwi,
      caStd,
      caTotalFondateurs,
      caFilleulsHnwi,
      caFilleulsStd,
      caFilleulsTotal,
      caBrutReseau: caTotalFondateurs + caFilleulsTotal,
      // Marges
      margeFondateurs,
      margeFilleuls,
      referralFilleulsHnwi,
      referralFilleulsStd,
      // Forfaits
      totalForfaitsY1,
      totalForfaitsY2,
      // CA net
      caNetY1,
      caNetY2,
      bonusSignatureStdY1,
      fraisCciY1,
      // Bénéfice
      beneficeAvantIsY1,
      beneficeAvantIsY2,
      isY1,
      isY2,
      beneficeNetY1,
      beneficeNetY2,
      // Valorisation
      ebitda,
      valorisationEbitda,
      // Exit
      palier,
      primeDiara,
      netSamuel,
      // Projection
      benefice5Ans,
      valeurTotale5Ans,
    };
  }, [
    nbFondateurs,
    pctHnwi,
    ventesFondateurHnwi,
    ventesFondateurStd,
    ticketHnwi,
    ticketStd,
    commissionPct,
    filleulsParFondateur,
    chargesFixes,
    salaireGerant,
    produitNetCession,
    palierDiara,
    exitMultiple,
  ]);

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 20px" }}>
      {/* ============= HEADER ============= */}
      <header
        style={{
          textAlign: "center",
          marginBottom: 28,
          paddingBottom: 22,
          borderBottom: `2px solid ${BORDER}`,
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: DM_DARK,
            color: "#fff",
            padding: "4px 14px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.5,
            marginBottom: 12,
          }}
        >
          🏢 VUE MANDANT — EUREALIMMO SARL
        </div>
        <h1
          style={{
            fontSize: 30,
            fontWeight: 800,
            color: DM_DARK,
            margin: "0 0 8px 0",
          }}
        >
          Simulateur Eurealimmo Réseau
        </h1>
        <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>
          Vue économique côté <strong>titulaire de la carte T</strong>
          {" — "}
          CA réseau, marges nettes, IS PME, valorisation EBITDA et prime de
          cession à provisionner pour Diara.
        </p>
      </header>

      {/* ============= LAYOUT ============= */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.1fr)",
          gap: 22,
        }}
      >
        {/* ===== COLONNE GAUCHE : INPUTS ===== */}
        <div>
          {/* Section 1 : Profil du réseau */}
          <section
            style={{
              background: BG_SUBTLE,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: 18,
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: DM_DARK,
                margin: "0 0 14px 0",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              1. Profil de ton réseau Fondateurs
            </h2>
            <Slider
              label="Nombre de Fondateurs recrutés"
              value={nbFondateurs}
              min={1}
              max={CONTRACT.capFondateurs}
              step={1}
              unit={`/ ${CONTRACT.capFondateurs}`}
              onChange={setNbFondateurs}
              hint="Cap global 60 places Fondateur. Diara est la n° 1."
            />
            <Slider
              label="% de Fondateurs HNWI"
              value={pctHnwi}
              min={0}
              max={100}
              step={5}
              unit="%"
              onChange={setPctHnwi}
              hint={`${calc.nbHnwi} HNWI / ${calc.nbStd} Standard`}
            />
            <Slider
              label="Filleuls par Fondateur (Niveau 1 boule de neige)"
              value={filleulsParFondateur}
              min={0}
              max={10}
              step={1}
              unit="filleuls"
              onChange={setFilleulsParFondateur}
              hint={`${calc.nbFilleulsTotal} filleuls au total → ${calc.nbFilleulsHnwi} HNWI / ${calc.nbFilleulsStd} Std`}
            />
          </section>

          {/* Section 2 : Performance HNWI */}
          <section
            style={{
              background: "#fef3c7",
              border: `1px solid ${GOLD}`,
              borderRadius: 12,
              padding: 18,
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#92400e",
                margin: "0 0 14px 0",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              2. Performance type — Fondateur HNWI 👑
            </h2>
            <Slider
              label="Ventes / an par Fondateur HNWI"
              value={ventesFondateurHnwi}
              min={0}
              max={10}
              step={1}
              unit="ventes"
              onChange={setVentesFondateurHnwi}
            />
            <Slider
              label="Ticket moyen HNWI"
              value={ticketHnwi}
              min={500_000}
              max={10_000_000}
              step={100_000}
              onChange={setTicketHnwi}
              format={eur}
            />
          </section>

          {/* Section 3 : Performance Standard */}
          <section
            style={{
              background: "#dbeafe",
              border: `1px solid #3b82f6`,
              borderRadius: 12,
              padding: 18,
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#1e40af",
                margin: "0 0 14px 0",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              3. Performance type — Fondateur Standard
            </h2>
            <Slider
              label="Ventes / an par Fondateur Standard"
              value={ventesFondateurStd}
              min={0}
              max={15}
              step={1}
              unit="ventes"
              onChange={setVentesFondateurStd}
            />
            <Slider
              label="Ticket moyen Standard"
              value={ticketStd}
              min={150_000}
              max={1_500_000}
              step={25_000}
              onChange={setTicketStd}
              format={eur}
            />
            <Slider
              label="Commission moyenne (% du prix)"
              value={commissionPct}
              min={1}
              max={8}
              step={0.1}
              unit="%"
              onChange={setCommissionPct}
              hint="S'applique à toutes les ventes du réseau"
            />
          </section>

          {/* Section 4 : Charges Eurealimmo */}
          <section
            style={{
              background: BG_SUBTLE,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: 18,
              marginBottom: 16,
            }}
          >
            <h2
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: DM_DARK,
                margin: "0 0 14px 0",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              4. Charges Eurealimmo SARL
            </h2>
            <Slider
              label="Charges fixes annuelles"
              value={chargesFixes}
              min={0}
              max={50_000}
              step={500}
              onChange={setChargesFixes}
              format={eur}
              hint="Compta, banque, RC pro, domiciliation, hébergement"
            />
            <Slider
              label="Rémunération gérant (Samuel) /an"
              value={salaireGerant}
              min={0}
              max={150_000}
              step={1_000}
              onChange={setSalaireGerant}
              format={eur}
              hint="0 = gérant non rémunéré (Y1 recommandé, vit sur ARE)"
            />
          </section>

          {/* Section 5 : Hypothèse exit */}
          <section
            style={{
              background: "#ede9fe",
              border: `1px solid ${SOLANA}`,
              borderRadius: 12,
              padding: 18,
            }}
          >
            <h2
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#5b21b6",
                margin: "0 0 14px 0",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              5. Hypothèse exit Eurealimmo
            </h2>
            <Slider
              label="Multiple EBITDA pour valorisation"
              value={exitMultiple}
              min={3}
              max={15}
              step={0.5}
              unit="× EBITDA"
              onChange={setExitMultiple}
              hint="Marché immo Y2 : 5-8× / SaaS-like : 8-15×"
            />
            <Slider
              label="Produit Net de Cession estimé"
              value={produitNetCession}
              min={500_000}
              max={50_000_000}
              step={500_000}
              onChange={setProduitNetCession}
              format={eur}
              hint="Prix brut − impôts − conseil − dettes − earn-outs (art. 8.5)"
            />
            <div style={{ marginTop: 8 }}>
              <label
                style={{
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: TEXT,
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Palier Diara atteint à la cession
              </label>
              <div style={{ display: "flex", gap: 6 }}>
                {CONTRACT.cessionPaliers.map((p, i) => (
                  <button
                    key={p.name}
                    onClick={() => setPalierDiara(i as 0 | 1 | 2 | 3)}
                    style={{
                      flex: 1,
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: palierDiara === i ? `2px solid ${SOLANA}` : `1px solid ${BORDER}`,
                      background: palierDiara === i ? "#fff" : BG_SUBTLE,
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 700,
                      color: palierDiara === i ? "#5b21b6" : MUTED,
                    }}
                  >
                    <div>{p.name}</div>
                    <div style={{ fontSize: 10, marginTop: 2 }}>{pct(p.pct)}</div>
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10.5, color: MUTED, marginTop: 6 }}>
                Sky is the limit (sans plafond) — selon les unités constituées
                par Diara
              </div>
            </div>
          </section>
        </div>

        {/* ===== COLONNE DROITE : OUTPUTS ===== */}
        <div>
          <div style={{ position: "sticky", top: 16 }}>
            {/* TOTAL VALEUR 5 ANS */}
            <div
              style={{
                background: `linear-gradient(135deg, ${DM_DARK} 0%, ${DM_GREEN} 100%)`,
                color: "#fff",
                padding: 22,
                borderRadius: 16,
                marginBottom: 14,
                boxShadow: "0 8px 24px rgba(6,78,59,0.25)",
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  opacity: 0.85,
                  textTransform: "uppercase",
                  letterSpacing: 1.5,
                  marginBottom: 6,
                }}
              >
                💎 Valeur totale 5 ans Eurealimmo (bénéfices + valorisation)
              </div>
              <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1.1 }}>
                {eurM(calc.valeurTotale5Ans)}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
                Bénéfices nets cumulés : {eurM(calc.benefice5Ans)}
                {" + "}
                Valorisation Y5 (EBITDA × {exitMultiple}) :{" "}
                {eurM(calc.valorisationEbitda)}
              </div>
            </div>

            {/* RECAP RÉSEAU */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 8,
                marginBottom: 14,
              }}
            >
              <Stat
                label="CA brut réseau /an"
                value={eurM(calc.caBrutReseau)}
                hint={`${calc.nbHnwi + calc.nbFilleulsHnwi} HNWI + ${calc.nbStd + calc.nbFilleulsStd} Std`}
              />
              <Stat
                label="Bénéfice net Y2+"
                value={eurM(calc.beneficeNetY2)}
                hint="Régime de croisière"
                color={DM_GREEN}
              />
              <Stat
                label="Valo EBITDA"
                value={eurM(calc.valorisationEbitda)}
                hint={`× ${exitMultiple}`}
                color={SOLANA}
              />
            </div>

            {/* CA Y1 vs Y2 */}
            <div
              style={{
                background: "#fff",
                border: `1px solid ${BORDER}`,
                borderRadius: 12,
                marginBottom: 14,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  background: BG_SUBTLE,
                  padding: "10px 14px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: MUTED,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  display: "grid",
                  gridTemplateColumns: "1fr 100px 100px",
                  alignItems: "center",
                }}
              >
                <span>Détail compte de résultat</span>
                <span style={{ textAlign: "right" }}>ANNÉE 1</span>
                <span style={{ textAlign: "right" }}>RÉGIME (Y2+)</span>
              </div>
              <TwoColumnRow
                label="Marge ventes Fondateurs (5 %)"
                detail={`${pct(CONTRACT.retentionPct)} × ${eurM(calc.caTotalFondateurs)} CA`}
                y1={calc.margeFondateurs}
                y2={calc.margeFondateurs}
              />
              <TwoColumnRow
                label="Marge ventes Filleuls (4–4,25 %)"
                detail={`5 % retenu − referral 15-18 % aux Fondateurs parrains`}
                y1={calc.margeFilleuls}
                y2={calc.margeFilleuls}
              />
              <TwoColumnRow
                label="Forfaits 59 €/mois (réseau)"
                detail={`${nbFondateurs} Fondateurs (6 mois grat. Y1) + ${calc.nbFilleulsTotal} filleuls (12 mois)`}
                y1={calc.totalForfaitsY1}
                y2={calc.totalForfaitsY2}
              />
              <TwoColumnRow
                label="Bonus signature Standard (credits)"
                detail={`200 € × ${calc.nbStd + calc.nbFilleulsStd} Standard`}
                y1={-calc.bonusSignatureStdY1}
                y2={0}
                negative
              />
              <TwoColumnRow
                label="Frais CCI rattachement (one-shot)"
                detail={`50 € × ${nbFondateurs + calc.nbFilleulsTotal} mandataires`}
                y1={-calc.fraisCciY1}
                y2={0}
                negative
              />
              <TwoColumnRow
                label="Charges fixes Eurealimmo"
                detail="Compta, banque, RC pro, etc."
                y1={-chargesFixes}
                y2={-chargesFixes}
                negative
              />
              {salaireGerant > 0 && (
                <TwoColumnRow
                  label="Rémunération gérant"
                  detail="Salaire Samuel (TNS)"
                  y1={-salaireGerant}
                  y2={-salaireGerant}
                  negative
                />
              )}
              <TwoColumnRow
                label="BÉNÉFICE AVANT IS"
                y1={calc.beneficeAvantIsY1}
                y2={calc.beneficeAvantIsY2}
                bold
              />
              <TwoColumnRow
                label="IS PME (15 % jusqu'à 42,5 k€ puis 25 %)"
                y1={-calc.isY1}
                y2={-calc.isY2}
                negative
              />
              <TwoColumnRow
                label="BÉNÉFICE NET EUREALIMMO"
                y1={calc.beneficeNetY1}
                y2={calc.beneficeNetY2}
                bold
                highlight
              />
            </div>

            {/* EXIT */}
            <div
              style={{
                background: "#ede9fe",
                border: `2px solid ${SOLANA}`,
                borderRadius: 12,
                padding: 16,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#5b21b6",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 10,
                }}
              >
                🚪 Si exit Eurealimmo à {eurM(produitNetCession)}
              </div>
              <div
                style={{
                  background: "#fff",
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 12, color: MUTED }}>
                    Prime à verser à Diara ({calc.palier.name}, {pct(calc.palier.pct)})
                  </span>
                  <span
                    style={{
                      fontSize: 16,
                      fontWeight: 700,
                      color: RED,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    − {eur(calc.primeDiara)}
                  </span>
                </div>
              </div>
              <div
                style={{
                  background: "#fff",
                  borderRadius: 8,
                  padding: 12,
                  border: `2px solid ${DM_GREEN}`,
                }}
              >
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 2 }}>
                  Net pour toi (Samuel) après prime Diara
                </div>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 800,
                    color: DM_GREEN,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {eurM(calc.netSamuel)}
                </div>
                <div style={{ fontSize: 10.5, color: MUTED, marginTop: 4 }}>
                  + dividendes cumulés Y1-Y4 :{" "}
                  {eurM(calc.benefice5Ans - calc.beneficeNetY2)}
                </div>
              </div>
            </div>

            {/* INDICATEURS CLÉS */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <Stat
                label="Marge nette / CA"
                value={`${((calc.beneficeNetY2 / calc.caBrutReseau) * 100).toFixed(1)} %`}
                hint="Rentabilité Eurealimmo SARL"
              />
              <Stat
                label="Bénéfice / Fondateur"
                value={eurM(calc.beneficeNetY2 / Math.max(1, nbFondateurs))}
                hint="Y2+ par Fondateur recruté"
              />
            </div>

            {/* NOTE LÉGALE */}
            <div
              style={{
                fontSize: 10,
                color: MUTED,
                lineHeight: 1.5,
                padding: 12,
                background: BG_SUBTLE,
                borderRadius: 8,
                marginTop: 14,
              }}
            >
              📜 Simulation basée sur le contrat Diara CAMARA (modèle
              extrapolé aux 60 Fondateurs). Marges : 5 % retenu Eurealimmo
              − referral 18 % HNWI / 15 % Std payé aux Fondateurs parrains
              (effet boule de neige Niveau 1 art. 7.2 bis). Diara seule
              touche 20 % HNWI sur ses propres filleuls (statut Associée
              Fondatrice). Hypothèse simplifiée : tous les filleuls sont
              traités au taux 18/15 %. Hors TVA. IS PME 15 % jusqu'à
              42 500 € puis 25 %. Valorisation indicative — un acquéreur
              déduira aussi le passif L134-12 latent.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// LIGNE DE TABLEAU 2 COLONNES (Y1 vs Y2+)
// =============================================================================
function TwoColumnRow({
  label,
  detail,
  y1,
  y2,
  negative,
  bold,
  highlight,
}: {
  label: string;
  detail?: string;
  y1: number;
  y2: number;
  negative?: boolean;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        padding: "10px 14px",
        borderBottom: `1px solid ${BORDER}`,
        display: "grid",
        gridTemplateColumns: "1fr 100px 100px",
        alignItems: "center",
        background: highlight ? "#ecfdf5" : "transparent",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: bold ? 700 : 600,
            color: bold ? DM_DARK : TEXT,
          }}
        >
          {label}
        </div>
        {detail && (
          <div style={{ fontSize: 10.5, color: MUTED, marginTop: 2 }}>
            {detail}
          </div>
        )}
      </div>
      <div
        style={{
          textAlign: "right",
          fontSize: bold ? 14 : 13,
          fontWeight: bold ? 800 : 600,
          color: negative ? RED : bold ? DM_DARK : TEXT,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {y1 === 0 ? "—" : `${y1 < 0 ? "−" : ""}${eur(Math.abs(y1))}`}
      </div>
      <div
        style={{
          textAlign: "right",
          fontSize: bold ? 14 : 13,
          fontWeight: bold ? 800 : 600,
          color: negative ? RED : bold ? DM_DARK : TEXT,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {y2 === 0 ? "—" : `${y2 < 0 ? "−" : ""}${eur(Math.abs(y2))}`}
      </div>
    </div>
  );
}
