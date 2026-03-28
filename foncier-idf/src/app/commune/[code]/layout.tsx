import { type Metadata } from "next";
import { COMMUNES_MAP } from "@/lib/communes-top30";

export async function generateMetadata(
  { params }: { params: Promise<{ code: string }> }
): Promise<Metadata> {
  const { code } = await params;
  const commune = COMMUNES_MAP.get(code);
  const nom = commune?.nom ?? `Commune ${code}`;
  const dept = commune?.deptNom ?? "";
  const description = commune
    ? `Carte interactive des micromarchés immobiliers de ${nom} (${dept}) · Points DVF + zones HDBSCAN · datamerry`
    : `Analyse foncière DVF 2025`;

  return {
    title: `${nom} — Micromarchés immobiliers | datamerry`,
    description,
    openGraph: {
      title: `${nom} — Carte micromarchés datamerry`,
      description,
      url: `https://datamerry.com/commune/${code}`,
      siteName: "datamerry",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${nom} — Micromarchés datamerry`,
      description,
    },
  };
}

export default function CommuneLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
