import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import Header from "@/components/Header";
import AuthProvider from "@/components/AuthProvider";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "datamerry — Micro-marchés immobiliers Île-de-France · Données DVF",
  description:
    "Carte interactive des micro-marchés immobiliers IDF + Oise. Zones sous-cotées, tendances locales, score d'investissement. Données DVF open data. 100% gratuit.",
  metadataBase: new URL("https://datamerry.com"),
  openGraph: {
    title: "datamerry — Micro-marchés immobiliers Île-de-France",
    description:
      "Trouvez les zones sous-cotées en Île-de-France. Analyse DVF de 1,2M transactions par IA.",
    url: "https://datamerry.com",
    siteName: "datamerry",
    locale: "fr_FR",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Carte datamerry — Marché immobilier Île-de-France 2025",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "datamerry — Micro-marchés immobiliers Île-de-France",
    description: "Zones sous-cotées · Score investissement · DVF open data",
    images: ["/og-image.png"],
  },
  keywords: [
    "immobilier", "Île-de-France", "DVF", "prix immobilier", "carte immobilière",
    "transactions immobilières", "datamerry", "micro-marchés immobiliers",
    "zones sous-cotées", "investissement immobilier", "foncier",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body className="antialiased">
        <AuthProvider>
          <Header />
          {children}
        </AuthProvider>
        <Analytics />
      </body>
    </html>
  );
}
