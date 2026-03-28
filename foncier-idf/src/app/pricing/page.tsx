"use client";

import { useState } from "react";
import Link from "next/link";
import ProModal from "@/components/ProModal";

const PLANS = [
  {
    name: "Gratuit",
    price: "0 €",
    period: "pour toujours",
    description: "Top 30 communes IDF + Oise — transactions 2024-2025",
    color: "rgba(255,255,255,0.5)",
    borderColor: "rgba(255,255,255,0.1)",
    features: [
      { text: "Top 30 communes IDF + Oise", included: true },
      { text: "Points DVF 2024-2025", included: true },
      { text: "Micro-marchés", included: true },
      { text: "Prix médian + écart département", included: true },
      { text: "Anomalies de prix inter-zones", included: true },
      { text: "Top 100 communes", included: false },
      { text: "Historique 2020-2025", included: false },
      { text: "Évolution annuelle des prix", included: false },
      { text: "Export PDF investisseur", included: false },
    ],
    cta: "C'est déjà gratuit",
    ctaStyle: "outline" as const,
  },
  {
    name: "Pro",
    price: "29 €",
    period: "/mois",
    description: "Top 100 communes — historique complet 2020-2025",
    color: "#00ff88",
    borderColor: "rgba(0,255,136,0.3)",
    badge: "14 jours gratuits",
    features: [
      { text: "Tout le plan Gratuit", included: true },
      { text: "Top 100 communes IDF + Oise", included: true },
      { text: "Historique complet 2020-2025", included: true },
      { text: "Évolution annuelle des prix", included: true },
      { text: "Comparables détaillés par zone", included: true },
      { text: "Export PDF investisseur", included: true },
      { text: "Alertes nouvelles ventes", included: true },
      { text: "Score investissement avancé", included: true },
      { text: "Support prioritaire", included: true },
    ],
    cta: "Essai gratuit 14 jours",
    ctaStyle: "primary" as const,
  },
  {
    name: "Enterprise",
    price: "Sur devis",
    period: "",
    description: "Pour les promoteurs, foncières et collectivités",
    color: "#a855f7",
    borderColor: "rgba(168,85,247,0.3)",
    features: [
      { text: "Tout le plan Pro", included: true },
      { text: "API d'accès aux données", included: true },
      { text: "Analyses sur-mesure", included: true },
      { text: "Données parcellaires enrichies", included: true },
      { text: "Prospection foncière assistée", included: true },
      { text: "Intégration CRM", included: true },
      { text: "Accompagnement dédié", included: true },
    ],
    cta: "Nous contacter",
    ctaStyle: "outline" as const,
  },
];

export default function PricingPage() {
  const [showProModal, setShowProModal] = useState(false);

  return (
    <div style={{ minHeight: "100vh", background: "#070714", color: "#e8e8f0", fontFamily: "Segoe UI, Arial, sans-serif", paddingTop: 52 }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, rgba(0,212,255,0.06), rgba(0,255,136,0.04))", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "16px 32px" }}>
        <Link href="/" style={{ color: "rgba(0,212,255,0.7)", textDecoration: "none", fontSize: 13 }}>← Retour</Link>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px" }}>
        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(0,255,136,0.1)", border: "1px solid rgba(0,255,136,0.25)",
            borderRadius: 99, padding: "5px 14px", fontSize: 11, color: "#00ff88",
            letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, marginBottom: 16,
          }}>
            Pricing
          </div>
          <h1 style={{ margin: 0, fontSize: "clamp(28px, 4vw, 44px)", fontWeight: 800, color: "#fff", lineHeight: 1.15 }}>
            L&apos;analyse immobilière,
            <br />
            <span style={{ background: "linear-gradient(90deg, #00ff88, #00d4ff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              à votre niveau d&apos;ambition
            </span>
          </h1>
          <p style={{ margin: "16px 0 0", fontSize: 15, color: "rgba(255,255,255,0.5)", maxWidth: 480, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
            Commencez gratuitement. Passez Pro quand vous êtes prêt à investir avec précision.
          </p>
        </div>

        {/* Plans grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))", gap: 16, alignItems: "start" }}>
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${plan.borderColor}`,
                borderRadius: 16,
                padding: "28px 24px",
                position: "relative",
                transition: "border-color 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = plan.color)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = plan.borderColor)}
            >
              {plan.badge && (
                <div style={{
                  position: "absolute", top: -10, right: 16,
                  background: "linear-gradient(135deg, #00ff88, #00d4ff)",
                  color: "#0a0a1e", fontSize: 10, fontWeight: 800,
                  padding: "4px 12px", borderRadius: 99, letterSpacing: 0.5,
                }}>
                  {plan.badge}
                </div>
              )}

              <div style={{ fontSize: 13, fontWeight: 700, color: plan.color, marginBottom: 8 }}>{plan.name}</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 32, fontWeight: 900, color: "#fff" }}>{plan.price}</span>
                {plan.period && <span style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>{plan.period}</span>}
              </div>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 20, lineHeight: 1.5 }}>{plan.description}</p>

              {/* Features */}
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
                {plan.features.map((f) => (
                  <div key={f.text} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ color: f.included ? "#00ff88" : "rgba(255,255,255,0.15)", fontSize: 12, marginTop: 1, flexShrink: 0 }}>
                      {f.included ? "✓" : "—"}
                    </span>
                    <span style={{ fontSize: 12, color: f.included ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.25)", lineHeight: 1.4 }}>
                      {f.text}
                    </span>
                  </div>
                ))}
              </div>

              {/* CTA */}
              <button
                onClick={() => {
                  if (plan.ctaStyle === "primary") setShowProModal(true);
                }}
                style={{
                  width: "100%",
                  padding: "12px 20px",
                  borderRadius: 10,
                  border: plan.ctaStyle === "primary" ? "none" : `1px solid ${plan.borderColor}`,
                  background: plan.ctaStyle === "primary"
                    ? "linear-gradient(135deg, #00ff88, #00d4ff)"
                    : "rgba(255,255,255,0.04)",
                  color: plan.ctaStyle === "primary" ? "#0a0a1e" : "rgba(255,255,255,0.5)",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                  fontFamily: "Segoe UI, Arial, sans-serif",
                  transition: "all 0.15s",
                  ...(plan.ctaStyle === "primary" ? { boxShadow: "0 4px 20px rgba(0,255,136,0.2)" } : {}),
                }}
                onMouseEnter={(e) => {
                  if (plan.ctaStyle === "primary") e.currentTarget.style.transform = "scale(1.02)";
                  else e.currentTarget.style.borderColor = plan.color;
                }}
                onMouseLeave={(e) => {
                  if (plan.ctaStyle === "primary") e.currentTarget.style.transform = "scale(1)";
                  else e.currentTarget.style.borderColor = plan.borderColor;
                }}
              >
                {plan.cta}
              </button>
            </div>
          ))}
        </div>

        {/* FAQ-like section */}
        <div style={{ marginTop: 48, textAlign: "center" }}>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.35)", lineHeight: 1.7 }}>
            Pas de carte bancaire requise pour l&apos;essai gratuit · Annulable à tout moment
            <br />
            Des questions ? <a href="mailto:contact@datamerry.com" style={{ color: "#00d4ff", textDecoration: "none" }}>contact@datamerry.com</a>
          </p>
        </div>
      </div>

      <ProModal open={showProModal} onClose={() => setShowProModal(false)} />
    </div>
  );
}
