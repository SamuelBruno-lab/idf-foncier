"use client";

import { useMemo, useState } from "react";

// =============================================================================
// PARAMÈTRES CONTRACTUELS — extraits du contrat Diara CAMARA
// (contrat-mandat-diara-eurealimmo.docx, articles 6 / 7 / 8)
// =============================================================================
const CONTRACT = {
  // Article 6.1 — Rétrocession 95 % HT
  retrocessionPct: 0.95,
  retentionEurealimmoPct: 0.05,
  // Article 6.2 — Forfait mensuel
  monthlyFee: 59,
  // Article 6.3 — Franchise 6 mois Associée Fondatrice
  franchiseMonths: 6,
  // Article 6.4 — Verrouillage 36 mois
  lockMonths: 36,
  // Article 7.2 — Barème Associée Fondatrice
  refHnwiPct: 0.2, // 20 % à vie sur référés HNWI
  refStdPct: 0.15, // 15 % à vie sur référés Standard
  refSignatureBonusStd: 200, // 200 € HT credits DATAMERRY par signature Standard
  capFondateurs: 60, // Cap global réseau
  // Article 7.4 — Seuils HNWI (option D assouplie)
  hnwiThresholdVolume: 7500, // EUR HT commissions / 12 mois
  hnwiThresholdTicket: 1_500_000, // EUR prix net vendeur
  // Article 7.4 bis — Cumul Standards
  hnwiCumulMinPerRef: 3750, // EUR HT mini par référé pour cumul
  // Article 8.3 — Paliers prime de cession (EXCLUSIF Diara)
  cessionPaliers: [
    { name: "BASE", unitsMin: 5, hnwiMin: 0, pct: 0.05, cap: 99_000 },
    { name: "BONUS 1", unitsMin: 10, hnwiMin: 0, pct: 0.06, cap: 124_000 },
    { name: "BONUS 2", unitsMin: 15, hnwiMin: 0, pct: 0.07, cap: 149_000 },
    { name: "BONUS 3", unitsMin: 20, hnwiMin: 3, pct: 0.09, cap: 199_000 },
  ] as const,
  // Article 8.3 — Conversion unités
  unitHnwi: 1,
  unitStd: 0.2,
  // Article 8.2 — Fenêtre 5 ans
  cessionWindowYears: 5,
};

const GOLD = "#c8a25d";
const DM_DARK = "#064e3b";
const DM_GREEN = "#10b981";
const SOLANA = "#9945ff";
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

function pct(n: number): string {
  return `${(n * 100).toFixed(0)} %`;
}

type Palier = (typeof CONTRACT.cessionPaliers)[number];

function determinePalier(units: number, hnwiCount: number): Palier | null {
  let best: Palier | null = null;
  for (const p of CONTRACT.cessionPaliers) {
    if (units >= p.unitsMin && hnwiCount >= p.hnwiMin) best = p;
  }
  return best;
}

// =============================================================================
// COMPOSANT SLIDER
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
    <label style={{ display: "block", marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>
          {label}
        </span>
        <span
          style={{
            fontSize: 14,
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
          accentColor: GOLD,
          cursor: "pointer",
        }}
      />
      {hint && (
        <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{hint}</div>
      )}
    </label>
  );
}

