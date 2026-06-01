"use client";

/**
 * Simulateur de rente passive recrutement — Option B effet viral.
 *
 * Affiche combien le visiteur peut toucher en parrainant d'autres mandataires.
 * Toggle 20% (Associée Fondatrice / Diara) / 18% (Fondateur) / 15% (Standard).
 *
 * Si la page est ouverte avec ?ref=DIARA → tier défaut = 18% (ce que ses filleuls toucheront)
 * Si pas de code → tier défaut = 18% (tier Fondateur public par défaut)
 *
 * Inputs :
 *   - Nombre de filleuls actifs (1-20)
 *   - Ventes par filleul / an (1-5)
 *   - Ticket moyen vente (slider 300 k€ - 5 M€)
 *
 * Output : rente annuelle + cumulée 5 ans.
 */

import { useState, useMemo } from "react";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

// Tiers possibles
const TIERS = [
  {
    value: 0.20,
    label: "20 %",
    title: "Associée Fondatrice",
    hint: "Réservé Diara — co-fondatrice",
  },
  {
    value: 0.18,
    label: "18 %",
    title: "Fondateur Privilège",
    hint: "Toi si tu rejoins via Diara",
  },
  {
    value: 0.15,
    label: "15 %",
    title: "Standard",
    hint: "Toi si tu rejoins en public (12 mois)",
  },
] as const;

const COMMISSION_AGENCE = 0.03; // 3% sur ticket HWNI (cohérent avec RevenueSimulator)
const RETENUE_EUREALIMMO = 0.05; // 5% (Fondateur — référence pour le calcul de la retenue)

