import type { Metadata } from "next";
import { MandataireLoginForm } from "./MandataireLoginForm";

export const metadata: Metadata = {
  title: "Connexion mandataire — Eurealimmo",
  robots: { index: false, follow: false },
};

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

export default function MandataireLoginPage() {
  return (
    <main
      style={{
        background: "#fafafa",
        color: DARK,
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <header
        style={{
          background: DARK,
          padding: "20px 24px",
          borderBottom: `1px solid ${PRIMARY}40`,
        }}
      >
        <div
          style={{
            maxWidth: 920,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              background: PRIMARY,
              color: DARK,
              fontWeight: 800,
              fontSize: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
              fontFamily: "Georgia, serif",
            }}
          >
            E
          </div>
          <div>
            <div
              style={{
                color: "white",
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: "0.05em",
              }}
            >
              EUREALIMMO
            </div>
            <div
              style={{
                color: PRIMARY,
                fontSize: 10,
                letterSpacing: "0.1em",
                fontWeight: 600,
              }}
            >
              ESPACE MANDATAIRE — CONNEXION
            </div>
          </div>
        </div>
      </header>

      {/* Contenu */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <div
          style={{
            background: "white",
            borderRadius: 8,
            padding: 32,
            maxWidth: 480,
            width: "100%",
            boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
          }}
        >
          <h1
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 26,
              fontWeight: 700,
              margin: "0 0 8px",
              color: DARK,
            }}
          >
            Accès à votre espace
          </h1>
          <p
            style={{
              color: "#64748b",
              fontSize: 13,
              margin: "0 0 24px",
              lineHeight: 1.5,
            }}
          >
            Saisissez votre adresse email professionnelle. Vous recevrez un
            lien d'accès personnel à votre espace mandataire Eurealimmo.
          </p>

          <MandataireLoginForm />

          <div
            style={{
              marginTop: 24,
              paddingTop: 16,
              borderTop: "1px solid #e2e8f0",
              fontSize: 11,
              color: "#94a3b8",
              lineHeight: 1.6,
              textAlign: "center",
            }}
          >
            Vous n'êtes pas encore mandataire Eurealimmo ?{" "}
            <a href="/eurealimmo-reseau" style={{ color: PRIMARY }}>
              Découvrir le programme
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer
        style={{
          padding: "16px 24px",
          background: "#020617",
          color: "#475569",
          fontSize: 11,
          textAlign: "center",
        }}
      >
        EUREALIMMO SARL · SIREN 984 449 470 · Carte T CPI 7501 2024 000 000 219
      </footer>
    </main>
  );
}