// =============================================================================
// COMPOSANT PRINCIPAL — Simulateur Diara
// =============================================================================
export default function DiaraSimulator() {
  // ---- Mes ventes propres ----
  const [mesVentes, setMesVentes] = useState(2); // ventes/an
  const [monTicket, setMonTicket] = useState(1_500_000); // EUR
  const [maCommissionPct, setMaCommissionPct] = useState(4); // % du prix

  // ---- Filleuls HNWI ----
  const [nbFilleulsHnwi, setNbFilleulsHnwi] = useState(3);
  const [ventesParFilleulHnwi, setVentesParFilleulHnwi] = useState(2);
  const [ticketFilleulHnwi, setTicketFilleulHnwi] = useState(2_000_000);
  const [commissionFilleulHnwi, setCommissionFilleulHnwi] = useState(3.5);

  // ---- Filleuls Standard ----
  const [nbFilleulsStd, setNbFilleulsStd] = useState(5);
  const [ventesParFilleulStd, setVentesParFilleulStd] = useState(4);
  const [ticketFilleulStd, setTicketFilleulStd] = useState(500_000);
  const [commissionFilleulStd, setCommissionFilleulStd] = useState(4);

  // ---- Cession ----
  const [produitNetCession, setProduitNetCession] = useState(5_000_000);
  const [horizon, setHorizon] = useState<1 | 3 | 5>(5);

  // =============================================================================
  // CALCULS — sans aucun appel API, tout côté client
  // =============================================================================
  const calc = useMemo(() => {
    // ---- 1. Mes commissions propres (Article 6.1) ----
    // Commission HT totale = prix × commission%
    const commissionHtUnitaire = monTicket * (maCommissionPct / 100);
    const commissionHtAnnuelle = commissionHtUnitaire * mesVentes;
    // Net Diara après retenue 5 % Eurealimmo
    const masRevenueAnnuelle = commissionHtAnnuelle * CONTRACT.retrocessionPct;

    // ---- 2. Referral fees HNWI (Article 7.2) ----
    // Commission générée par chaque filleul HNWI / an
    const commissionFilleulHnwiAnnuelle =
      ticketFilleulHnwi * (commissionFilleulHnwi / 100) * ventesParFilleulHnwi;
    // 20 % de la commission RETENUE par Eurealimmo (= commission brute encaissée)
    const refHnwiAnnuel =
      commissionFilleulHnwiAnnuelle * CONTRACT.refHnwiPct * nbFilleulsHnwi;

    // ---- 3. Referral fees Standard (Article 7.2) ----
    const commissionFilleulStdAnnuelle =
      ticketFilleulStd * (commissionFilleulStd / 100) * ventesParFilleulStd;
    const refStdAnnuel =
      commissionFilleulStdAnnuelle * CONTRACT.refStdPct * nbFilleulsStd;

    // ---- 4. Bonus signature Standard (one-shot Y1) ----
    const bonusSignatureStd = nbFilleulsStd * CONTRACT.refSignatureBonusStd;

    // ---- 5. Forfait à payer (Article 6.2 + franchise 6 mois) ----
    const forfaitY1 =
      Math.max(0, 12 - CONTRACT.franchiseMonths) * CONTRACT.monthlyFee;
    const forfaitAnnuelStandard = CONTRACT.monthlyFee * 12; // après franchise

    // ---- 6. Total revenus ----
    const revenuY1 =
      masRevenueAnnuelle +
      refHnwiAnnuel +
      refStdAnnuel +
      bonusSignatureStd -
      forfaitY1;
    const revenuAnnuelRecurrent =
      masRevenueAnnuelle + refHnwiAnnuel + refStdAnnuel - forfaitAnnuelStandard;
    const revenuY3Cumule = revenuY1 + 2 * revenuAnnuelRecurrent;
    const revenuY5Cumule = revenuY1 + 4 * revenuAnnuelRecurrent;

    // ---- 7. Unités cession (Article 8.3) ----
    const hnwiCount = nbFilleulsHnwi;
    const stdCount = nbFilleulsStd;
    const unites = hnwiCount * CONTRACT.unitHnwi + stdCount * CONTRACT.unitStd;

    // ---- 8. Palier prime cession atteint ----
    const palier = determinePalier(unites, hnwiCount);

    // ---- 9. Montant prime cession ----
    const primeCessionTheorique = palier
      ? produitNetCession * palier.pct
      : 0;
    const primeCessionFinale = palier
      ? Math.min(primeCessionTheorique, palier.cap)
      : 0;

    return {
      // Mes propres revenus
      commissionHtUnitaire,
      commissionHtAnnuelle,
      masRevenueAnnuelle,
      // Referrals
      commissionFilleulHnwiAnnuelle,
      refHnwiAnnuel,
      commissionFilleulStdAnnuelle,
      refStdAnnuel,
      bonusSignatureStd,
      // Forfait
      forfaitY1,
      forfaitAnnuelStandard,
      // Totaux
      revenuY1,
      revenuAnnuelRecurrent,
      revenuY3Cumule,
      revenuY5Cumule,
      // Cession
      unites,
      hnwiCount,
      stdCount,
      palier,
      primeCessionTheorique,
      primeCessionFinale,
    };
  }, [
    mesVentes,
    monTicket,
    maCommissionPct,
    nbFilleulsHnwi,
    ventesParFilleulHnwi,
    ticketFilleulHnwi,
    commissionFilleulHnwi,
    nbFilleulsStd,
    ventesParFilleulStd,
    ticketFilleulStd,
    commissionFilleulStd,
    produitNetCession,
  ]);

  const revenuByHorizon =
    horizon === 1
      ? calc.revenuY1
      : horizon === 3
        ? calc.revenuY3Cumule
        : calc.revenuY5Cumule;

  const valeurTotale5Ans = calc.revenuY5Cumule + calc.primeCessionFinale;

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "32px 20px" }}>
      {/* ============= HEADER ============= */}
      <header
        style={{
          textAlign: "center",
          marginBottom: 32,
          paddingBottom: 24,
          borderBottom: `2px solid ${BORDER}`,
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: GOLD,
            color: "#fff",
            padding: "4px 14px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.5,
            marginBottom: 12,
          }}
        >
          👑 ASSOCIÉE FONDATRICE N° 1
        </div>
        <h1
          style={{
            fontSize: 32,
            fontWeight: 800,
            color: DM_DARK,
            margin: "0 0 8px 0",
          }}
        >
          Simulateur Diara CAMARA
        </h1>
        <p style={{ color: MUTED, fontSize: 14, margin: 0 }}>
          Calcule tes revenus selon les paramètres exacts de ton contrat
          Eurealimmo Réseau&nbsp;— commissions propres, referral fees{" "}
          <strong>à vie</strong>, prime de cession exclusive.
        </p>
      </header>

      {/* ============= LAYOUT 2 COLONNES ============= */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
          gap: 24,
        }}
      >
        {/* ===== COLONNE GAUCHE : INPUTS ===== */}
        <div>
          {/* Section 1 : Mes ventes propres */}
          <section
            style={{
              background: BG_SUBTLE,
              border: `1px solid ${BORDER}`,
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <h2
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: DM_DARK,
                margin: "0 0 16px 0",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              1. Mes ventes propres
            </h2>
            <Slider
              label="Mes ventes / an"
              value={mesVentes}
              min={0}
              max={20}
              step={1}
              unit="ventes"
              onChange={setMesVentes}
              hint="Vente conclue sous mandat Eurealimmo (carte T CPI 7501)"
            />
            <Slider
              label="Ticket moyen de mes ventes"
              value={monTicket}
              min={300_000}
              max={10_000_000}
              step={50_000}
              onChange={setMonTicket}
              format={eur}
              hint="Prix net vendeur — médiane Paris IDF ~650 k€, segment HNWI 1,5-5 M€"
            />
            <Slider
              label="Ma commission moyenne (% du prix)"
              value={maCommissionPct}
              min={1}
              max={8}
              step={0.1}
              unit="%"
              onChange={setMaCommissionPct}
              hint="Honoraires d'agence négociés vendeur — Eurealimmo retient 5 % (Article 6.1)"
            />
          </section>

          {/* Section 2 : Filleuls HNWI */}
          <section
            style={{
              background: "#fef3c7",
              border: `1px solid ${GOLD}`,
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <h2
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#92400e",
                margin: "0 0 4px 0",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              2. Mes filleuls HNWI 👑
            </h2>
            <p
              style={{ fontSize: 11, color: "#92400e", margin: "0 0 14px 0" }}
            >
              ≥ 7&nbsp;500 € HT commissions/12&nbsp;mois OU 1&nbsp;ticket ≥
              1,5&nbsp;M€ — Article 7.4
            </p>
            <Slider
              label="Nombre de filleuls HNWI actifs"
              value={nbFilleulsHnwi}
              min={0}
              max={15}
              step={1}
              unit="filleuls"
              onChange={setNbFilleulsHnwi}
              hint="Tu touches 20 % À VIE de leurs commissions retenues par Eurealimmo"
            />
            <Slider
              label="Ventes / an / filleul HNWI"
              value={ventesParFilleulHnwi}
              min={0}
              max={10}
              step={1}
              unit="ventes"
              onChange={setVentesParFilleulHnwi}
            />
            <Slider
              label="Ticket moyen filleul HNWI"
              value={ticketFilleulHnwi}
              min={500_000}
              max={10_000_000}
              step={100_000}
              onChange={setTicketFilleulHnwi}
              format={eur}
            />
            <Slider
              label="Commission moyenne filleul HNWI"
              value={commissionFilleulHnwi}
              min={1}
              max={8}
              step={0.1}
              unit="%"
              onChange={setCommissionFilleulHnwi}
            />
          </section>

          {/* Section 3 : Filleuls Standard */}
          <section
            style={{
              background: "#dbeafe",
              border: `1px solid #3b82f6`,
              borderRadius: 12,
              padding: 20,
              marginBottom: 20,
            }}
          >
            <h2
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#1e40af",
                margin: "0 0 4px 0",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              3. Mes filleuls Standard
            </h2>
            <p
              style={{ fontSize: 11, color: "#1e40af", margin: "0 0 14px 0" }}
            >
              Non-HNWI — Article 7.2 : 15 % À VIE + bonus signature 200 €
              credits DATAMERRY
            </p>
            <Slider
              label="Nombre de filleuls Standard"
              value={nbFilleulsStd}
              min={0}
              max={50}
              step={1}
              unit="filleuls"
              onChange={setNbFilleulsStd}
              hint="Places ILLIMITÉES (vs 60 places Fondateur)"
            />
            <Slider
              label="Ventes / an / filleul Standard"
              value={ventesParFilleulStd}
              min={0}
              max={15}
              step={1}
              unit="ventes"
              onChange={setVentesParFilleulStd}
            />
            <Slider
              label="Ticket moyen filleul Standard"
              value={ticketFilleulStd}
              min={150_000}
              max={1_500_000}
              step={25_000}
              onChange={setTicketFilleulStd}
              format={eur}
            />
            <Slider
              label="Commission moyenne filleul Standard"
              value={commissionFilleulStd}
              min={1}
              max={8}
              step={0.1}
              unit="%"
              onChange={setCommissionFilleulStd}
            />
          </section>

          {/* Section 4 : Cession Eurealimmo */}
          <section
            style={{
              background: "#ede9fe",
              border: `1px solid ${SOLANA}`,
              borderRadius: 12,
              padding: 20,
            }}
          >
            <h2
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#5b21b6",
                margin: "0 0 4px 0",
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              4. Hypothèse cession Eurealimmo
            </h2>
            <p
              style={{ fontSize: 11, color: "#5b21b6", margin: "0 0 14px 0" }}
            >
              Article 8 — clause exclusive Diara, fenêtre 5 ans, paliers
              cumulatifs
            </p>
            <Slider
              label="Produit Net de Cession Eurealimmo"
              value={produitNetCession}
              min={500_000}
              max={20_000_000}
              step={100_000}
              onChange={setProduitNetCession}
              format={eur}
              hint="= prix brut − impôts − conseil − dettes absorbées − earn-outs (Article 8.5). DATAMERRY exclu (8.2 bis)"
            />
          </section>
        </div>

        {/* ===== COLONNE DROITE : OUTPUTS ===== */}
        <div>
          {/* Sticky pour scroll */}
          <div style={{ position: "sticky", top: 20 }}>
            {/* TOTAL VALEUR */}
            <div
              style={{
                background: `linear-gradient(135deg, ${DM_DARK} 0%, ${DM_GREEN} 100%)`,
                color: "#fff",
                padding: 24,
                borderRadius: 16,
                marginBottom: 16,
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
                💎 Valeur totale 5 ans (revenus cumulés + prime cession)
              </div>
              <div style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.1 }}>
                {eur(valeurTotale5Ans)}
              </div>
              <div style={{ fontSize: 12, opacity: 0.85, marginTop: 6 }}>
                Revenus cumulés Y1-Y5 : {eur(calc.revenuY5Cumule)}
                {" + "}
                Prime cession : {eur(calc.primeCessionFinale)}
              </div>
            </div>

            {/* TOGGLE HORIZON */}
            <div
              style={{
                display: "flex",
                gap: 6,
                marginBottom: 14,
                background: BG_SUBTLE,
                padding: 4,
                borderRadius: 999,
              }}
            >
              {([1, 3, 5] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    borderRadius: 999,
                    border: "none",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 700,
                    background: horizon === h ? GOLD : "transparent",
                    color: horizon === h ? "#fff" : MUTED,
                    transition: "all 0.15s",
                  }}
                >
                  {h === 1 ? "Année 1" : `Cumul ${h} ans`}
                </button>
              ))}
            </div>

            {/* CARTE REVENU HORIZON */}
            <div
              style={{
                background: "#fff",
                border: `2px solid ${GOLD}`,
                borderRadius: 12,
                padding: 20,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: MUTED,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 4,
                }}
              >
                {horizon === 1
                  ? "Revenu Année 1 (forfait gratuit 6 mois)"
                  : `Revenus cumulés ${horizon} ans`}
              </div>
              <div
                style={{ fontSize: 28, fontWeight: 800, color: DM_DARK }}
              >
                {eur(revenuByHorizon)}
              </div>
              <div style={{ fontSize: 12, color: MUTED, marginTop: 6 }}>
                Régime de croisière : {eur(calc.revenuAnnuelRecurrent)}/an
              </div>
            </div>

            {/* DÉTAIL 4 LIGNES */}
            <div
              style={{
                background: "#fff",
                border: `1px solid ${BORDER}`,
                borderRadius: 12,
                overflow: "hidden",
                marginBottom: 16,
              }}
            >
              <Row
                label="📥 Mes commissions propres (Y1)"
                detail={`${mesVentes} ventes × ${eur(calc.commissionHtUnitaire)} × 95 % (Art. 6.1)`}
                amount={calc.masRevenueAnnuelle}
              />
              <Row
                label="💎 Referral fees HNWI (20 % à vie)"
                detail={`${nbFilleulsHnwi} HNWI × ${eur(calc.commissionFilleulHnwiAnnuelle)} commission/an × 20 %`}
                amount={calc.refHnwiAnnuel}
                color={GOLD}
              />
              <Row
                label="📊 Referral fees Standard (15 % à vie)"
                detail={`${nbFilleulsStd} Standards × ${eur(calc.commissionFilleulStdAnnuelle)} commission/an × 15 %`}
                amount={calc.refStdAnnuel}
                color="#3b82f6"
              />
              <Row
                label="🎁 Bonus signature Standard (one-shot Y1)"
                detail={`${nbFilleulsStd} × 200 € en credits DATAMERRY`}
                amount={calc.bonusSignatureStd}
                color="#3b82f6"
              />
              <Row
                label="💸 Forfait Eurealimmo (gratuit 6 mois Y1)"
                detail={`Y1 = ${calc.forfaitY1} € · puis 708 €/an (Art. 6.2-6.3)`}
                amount={-calc.forfaitY1}
                color="#dc2626"
              />
            </div>

            {/* PRIME CESSION */}
            <div
              style={{
                background: "#ede9fe",
                border: `2px solid ${SOLANA}`,
                borderRadius: 12,
                padding: 18,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: "#5b21b6",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 8,
                }}
              >
                🏆 Prime de cession (Article 8 — exclusive)
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginBottom: 12,
                }}
              >
                <Stat
                  label="Unités constituées"
                  value={calc.unites.toFixed(1)}
                  hint={`${calc.hnwiCount} HNWI + ${calc.stdCount} Std × 0,2`}
                />
                <Stat
                  label="Palier atteint"
                  value={calc.palier ? calc.palier.name : "—"}
                  hint={
                    calc.palier
                      ? `${pct(calc.palier.pct)} · plafond ${eur(calc.palier.cap)}`
                      : "Min. 5 unités requises"
                  }
                  highlight={calc.palier?.name === "BONUS 3"}
                />
              </div>
              <div
                style={{
                  background: "#fff",
                  borderRadius: 8,
                  padding: 12,
                  fontSize: 13,
                }}
              >
                <div
                  style={{ color: MUTED, fontSize: 11, marginBottom: 2 }}
                >
                  Sur Produit Net de {eur(produitNetCession)} :
                </div>
                <div style={{ fontWeight: 700, color: DM_DARK }}>
                  {calc.palier
                    ? `${pct(calc.palier.pct)} × ${eur(produitNetCession)} = ${eur(calc.primeCessionTheorique)}`
                    : "Pas éligible (manque d'unités)"}
                </div>
                {calc.palier && calc.primeCessionFinale < calc.primeCessionTheorique && (
                  <div
                    style={{
                      color: "#dc2626",
                      fontSize: 11,
                      marginTop: 2,
                    }}
                  >
                    ⚠️ Plafonné à {eur(calc.palier.cap)}
                  </div>
                )}
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    color: SOLANA,
                    marginTop: 6,
                  }}
                >
                  → {eur(calc.primeCessionFinale)}
                </div>
              </div>
            </div>

            {/* PALIERS TABLE */}
            <div
              style={{
                background: "#fff",
                border: `1px solid ${BORDER}`,
                borderRadius: 12,
                padding: 14,
                marginBottom: 16,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: MUTED,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 8,
                }}
              >
                Barème paliers cession
              </div>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ color: MUTED }}>
                    <th style={{ textAlign: "left", padding: "4px 2px" }}>
                      Palier
                    </th>
                    <th style={{ textAlign: "right", padding: "4px 2px" }}>
                      Seuil
                    </th>
                    <th style={{ textAlign: "right", padding: "4px 2px" }}>
                      %
                    </th>
                    <th style={{ textAlign: "right", padding: "4px 2px" }}>
                      Plafond
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {CONTRACT.cessionPaliers.map((p) => {
                    const isCurrent = calc.palier?.name === p.name;
                    return (
                      <tr
                        key={p.name}
                        style={{
                          background: isCurrent ? "#fef3c7" : "transparent",
                          fontWeight: isCurrent ? 700 : 400,
                        }}
                      >
                        <td style={{ padding: "5px 2px" }}>
                          {isCurrent && "👉 "}
                          {p.name}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            padding: "5px 2px",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {p.unitsMin} u.
                          {p.hnwiMin > 0 && ` + ${p.hnwiMin} HNWI`}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            padding: "5px 2px",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {pct(p.pct)}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            padding: "5px 2px",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {eur(p.cap)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
              }}
            >
              📜 Simulation basée sur le contrat de mandat signé entre
              Diara CAMARA et EUREALIMMO SARL (Articles 6, 7, 8). Les
              chiffres ci-dessus sont des estimations hors taxes,
              hors impôts personnels. Les referral fees sont versés
              à vie tant que le contrat du référé demeure en vigueur
              (Article 7.2). Les paiements sont effectués par virement
              SEPA sous 7 jours ouvrés post-encaissement notaire (Art.
              6.5 et 7.3). La clause de cession est exclusive et
              intuitu personae (Article 8.1) — non transférable.
              DATAMERRY SAS exclu (Article 8.2 bis).
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// SOUS-COMPOSANTS
// =============================================================================
function Row({
  label,
  detail,
  amount,
  color,
}: {
  label: string;
  detail: string;
  amount: number;
  color?: string;
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        borderBottom: `1px solid ${BORDER}`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: color ?? TEXT,
          }}
        >
          {label}
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{detail}</div>
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: amount < 0 ? "#dc2626" : color ?? DM_DARK,
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
  highlight,
}: {
  label: string;
  value: string;
  hint?: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        background: "#fff",
        padding: 10,
        borderRadius: 8,
        border: highlight ? `2px solid ${GOLD}` : `1px solid ${BORDER}`,
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
          color: highlight ? GOLD : DM_DARK,
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
