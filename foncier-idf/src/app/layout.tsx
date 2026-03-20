import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import ShareButton from "@/components/ShareButton";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "datamerry — 1,2M de transactions immobilières cartographiées par IA",
  description:
    "Carte interactive de toutes les ventes immobilières IDF + Oise 2025. Micro-marchés identifiés par IA. Données DVF open data. 100% gratuit.",
  metadataBase: new URL("https://datamerry.com"),
  openGraph: {
    title: "datamerry — 1,2M de transactions immobilières cartographiées par IA",
    description:
      "Carte interactive de toutes les ventes immobilières IDF + Oise 2025. Micro-marchés identifiés par IA. Données DVF open data. 100% gratuit.",
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
    title: "datamerry — 1,2M de transactions immobilières cartographiées par IA",
    description: "Carte interactive IDF + Oise 2025 · Machine learning · DVF open data",
    images: ["/og-image.png"],
  },
  keywords: [
    "immobilier", "Île-de-France", "DVF", "prix immobilier", "carte immobilière",
    "transactions immobilières", "datamerry", "micro-marchés immobiliers", "analyse foncière IA",
    "foncier", "Villeneuve-la-Garenne", "Oise",
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
        {children}
        <ShareButton />
        <Analytics />
      </body>
    </html>
  );
}
