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

    // ── Net après retenue réseau (commission HT facturée par le mandataire) ──
    // C'est le chiffre UNIVERSEL : indépendant de la structure juridique
    const netHtFondateur = comBruteTotal * (1 - 0.05); // 5% retenue
    const netHtStandard = comBruteTotal * (1 - 0.08); // 8% retenue
    const netHtOlean = comBruteTotal * (1 - 0.10); // 10% retenue

    // ── Estimation indicative net cash perso (SASU+IS+PFU30%) ──
    // Affichée seulement en sous-info, dépend de la structure
    const netPersoFondateur = netCashPerso(netHtFondateur);
    const netPersoStandard = netCashPerso(netHtStandard);
    const netPersoOlean = netCashPerso(netHtOlean);

    return {
      comBruteTotal,
      // Commission HT après retenue (universel)
      netHtFondateur,
      netHtStandard,
      netHtOlean,
      gainHtFondateur: netHtFondateur - netHtOlean,
      gainHtStandard: netHtStandard - netHtOlean,
      // Net cash perso (indicatif SASU)
      netPersoFondateur,
      netPersoStandard,
      netPersoOlean,
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
        <p style={{ textAlign: "center", color: "#64748b", maxWidth: 680, margin: "0 auto 40px" }}>
          Simulateur Année 1 — commission HT que vous facturez après retenue du réseau.
          <br />
          <span style={{ fontSize: 12, color: "#94a3b8" }}>
            Hors fiscalité personnelle (dépend de votre structure : micro-BNC, EI, SASU, EURL…).
          </span>
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
          {/* Autre réseau référence (10% retenue) */}
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
              AUTRE RÉSEAU (RÉFÉRENCE 10 %)
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
              {formatEur(stats.netHtOlean)}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>commission HT après retenue</div>
            <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 8, fontStyle: "italic" }}>
              ≈ {formatEur(stats.netPersoOlean)} net perso indicatif*
            </div>
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
              {formatEur(stats.netHtStandard)}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 8 }}>commission HT après retenue</div>
            {stats.gainHtStandard > 0 && (
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
                +{formatEur(stats.gainHtStandard)} vs autre réseau
              </div>
            )}
            <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>
              ≈ {formatEur(stats.netPersoStandard)} net perso indicatif*
            </div>
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
              {formatEur(stats.netHtFondateur)}
            </div>
            <div style={{ fontSize: 11, color: "#cbd5e1", marginBottom: 8 }}>commission HT après retenue</div>
            {stats.gainHtFondateur > 0 && (
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
                +{formatEur(stats.gainHtFondateur)} vs autre réseau
              </div>
            )}
            <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 8, fontStyle: "italic" }}>
              ≈ {formatEur(stats.netPersoFondateur)} net perso indicatif*
            </div>
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
            <strong>Chiffre principal — commission HT après retenue (universel) :</strong>
            <br />
            Commission agence brute (ticket × {(commissionPct * 100).toFixed(0)} %) − retenue du réseau (5 %, 8 % ou 10 %) = ce que vous facturez en HT à Eurealimmo. <strong>Ce chiffre ne dépend PAS de votre structure juridique</strong> — c&apos;est ce qui arrive sur le compte de votre entité avant fiscalité personnelle.
            <br /><br />

            <strong>* Net perso indicatif — fiscalité selon votre structure :</strong>
            <br />
            Le chiffre en italique sous chaque colonne est une estimation basée sur l&apos;hypothèse <strong>SASU à l&apos;IS + dividendes PFU 30 %</strong>, avec 2 750 € de charges fixes Y1 (RCP, comptable, ALUR, CCI, frais bancaires). Les autres structures donneront des résultats différents :
            <br /><br />

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", fontSize: 11, borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f1f5f9" }}>
                    <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #cbd5e1" }}>Structure</th>
                    <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #cbd5e1" }}>Cotisations sociales</th>
                    <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #cbd5e1" }}>Impôt</th>
                    <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #cbd5e1" }}>Profil typique</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: 6, borderBottom: "1px solid #e2e8f0" }}><strong>Micro-BNC</strong> (auto-entrepreneur)</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #e2e8f0" }}>~21,2 % CA</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #e2e8f0" }}>IR sur 66 % CA (abattement 34 %)</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #e2e8f0" }}>Démarrage &lt; 77 700 €/an</td>
                  </tr>
                  <tr>
                    <td style={{ padding: 6, borderBottom: "1px solid #e2e8f0" }}><strong>EI réel BNC</strong></td>
                    <td style={{ padding: 6, borderBottom: "1px solid #e2e8f0" }}>~45 % du bénéfice (TNS)</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #e2e8f0" }}>IR progressif (TMI 11-45 %)</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #e2e8f0" }}>77-150 k€/an, charges réelles</td>
                  </tr>
                  <tr style={{ background: "#fefce8" }}>
                    <td style={{ padding: 6, borderBottom: "1px solid #e2e8f0" }}><strong>SASU à l&apos;IS</strong> (notre hypothèse*)</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #e2e8f0" }}>0 % si dividendes</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #e2e8f0" }}>IS 15-25 % + PFU 30 %</td>
                    <td style={{ padding: 6, borderBottom: "1px solid #e2e8f0" }}>HWNI / &gt; 100 k€/an</td>
                  </tr>
                  <tr>
                    <td style={{ padding: 6 }}><strong>EURL à l&apos;IS</strong></td>
                    <td style={{ padding: 6 }}>~45 % rémunération + 17,2 % PS sur div. &gt; 10 % capital</td>
                    <td style={{ padding: 6 }}>IS + IR rémunération</td>
                    <td style={{ padding: 6 }}>Profil intermédiaire</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <br />
            <strong>Limites :</strong> Cette simulation est indicative. Délai d&apos;encaissement réel
            entre signature mandat et versement perso : <strong>3-6 mois</strong>. La TVA collectée
            (20 % sur la facturation HT) transite par votre compte mais doit être reversée à
            l&apos;État. <strong>Consultez un expert-comptable pour le choix de structure le plus
            adapté à votre situation.</strong>
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
