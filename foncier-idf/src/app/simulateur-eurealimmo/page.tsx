import type { Metadata } from "next";

import EurealimmoSimulator from "./EurealimmoSimulator";

export const metadata: Metadata = {
  title: "Simulateur Eurealimmo Réseau (vue Mandant)",
  description:
    "Simulation économique côté Mandant : CA réseau, marge nette Eurealimmo, IS PME, bénéfice net, valorisation EBITDA et prime de cession à provisionner pour l'Associée Fondatrice.",
  // Page interne : noindex
  robots: { index: false, follow: false },
};

export default function SimulateurEurealimmoPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#fafaf9",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <EurealimmoSimulator />
    </main>
  );
}
