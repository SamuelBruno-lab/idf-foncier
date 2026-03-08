import { type Metadata } from "next";

const DEPT_META: Record<string, { nom: string; description: string }> = {
  "60": { nom: "Oise", description: "Creil, Senlis · prix accessibles · DVF 2020–2025" },
  "75": { nom: "Paris", description: "Marché premium · ~10 000€/m² · DVF 2020–2025" },
  "77": { nom: "Seine-et-Marne", description: "Melun, Meaux · marché maisons · DVF 2020–2025" },
  "78": { nom: "Yvelines", description: "Versailles, Saint-Germain · marché résidentiel · DVF 2020–2025" },
  "91": { nom: "Essonne", description: "Évry, Massy · fort rendement locatif · DVF 2020–2025" },
  "92": { nom: "Hauts-de-Seine", description: "Neuilly, Boulogne, Levallois · marché sous tension · DVF 2020–2025" },
  "93": { nom: "Seine-Saint-Denis", description: "Fort potentiel locatif · prix accessibles · DVF 2020–2025" },
  "94": { nom: "Val-de-Marne", description: "Vincennes, Créteil · rendements surprenants · DVF 2020–2025" },
  "95": { nom: "Val-d'Oise", description: "Cergy, Argenteuil · prix attractifs · DVF 2020–2025" },
};

export async function generateMetadata(
  { params }: { params: Promise<{ code: string }> }
): Promise<Metadata> {
  const { code } = await params;
  const dept = DEPT_META[code] ?? {
    nom: `Département ${code}`,
    description: `Analyse foncière DVF 2020–2025`,
  };

  return {
    title: `${dept.nom} (${code}) — Marché immobilier DVF | datamerry`,
    description: `Carte interactive du marché immobilier en ${dept.nom} · ${dept.description} · Source DVF data.gouv.fr`,
    openGraph: {
      title: `${dept.nom} (${code}) — datamerry`,
      description: `${dept.description}`,
      url: `https://datamerry.com/dept/${code}`,
      siteName: "datamerry",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${dept.nom} — Carte foncière datamerry`,
      description: dept.description,
    },
  };
}

export default function DeptLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