function formatEur(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function ReferralSimulator({
  initialTier = 0.18,
}: {
  initialTier?: number;
}) {
  const [nbFilleuls, setNbFilleuls] = useState(5);
  const [ventesParAn, setVentesParAn] = useState(2);
  const [ticket, setTicket] = useState(1_500_000);
  const [tier, setTier] = useState(initialTier);

  const stats = useMemo(() => {
    const comBrutePerVente = ticket * COMMISSION_AGENCE;
    const comBrutePerFilleul = comBrutePerVente * ventesParAn;
    const retenuePerFilleul = comBrutePerFilleul * RETENUE_EUREALIMMO;
    const referralPerFilleul = retenuePerFilleul * tier;
    const totalAnnuel = referralPerFilleul * nbFilleuls;
    const total5ans = totalAnnuel * 5;

    return {
      comBrutePerVente,
      comBrutePerFilleul,
      retenuePerFilleul,
      referralPerFilleul,
      totalAnnuel,
      total5ans,
    };
  }, [nbFilleuls, ventesParAn, ticket, tier]);

  return (
    <section
      style={{
        padding: "70px 24px",
        background: `linear-gradient(135deg, ${DARK} 0%, #1e293b 100%)`,
        color: "white",
      }}
      id="referral-simulator"
    >
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <div
          style={{
            display: "inline-block",
            padding: "6px 14px",
            background: `${PRIMARY}22`,
            border: `1px solid ${PRIMARY}`,
            borderRadius: 999,
            fontSize: 11,
            color: PRIMARY,
            letterSpacing: "0.15em",
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          ✨ EFFET VIRAL — RENTE PASSIVE À VIE
        </div>
        <h2
          style={{
            fontFamily: "Georgia, serif",
            fontSize: 32,
            fontWeight: 700,
            margin: "0 0 12px",
            color: "white",
          }}
        >
          Combien je gagne en parrainant ?
        </h2>
        <p style={{ color: "#cbd5e1", fontSize: 15, marginBottom: 40, maxWidth: 680 }}>
          En tant que mandataire Eurealimmo, tu peux toi-même recruter d&apos;autres mandataires et
          toucher un pourcentage <strong style={{ color: "white" }}>à vie</strong> sur les retenues
          que nous prenons sur leurs ventes. <strong style={{ color: PRIMARY }}>1 seul niveau</strong> —
          simple, lisible, sans pyramide.
        </p>

        {/* Toggle tier */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 10,
            marginBottom: 28,
          }}
        >
          {TIERS.map((t) => {
            const selected = tier === t.value;
            return (
              <button
                key={t.value}
                onClick={() => setTier(t.value)}
                type="button"
                style={{
                  padding: "16px 12px",
                  background: selected ? PRIMARY : "rgba(255,255,255,0.05)",
                  color: selected ? DARK : "#cbd5e1",
                  border: selected
                    ? `2px solid ${PRIMARY}`
                    : `1px solid rgba(255,255,255,0.15)`,
                  borderRadius: 8,
                  cursor: "pointer",
                  fontWeight: 700,
                  fontSize: 22,
                  fontFamily: "Georgia, serif",
                  transition: "all 0.15s ease",
                  textAlign: "center",
                }}
                aria-pressed={selected}
              >
                <div>{t.label}</div>
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: "system-ui, sans-serif",
                    fontWeight: 700,
                    letterSpacing: "0.05em",
                    marginTop: 6,
                    color: selected ? DARK : PRIMARY,
                  }}
                >
                  {t.title}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontFamily: "system-ui, sans-serif",
                    fontWeight: 500,
                    marginTop: 2,
                    color: selected ? DARK : "#94a3b8",
                  }}
                >
                  {t.hint}
                </div>
              </button>
            );
          })}
        </div>

        {/* Sliders */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 20,
            marginBottom: 28,
            padding: 24,
            background: "rgba(255,255,255,0.03)",
            border: `1px solid rgba(255,255,255,0.1)`,
            borderRadius: 8,
          }}
        >
          <SliderInput
            label="👥 Nombre de filleuls actifs"
            value={nbFilleuls}
            displayValue={`${nbFilleuls} ${nbFilleuls > 1 ? "filleuls" : "filleul"}`}
            min={1}
            max={20}
            step={1}
            minLabel="1"
            maxLabel="20"
            onChange={setNbFilleuls}
          />
          <SliderInput
            label="📅 Ventes / filleul / an"
            value={ventesParAn}
            displayValue={`${ventesParAn} ${ventesParAn > 1 ? "ventes" : "vente"}`}
            min={1}
            max={5}
            step={1}
            minLabel="1"
            maxLabel="5"
            onChange={setVentesParAn}
          />
          <SliderInput
            label="💼 Ticket moyen vente"
            value={ticket}
            displayValue={formatEur(ticket)}
            min={300_000}
            max={5_000_000}
            step={50_000}
            minLabel="300 k€"
            maxLabel="5 M€"
            onChange={setTicket}
          />
        </div>

        {/* Sub-résumé chiffré */}
        <div
          style={{
            padding: "16px 20px",
            background: "rgba(255,255,255,0.05)",
            borderRadius: 8,
            marginBottom: 24,
            fontSize: 13,
            color: "#cbd5e1",
            lineHeight: 1.8,
          }}
        >
          <div>
            • Commission brute / filleul / an :{" "}
            <strong style={{ color: "white" }}>{formatEur(stats.comBrutePerFilleul)}</strong>{" "}
            <span style={{ color: "#94a3b8" }}>(comm. agence 3 % × ventes)</span>
          </div>
          <div>
            • Retenue Eurealimmo / filleul (5 %) :{" "}
            <strong style={{ color: "white" }}>{formatEur(stats.retenuePerFilleul)}</strong>
          </div>
          <div>
            • Ton referral / filleul ({(tier * 100).toFixed(0)} %) :{" "}
            <strong style={{ color: PRIMARY }}>
              {formatEur(stats.referralPerFilleul)} / an
            </strong>
          </div>
        </div>

        {/* Résultats */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
          }}
        >
          <ResultCard
            label="Rente annuelle"
            value={formatEur(stats.totalAnnuel)}
            sub={`${nbFilleuls} filleul${nbFilleuls > 1 ? "s" : ""} × ${formatEur(
              stats.referralPerFilleul,
            )} / an`}
            color={PRIMARY}
          />
          <ResultCard
            label="Cumulé sur 5 ans"
            value={formatEur(stats.total5ans)}
            sub="Locké à vie tant que les filleuls restent actifs"
            color="#10b981"
          />
        </div>

        {/* Méthode */}
        <details
          style={{
            background: "rgba(255,255,255,0.03)",
            border: `1px solid rgba(255,255,255,0.1)`,
            borderRadius: 6,
            padding: "12px 16px",
            fontSize: 12,
            color: "#cbd5e1",
            marginTop: 24,
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              fontWeight: 700,
              color: "white",
              fontSize: 13,
            }}
          >
            ⚙️ Comment ça marche — formule
          </summary>
          <div style={{ marginTop: 12, lineHeight: 1.7 }}>
            <strong style={{ color: "white" }}>1 seul niveau de parrainage</strong> (pas de MLM
            multi-niveaux). Tu touches ton % uniquement sur les retenues de tes filleuls{" "}
            <strong>directs</strong>.
            <br /><br />
            <strong style={{ color: "white" }}>Formule :</strong>
            <br />
            <code style={{ color: PRIMARY }}>
              Ticket × 3 % comm. agence × Ventes/an × 5 % retenue × Ton % referral × Nb filleuls
            </code>
            <br /><br />
            <strong style={{ color: "white" }}>Chaîne pour Eurealimmo :</strong>
            <br />
            • Diara (Associée Fondatrice) : 20 % sur ses recrues directes (Niveau 1)
            <br />
            • Tes recrues Fondateur : 18 % à vie sur leurs propres recrues directes
            <br />
            • Tes recrues Standard : 15 % sur 12 mois
            <br /><br />
            <strong style={{ color: "white" }}>Versement</strong> trimestriel, payé uniquement sur
            commissions effectivement encaissées par Eurealimmo. Aucune trésorerie à avancer.
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

function SliderInput({
  label,
  value,
  displayValue,
  min,
  max,
  step,
  minLabel,
  maxLabel,
  onChange,
}: {
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step: number;
  minLabel: string;
  maxLabel: string;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 700,
          color: "#cbd5e1",
          marginBottom: 8,
          letterSpacing: "0.02em",
        }}
      >
        {label}
      </label>
      <div
        style={{
          fontFamily: "Georgia, serif",
          fontSize: 24,
          fontWeight: 700,
          color: PRIMARY,
          marginBottom: 6,
        }}
      >
        {displayValue}
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
          accentColor: PRIMARY,
          cursor: "pointer",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: "#64748b",
          marginTop: 2,
        }}
      >
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function ResultCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div
      style={{
        padding: 24,
        background: "rgba(255,255,255,0.05)",
        border: `2px solid ${color}`,
        borderRadius: 8,
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 11,
          letterSpacing: "0.15em",
          color: color,
          fontWeight: 700,
          marginBottom: 12,
        }}
      >
        {label.toUpperCase()}
      </div>
      <div
        style={{
          fontFamily: "Georgia, serif",
          fontSize: 32,
          fontWeight: 700,
          color: "white",
          marginBottom: 8,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: "#94a3b8", lineHeight: 1.5 }}>{sub}</div>
    </div>
  );
}
