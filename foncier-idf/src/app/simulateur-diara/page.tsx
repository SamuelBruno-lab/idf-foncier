import type { Metadata } from "next";

import DiaraSimulator from "./DiaraSimulator";

export const metadata: Metadata = {
  title: "Simulateur Diara CAMARA — Eurealimmo Réseau",
  description:
    "Simulateur personnel basé sur le contrat de mandat signé entre Diara CAMARA et Eurealimmo SARL. Commissions propres, referral fees à vie, prime de cession exclusive.",
  // Ne pas indexer : page personnelle
  robots: { index: false, follow: false },
};

export default function SimulateurDiaraPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#fafaf9",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <DiaraSimulator />
    </main>
  );
}
