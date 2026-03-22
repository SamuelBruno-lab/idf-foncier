"use client";

import { useState } from "react";
import AnalyseLeadModal, { type Intent } from "./AnalyseLeadModal";

interface Props {
  commune: { code: string; nom: string };
}

const INTENTS: { key: Intent; icon: string; label: string; sub: string; color: string }[] = [
  {
    key: "vendeur",
    icon: "🏠",
    label: "Estimez votre bien",
    sub: "Estimation gratuite basée sur les données DVF",
    color: "#ff8844",
  },
  {
    key: "acheteur",
    icon: "🔑",
    label: "Trouvez votre quartier idéal",
    sub: "Mise en relation avec un expert local",
    color: "#00d4ff",
  },
  {
    key: "investisseur",
    icon: "📈",
    label: "J'investis",
    sub: "Micro-marchés à fort rendement",
    color: "#a855f7",
  },
];

export default function AnalyseLeadSection({ commune }: Props) {
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<Intent | undefined>(undefined);

  const openWith = (i: Intent) => {
    setIntent(i);
    setOpen(true);
  };

  return (
    <>
      <div style={{ marginBottom: 36 }}>
        {/* Titre */}
        <div style={{ marginBottom: 16 }}>
          <h2
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "rgba(255,255,255,0.5)",
              textTransform: "uppercase",
              letterSpacing: 1,
              margin: "0 0 6px",
            }}
          >
            Votre projet immobilier à {commune.nom}
          </h2>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", margin: 0 }}>
            Estimation gratuite, mise en relation expert, analyse de rendement.
          </p>
        </div>

        {/* 3 boutons intent */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
          {INTENTS.map(({ key, icon, label, sub, color }) => (
            <button
              key={key}
              onClick={() => openWith(key)}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: `1px solid ${color}33`,
                borderRadius: 14,
                padding: "18px 20px",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = `${color}12`;
                (e.currentTarget as HTMLButtonElement).style.borderColor = `${color}77`;
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = `${color}33`;
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color, marginBottom: 4 }}>
                {label}
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", lineHeight: 1.4 }}>{sub}</div>
            </button>
          ))}
        </div>

        {/* Lien agent discret */}
        <div style={{ marginTop: 12, textAlign: "center" }}>
          <button
            onClick={() => openWith("agent")}
            style={{
              background: "none",
              border: "none",
              color: "rgba(255,255,255,0.2)",
              fontSize: 11,
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Vous êtes agent immobilier ou promoteur ? →
          </button>
        </div>
      </div>

      {open && (
        <AnalyseLeadModal
          commune={commune}
          initialIntent={intent}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
