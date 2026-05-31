"use client";

/**
 * Simulateur de revenus Y1 pour la landing Eurealimmo Réseau.
 *
 * Pédagogique : 2 sliders (ticket vente + nb ventes) → affiche en direct le net
 * cash perso après SASU + IS 15-25% + PFU 30% dividendes, en parallèle pour
 * Standard (8% retenue) ET Fondateur (5% retenue).
 *
 * Note : ces calculs sont indicatifs, basés sur les paramètres fiscaux 2026.
 * Avant lancement effectif, faire valider par un expert-comptable.
 */

import { useState, useMemo } from "react";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

// Charges Y1 incompressibles d'un mandataire en SASU
const CHARGES_Y1 = 2750;

// Options de commission d'agence selon le profil de bien
const COMMISSION_OPTIONS = [
  { value: 0.03, label: "3 %", hint: "HWNI / banque privée" },
  { value: 0.04, label: "4 %", hint: "Premium" },
  { value: 0.05, label: "5 %", hint: "Standard / classique" },
] as const;

// Seuils IS 2026
const IS_THRESHOLD = 42_500;
const IS_RATE_LOW = 0.15;
const IS_RATE_HIGH = 0.25;

// PFU sur dividendes
const PFU_RATE = 0.3;

/**
 * Calcule le net cash perso après SASU à l'IS + dividendes PFU 30%.
 * @param recettes_ht recettes HT après retenue Eurealimmo
 */
function netCashPerso(recettes_ht: number): number {
  const benefice = Math.max(0, recettes_ht - CHARGES_Y1);
  let is = 0;
  if (benefice <= IS_THRESHOLD) {
    is = benefice * IS_RATE_LOW;
  } else {
    is = IS_THRESHOLD * IS_RATE_LOW + (benefice - IS_THRESHOLD) * IS_RATE_HIGH;
  }
  const apresIs = benefice - is;
  return Math.max(0, apresIs * (1 - PFU_RATE));
}

