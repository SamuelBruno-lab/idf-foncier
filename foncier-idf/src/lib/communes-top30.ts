/**
 * Top 30 communes d'Île-de-France par population.
 * Utilisé pour la navigation, le SEO (generateStaticParams), et le pipeline HDBSCAN.
 */

export interface CommuneInfo {
  code: string;
  nom: string;
  dept: string;
  deptNom: string;
  color: string;
  lat: number;
  lon: number;
  population: number;
}

export const COMMUNES_TOP30: CommuneInfo[] = [
  { code: "75056", nom: "Paris", dept: "75", deptNom: "Paris", color: "#ef4444", lat: 48.8566, lon: 2.3522, population: 2133111 },
  { code: "92012", nom: "Boulogne-Billancourt", dept: "92", deptNom: "Hauts-de-Seine", color: "#00d4ff", lat: 48.8397, lon: 2.2399, population: 121334 },
  { code: "93066", nom: "Saint-Denis", dept: "93", deptNom: "Seine-Saint-Denis", color: "#00ff88", lat: 48.9362, lon: 2.3574, population: 113073 },
  { code: "93048", nom: "Montreuil", dept: "93", deptNom: "Seine-Saint-Denis", color: "#00ff88", lat: 48.8638, lon: 2.4484, population: 111260 },
  { code: "95018", nom: "Argenteuil", dept: "95", deptNom: "Val-d'Oise", color: "#f59e0b", lat: 48.9472, lon: 2.2467, population: 113748 },
  { code: "92050", nom: "Nanterre", dept: "92", deptNom: "Hauts-de-Seine", color: "#00d4ff", lat: 48.8924, lon: 2.2071, population: 98028 },
  { code: "94028", nom: "Créteil", dept: "94", deptNom: "Val-de-Marne", color: "#a78bfa", lat: 48.7911, lon: 2.4628, population: 93361 },
  { code: "94081", nom: "Vitry-sur-Seine", dept: "94", deptNom: "Val-de-Marne", color: "#a78bfa", lat: 48.7875, lon: 2.3929, population: 94649 },
  { code: "92025", nom: "Colombes", dept: "92", deptNom: "Hauts-de-Seine", color: "#00d4ff", lat: 48.9227, lon: 2.2536, population: 90096 },
  { code: "92004", nom: "Asnières-sur-Seine", dept: "92", deptNom: "Hauts-de-Seine", color: "#00d4ff", lat: 48.9119, lon: 2.2882, population: 88556 },
  { code: "78646", nom: "Versailles", dept: "78", deptNom: "Yvelines", color: "#6366f1", lat: 48.8014, lon: 2.1301, population: 85272 },
  { code: "92026", nom: "Courbevoie", dept: "92", deptNom: "Hauts-de-Seine", color: "#00d4ff", lat: 48.8966, lon: 2.2567, population: 83136 },
  { code: "93001", nom: "Aubervilliers", dept: "93", deptNom: "Seine-Saint-Denis", color: "#00ff88", lat: 48.9136, lon: 2.3828, population: 91795 },
  { code: "93005", nom: "Aulnay-sous-Bois", dept: "93", deptNom: "Seine-Saint-Denis", color: "#00ff88", lat: 48.9381, lon: 2.4976, population: 87205 },
  { code: "92063", nom: "Rueil-Malmaison", dept: "92", deptNom: "Hauts-de-Seine", color: "#00d4ff", lat: 48.8769, lon: 2.1894, population: 81300 },
  { code: "94017", nom: "Champigny-sur-Marne", dept: "94", deptNom: "Val-de-Marne", color: "#a78bfa", lat: 48.8176, lon: 2.5159, population: 79826 },
  { code: "77284", nom: "Meaux", dept: "77", deptNom: "Seine-et-Marne", color: "#f97316", lat: 48.9601, lon: 2.8781, population: 56093 },
  { code: "93029", nom: "Drancy", dept: "93", deptNom: "Seine-Saint-Denis", color: "#00ff88", lat: 48.9304, lon: 2.4504, population: 73223 },
  { code: "92040", nom: "Issy-les-Moulineaux", dept: "92", deptNom: "Hauts-de-Seine", color: "#00d4ff", lat: 48.8239, lon: 2.2704, population: 69417 },
  { code: "93051", nom: "Noisy-le-Grand", dept: "93", deptNom: "Seine-Saint-Denis", color: "#00ff88", lat: 48.8481, lon: 2.5527, population: 69330 },
  { code: "92044", nom: "Levallois-Perret", dept: "92", deptNom: "Hauts-de-Seine", color: "#00d4ff", lat: 48.8937, lon: 2.2874, population: 66082 },
  { code: "94041", nom: "Ivry-sur-Seine", dept: "94", deptNom: "Val-de-Marne", color: "#a78bfa", lat: 48.8122, lon: 2.3847, population: 64458 },
  { code: "95127", nom: "Cergy", dept: "95", deptNom: "Val-d'Oise", color: "#f59e0b", lat: 49.0363, lon: 2.0630, population: 66322 },
  { code: "78586", nom: "Sartrouville", dept: "78", deptNom: "Yvelines", color: "#6366f1", lat: 48.9376, lon: 2.1593, population: 53065 },
  { code: "92002", nom: "Antony", dept: "92", deptNom: "Hauts-de-Seine", color: "#00d4ff", lat: 48.7533, lon: 2.2983, population: 63459 },
  { code: "93031", nom: "Épinay-sur-Seine", dept: "93", deptNom: "Seine-Saint-Denis", color: "#00ff88", lat: 48.9530, lon: 2.3107, population: 56752 },
  { code: "93010", nom: "Bondy", dept: "93", deptNom: "Seine-Saint-Denis", color: "#00ff88", lat: 48.9026, lon: 2.4842, population: 54444 },
  { code: "92023", nom: "Clamart", dept: "92", deptNom: "Hauts-de-Seine", color: "#00d4ff", lat: 48.8027, lon: 2.2667, population: 54073 },
  { code: "94033", nom: "Fontenay-sous-Bois", dept: "94", deptNom: "Val-de-Marne", color: "#a78bfa", lat: 48.8518, lon: 2.4770, population: 53907 },
  { code: "93071", nom: "Sevran", dept: "93", deptNom: "Seine-Saint-Denis", color: "#00ff88", lat: 48.9445, lon: 2.5254, population: 52044 },
];

/** Lookup map: code → commune info */
export const COMMUNES_MAP = new Map(COMMUNES_TOP30.map((c) => [c.code, c]));

/** Get communes for a specific department */
export function communesByDept(dept: string): CommuneInfo[] {
  return COMMUNES_TOP30.filter((c) => c.dept === dept);
}
