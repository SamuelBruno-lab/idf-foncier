"use client";

import { useState } from "react";
import ProBadge from "@/components/ProBadge";
import ProModal from "@/components/ProModal";

interface Props {
  commune: { code: string; nom: string };
}

export default function AnalyseLeadSection({ commune }: Props) {
  const [showProModal, setShowProModal] = useState(false);
  const [proFeature, setProFeature] = useState("");

  const openPro = (feature: string) => {
    setProFeature(feature);
    setShowProModal(true);
  };

  return (
    <>
      <div style={{ marginBottom: 36 }}>
        <h2
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: "rgba(255,255,255,0.5)",
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 16,
          }}
        >
          Aller plus loin · {commune.nom}
        </h2>

        {/* Primary action CTAs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
          <button
            onClick={() => openPro("Comparables détaillés")}
            style={{
              padding: "16px 20px",
              borderRadius: 12,
              border: "1px solid rgba(0,212,255,0.25)",
              background: "linear-gradient(135deg, rgba(0,212,255,0.08), rgba(0,212,255,0.04))",
              color: "#fff",
              cursor: "pointer",
              fontFamily: "Segoe UI, Arial, sans-serif",
              textAlign: "left",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(0,212,255,0.5)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(0,212,255,0.25)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div style={{ fontSize: 18, marginBottom: 8 }}>🔍</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Trouver les biens sous-cotés</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.4 }}>
              Transactions sous la médiane zone par zone
            </div>
          </button>

          <button
            onClick={() => openPro("Score investissement avancé")}
            style={{
              padding: "16px 20px",
              borderRadius: 12,
              border: "1px solid rgba(0,255,136,0.25)",
              background: "linear-gradient(135deg, rgba(0,255,136,0.08), rgba(0,255,136,0.04))",
              color: "#fff",
              cursor: "pointer",
              fontFamily: "Segoe UI, Arial, sans-serif",
              textAlign: "left",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(0,255,136,0.5)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(0,255,136,0.25)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div style={{ fontSize: 18, marginBottom: 8 }}>📈</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Estimer mon bien plus précisément</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.4 }}>
              Comparables + tendance micro-zone
            </div>
          </button>

          <button
            onClick={() => openPro("Export PDF investisseur")}
            style={{
              padding: "16px 20px",
              borderRadius: 12,
              border: "1px solid rgba(168,85,247,0.25)",
              background: "linear-gradient(135deg, rgba(168,85,247,0.08), rgba(168,85,247,0.04))",
              color: "#fff",
              cursor: "pointer",
              fontFamily: "Segoe UI, Arial, sans-serif",
              textAlign: "left",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(168,85,247,0.5)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(168,85,247,0.25)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div style={{ fontSize: 18, marginBottom: 8 }}>📄</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Télécharger une analyse investisseur</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.4 }}>
              PDF professionnel avec scoring et comparables
            </div>
          </button>

          <button
            onClick={() => openPro("Alertes nouvelles ventes")}
            style={{
              padding: "16px 20px",
              borderRadius: 12,
              border: "1px solid rgba(251,191,36,0.25)",
              background: "linear-gradient(135deg, rgba(251,191,36,0.08), rgba(251,191,36,0.04))",
              color: "#fff",
              cursor: "pointer",
              fontFamily: "Segoe UI, Arial, sans-serif",
              textAlign: "left",
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "rgba(251,191,36,0.5)";
              e.currentTarget.style.transform = "translateY(-1px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "rgba(251,191,36,0.25)";
              e.currentTarget.style.transform = "translateY(0)";
            }}
          >
            <div style={{ fontSize: 18, marginBottom: 8 }}>🔔</div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Détecter des opportunités</div>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.4 }}>
              Alertes quand un bien sous-coté apparaît
            </div>
          </button>
        </div>

        {/* Pro badges row */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
          <ProBadge label="Historique 5 ans" />
          <ProBadge label="Comparables détaillés" />
          <ProBadge label="Export PDF" />
          <ProBadge label="Alertes nouvelles ventes" />
        </div>

        {/* Soft CTA */}
        <div
          style={{
            padding: "20px 24px",
            borderRadius: 14,
            background: "linear-gradient(135deg, rgba(0,255,136,0.06), rgba(0,212,255,0.04))",
            border: "1px solid rgba(0,255,136,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
              Passez à l&apos;analyse professionnelle
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.5 }}>
              Historique 5 ans, comparables, export PDF, alertes — essai gratuit 14 jours.
            </div>
          </div>
          <button
            onClick={() => setShowProModal(true)}
            style={{
              padding: "10px 24px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg, #00ff88, #00d4ff)",
              color: "#0a0a1e",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "Segoe UI, Arial, sans-serif",
              whiteSpace: "nowrap",
              boxShadow: "0 4px 16px rgba(0,255,136,0.2)",
              transition: "transform 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.04)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
          >
            Découvrir l&apos;offre Pro →
          </button>
        </div>
      </div>

      <ProModal open={showProModal} onClose={() => setShowProModal(false)} feature={proFeature || undefined} />
    </>
  );
}