function formatEur(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function RevenueSimulator() {
  const [ticket, setTicket] = useState(1_500_000); // 1,5 M€ par défaut (median HWNI)
  const [nbVentes, setNbVentes] = useState(1);
  const [commissionPct, setCommissionPct] = useState(0.03); // 3 % par défaut (HWNI)

  const stats = useMemo(() => {
    const comBrutePer = ticket * commissionPct;
    const comBruteTotal = comBrutePer * nbVentes;

    // Eurealimmo Fondateur (5% retenue)
    const retenueFondateur = comBruteTotal * 0.05;
    const netHtFondateur = comBruteTotal - retenueFondateur;
    const netPersoFondateur = netCashPerso(netHtFondateur);

    // Eurealimmo Standard (8% retenue)
    const retenueStandard = comBruteTotal * 0.08;
    const netHtStandard = comBruteTotal - retenueStandard;
    const netPersoStandard = netCashPerso(netHtStandard);

    // Olean (10% retenue) — référence
    const retenueOlean = comBruteTotal * 0.1;
    const netHtOlean = comBruteTotal - retenueOlean;
    const netPersoOlean = netCashPerso(netHtOlean);

    return {
      comBruteTotal,
      netPersoFondateur,
      netPersoStandard,
      netPersoOlean,
      gainFondateur: netPersoFondateur - netPersoOlean,
      gainStandard: netPersoStandard - netPersoOlean,
    };
  }, [ticket, nbVentes, commissionPct]);

  return (
    <section style={{ padding: "70px 24px", background: "white" }} id="simulateur">
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <h2
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 32,
            fontWeight: 700,
            textAlign: "center",
            margin: "0 0 12px",
            color: DARK,
          }}
        >
          Combien je vais gagner ?
        </h2>
        <p style={{ textAlign: "center", color: "#64748b", maxWidth: 640, margin: "0 auto 40px" }}>
          Simulateur indicatif Année 1 — bouge les sliders pour voir en direct ton net cash personnel
          après SASU + IS + dividendes PFU 30%.
        </p>

        {/* ─── Inputs ─────────────────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 24,
            marginBottom: 32,
            padding: 24,
            background: "#fafafa",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}
        >
          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 700,
                color: DARK,
                marginBottom: 8,
                letterSpacing: "0.02em",
              }}
            >
              💼 Prix moyen de vos biens
            </label>
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 28,
                fontWeight: 700,
                color: PRIMARY,
                marginBottom: 6,
              }}
            >
              {formatEur(ticket)}
            </div>
            <input
              type="range"
              min={300_000}
              max={5_000_000}
              step={50_000}
              value={ticket}
              onChange={(e) => setTicket(Number(e.target.value))}
              style={{
                width: "100%",
                accentColor: PRIMARY,
                cursor: "pointer",
              }}
              aria-label="Prix moyen des biens"
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "#94a3b8",
                marginTop: 4,
              }}
            >
              <span>300 k€</span>
              <span>5 M€</span>
            </div>
          </div>

          <div>
            <label
              style={{
                display: "block",
                fontSize: 13,
                fontWeight: 700,
                color: DARK,
                marginBottom: 8,
                letterSpacing: "0.02em",
              }}
            >
              📅 Nombre de ventes / an
            </label>
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 28,
                fontWeight: 700,
                color: PRIMARY,
                marginBottom: 6,
              }}
            >
              {nbVentes} {nbVentes > 1 ? "ventes" : "vente"}
            </div>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={nbVentes}
              onChange={(e) => setNbVentes(Number(e.target.value))}
              style={{
                width: "100%",
                accentColor: PRIMARY,
                cursor: "pointer",
              }}
              aria-label="Nombre de ventes par an"
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11,
                color: "#94a3b8",
                marginTop: 4,
              }}
            >
              <span>1</span>
              <span>12</span>
            </div>
          </div>
        </div>

        {/* ─── Toggle commission agence ───────────────────────────────── */}
        <div
          style={{
            marginBottom: 24,
            padding: 20,
            background: "#fafafa",
            borderRadius: 8,
            border: "1px solid #e2e8f0",
          }}
        >
          <label
            style={{
              display: "block",
              fontSize: 13,
              fontWeight: 700,
              color: DARK,
              marginBottom: 12,
              letterSpacing: "0.02em",
              textAlign: "center",
            }}
          >
            💰 Commission d&apos;agence (HT, négociée avec le vendeur)
          </label>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 10,
            }}
          >
            {COMMISSION_OPTIONS.map((opt) => {
              const selected = commissionPct === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => setCommissionPct(opt.value)}
                  type="button"
                  style={{
                    padding: "14px 12px",
                    background: selected ? PRIMARY : "white",
                    color: selected ? DARK : "#475569",
                    border: selected ? `2px solid ${PRIMARY}` : "1px solid #e2e8f0",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontWeight: 700,
                    fontSize: 18,
                    fontFamily: "Georgia, serif",
                    transition: "all 0.15s ease",
                    textAlign: "center",
                  }}
                  aria-pressed={selected}
                  aria-label={`Commission ${opt.label} — ${opt.hint}`}
                >
                  <div>{opt.label}</div>
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: "system-ui, sans-serif",
                      fontWeight: 600,
                      letterSpacing: "0.02em",
                      marginTop: 4,
                      color: selected ? DARK : "#94a3b8",
                    }}
                  >
                    {opt.hint}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── Commission brute commune ───────────────────────────────── */}
        <div
          style={{
            textAlign: "center",
            marginBottom: 24,
            padding: "12px 20px",
            background: "#f1f5f9",
            borderRadius: 6,
            fontSize: 13,
            color: "#475569",
          }}
        >
          Commission agence cumulée ({(commissionPct * 100).toFixed(0)} %) :{" "}
          <strong style={{ color: DARK, fontFamily: "Georgia, serif", fontSize: 16 }}>
            {formatEur(stats.comBruteTotal)}
          </strong>{" "}
          HT
        </div>

        {/* ─── 3 colonnes comparatif ──────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
            marginBottom: 24,
          }}
        >
          {/* Olean reference */}
          <div
            style={{
              padding: 24,
              background: "#fafafa",
              borderRadius: 8,
              border: "1px solid #e2e8f0",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.15em",
                color: "#94a3b8",
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              OLEAN (RÉFÉRENCE)
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>10 % de retenue</div>
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 28,
                fontWeight: 700,
                color: "#64748b",
                marginBottom: 4,
              }}
            >
              {formatEur(stats.netPersoOlean)}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8" }}>net cash perso Y1</div>
          </div>

          {/* Eurealimmo Standard */}
          <div
            style={{
              padding: 24,
              background: "white",
              borderRadius: 8,
              border: `2px solid ${PRIMARY}`,
              textAlign: "center",
              position: "relative",
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.15em",
                color: PRIMARY,
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              EUREALIMMO STANDARD
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>8 % de retenue</div>
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 28,
                fontWeight: 700,
                color: DARK,
                marginBottom: 4,
              }}
            >
              {formatEur(stats.netPersoStandard)}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>net cash perso Y1</div>
            {stats.gainStandard > 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: "#059669",
                  fontWeight: 700,
                  background: "#d1fae5",
                  padding: "4px 10px",
                  borderRadius: 999,
                  display: "inline-block",
                }}
              >
                +{formatEur(stats.gainStandard)} vs Olean
              </div>
            )}
          </div>

          {/* Eurealimmo Fondateur */}
          <div
            style={{
              padding: 24,
              background: DARK,
              color: "white",
              borderRadius: 8,
              border: `2px solid ${PRIMARY}`,
              textAlign: "center",
              boxShadow: `0 0 0 4px ${PRIMARY}30`,
            }}
          >
            <div
              style={{
                fontSize: 11,
                letterSpacing: "0.15em",
                color: PRIMARY,
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              EUREALIMMO FONDATEUR
            </div>
            <div style={{ fontSize: 12, color: "#cbd5e1", marginBottom: 10 }}>5 % de retenue</div>
            <div
              style={{
                fontFamily: "Georgia, serif",
                fontSize: 28,
                fontWeight: 700,
                color: PRIMARY,
                marginBottom: 4,
              }}
            >
              {formatEur(stats.netPersoFondateur)}
            </div>
            <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 8 }}>net cash perso Y1</div>
            {stats.gainFondateur > 0 && (
              <div
                style={{
                  fontSize: 12,
                  color: DARK,
                  fontWeight: 700,
                  background: PRIMARY,
                  padding: "4px 10px",
                  borderRadius: 999,
                  display: "inline-block",
                }}
              >
                +{formatEur(stats.gainFondateur)} vs Olean
              </div>
            )}
          </div>
        </div>

        {/* ─── Note méthodo ───────────────────────────────────────────── */}
        <details
          style={{
            background: "#fafafa",
            border: "1px solid #e2e8f0",
            borderRadius: 6,
            padding: "12px 16px",
            fontSize: 12,
            color: "#475569",
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontWeight: 700,
              color: DARK,
              fontSize: 13,
            }}
          >
            ⚙️ Méthode de calcul (transparence totale)
          </summary>
          <div style={{ marginTop: 10, lineHeight: 1.7 }}>
            <strong>Hypothèses :</strong>
            <ul style={{ paddingLeft: 20, margin: "6px 0" }}>
              <li>Structure juridique : <strong>SASU à l'IS</strong> (recommandée pour HWNI)</li>
              <li>Commission agence : <strong>{(commissionPct * 100).toFixed(0)} %</strong> sur le ticket de vente (modifiable ci-dessus : 3 % HWNI · 4 % premium · 5 % standard)</li>
              <li>Charges fixes Y1 incompressibles : <strong>2 750 €</strong> (RCP, comptable, formation ALUR, CCI, frais bancaires)</li>
              <li>IS : <strong>15 %</strong> jusqu'à 42 500 € de bénéfice, <strong>25 %</strong> au-delà</li>
              <li>Sortie en dividendes : <strong>PFU 30 %</strong> (Flat Tax)</li>
            </ul>
            <strong>Calcul :</strong> Commission brute → Retenue réseau → Recettes SASU HT → −Charges → Bénéfice → −IS → Net entreprise → −PFU 30 % → <strong>Net cash perso</strong>.
            <br /><br />
            <strong>Limites :</strong> Cette simulation est indicative. Délai d&apos;encaissement réel
            entre signature mandat et versement perso : <strong>3-6 mois</strong>. La TVA collectée
            (20 % sur la facturation HT) transite par le compte SASU mais doit être reversée à
            l&apos;État. Pour validation définitive, consultez un expert-comptable.
          </div>
        </details>

        <div style={{ textAlign: "center", marginTop: 32 }}>
          <a
            href="#rejoindre"
            style={{
              display: "inline-block",
              background: PRIMARY,
              color: DARK,
              padding: "16px 32px",
              borderRadius: 4,
              fontSize: 15,
              fontWeight: 700,
              textDecoration: "none",
              letterSpacing: "0.02em",
            }}
          >
            Rejoindre Eurealimmo →
          </a>
        </div>
      </div>
    </section>
  );
}
