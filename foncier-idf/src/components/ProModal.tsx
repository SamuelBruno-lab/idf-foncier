"use client";

import { useEffect } from "react";

interface ProModalProps {
  open: boolean;
  onClose: () => void;
  feature?: string;
}

const PRO_FEATURES = [
  { icon: "🏙️", label: "Top 100 communes", desc: "Accès aux 100 plus grandes communes IDF + Oise" },
  { icon: "📊", label: "Historique 2020-2025", desc: "Évolution des prix sur 5 ans pour chaque commune" },
  { icon: "📈", label: "Évolution annuelle", desc: "Tendances prix et volume, année par année" },
  { icon: "🔍", label: "Comparables détaillés", desc: "Transactions similaires dans un rayon personnalisable" },
  { icon: "📄", label: "Export PDF investisseur", desc: "Rapports professionnels prêts pour vos investissements" },
  { icon: "🔔", label: "Alertes nouvelles ventes", desc: "Notification dès qu'un bien sous-coté apparaît" },
];

export default function ProModal({ open, onClose, feature }: ProModalProps) {
  useEffect(() => {
    if (open) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.7)",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-fade-in-up"
        style={{
          background: "linear-gradient(145deg, #0d0d2b, #13132e)",
          border: "1px solid rgba(0,255,136,0.2)",
          borderRadius: 20,
          padding: "32px 28px",
          maxWidth: 520,
          width: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 24px 80px rgba(0,0,0,0.8), 0 0 60px rgba(0,255,136,0.06)",
          fontFamily: "Segoe UI, Arial, sans-serif",
          position: "relative",
        }}
      >
        {/* Close */}
        <button
          onClick={onClose}
          style={{
            position: "absolute",
            top: 14,
            right: 16,
            background: "none",
            border: "none",
            color: "rgba(255,255,255,0.3)",
            fontSize: 22,
            cursor: "pointer",
            lineHeight: 1,
          }}
        >
          ×
        </button>

        {/* Badge */}
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: "rgba(0,255,136,0.1)",
            border: "1px solid rgba(0,255,136,0.25)",
            borderRadius: 99,
            padding: "5px 14px",
            marginBottom: 18,
            fontSize: 11,
            color: "#00ff88",
            letterSpacing: 1.2,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          datamerry Pro
        </div>

        {/* Title */}
        <h2 style={{ margin: "0 0 8px", color: "#fff", fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>
          {feature
            ? `Débloquez « ${feature} »`
            : "Passez à l'analyse professionnelle"}
        </h2>
        <p style={{ margin: "0 0 24px", color: "rgba(255,255,255,0.45)", fontSize: 13, lineHeight: 1.6 }}>
          {feature
            ? "Cette fonctionnalité est réservée aux utilisateurs Pro. Essayez gratuitement pendant 14 jours."
            : "Tous les outils pour investir avec précision dans l'immobilier francilien."}
        </p>

        {/* Features grid */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}>
          {PRO_FEATURES.map((f) => (
            <div
              key={f.label}
              style={{
                padding: "12px 14px",
                borderRadius: 12,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.06)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
            >
              <span style={{ fontSize: 18, display: "block", marginBottom: 6 }}>{f.icon}</span>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", marginBottom: 3 }}>{f.label}</div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}>{f.desc}</div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          style={{
            width: "100%",
            padding: 14,
            borderRadius: 10,
            border: "none",
            background: "linear-gradient(135deg, #00ff88, #00d4ff)",
            color: "#0a0a1e",
            fontWeight: 800,
            fontSize: 15,
            cursor: "pointer",
            fontFamily: "Segoe UI, Arial, sans-serif",
            boxShadow: "0 4px 24px rgba(0,255,136,0.25)",
            transition: "transform 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.02)")}
          onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
        >
          Essai gratuit 14 jours — sans engagement
        </button>
        <p style={{ textAlign: "center", marginTop: 10, fontSize: 11, color: "rgba(255,255,255,0.25)" }}>
          Pas de carte bancaire requise · Annulable à tout moment
        </p>
      </div>
    </div>
  );
}
