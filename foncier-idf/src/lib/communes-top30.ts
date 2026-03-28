/**
 * Top 100 communes d'Île-de-France + Oise par population.
 * - Top 30 : accès gratuit (points DVF + HDBSCAN, 2024-2025)
 * - Top 100 : accès Pro (historique 2020-2025, évolution prix)
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

const DEPT_COLORS: Record<string, string> = {
  "75": "#ef4444", "92": "#00d4ff", "93": "#00ff88", "94": "#a78bfa",
  "95": "#f59e0b", "78": "#6366f1", "91": "#10b981", "77": "#f97316", "60": "#ec4899",
};

function c(code: string, nom: string, dept: string, deptNom: string, lat: number, lon: number, population: number): CommuneInfo {
  return { code, nom, dept, deptNom, color: DEPT_COLORS[dept] ?? "#00d4ff", lat, lon, population };
}

/** Top 30 communes — accès gratuit */
export const COMMUNES_TOP30: CommuneInfo[] = [
  c("75056", "Paris", "75", "Paris", 48.8566, 2.3522, 2133111),
  c("92012", "Boulogne-Billancourt", "92", "Hauts-de-Seine", 48.8397, 2.2399, 121334),
  c("93066", "Saint-Denis", "93", "Seine-Saint-Denis", 48.9362, 2.3574, 113073),
  c("95018", "Argenteuil", "95", "Val-d'Oise", 48.9472, 2.2467, 113748),
  c("93048", "Montreuil", "93", "Seine-Saint-Denis", 48.8638, 2.4484, 111260),
  c("92050", "Nanterre", "92", "Hauts-de-Seine", 48.8924, 2.2071, 98028),
  c("94081", "Vitry-sur-Seine", "94", "Val-de-Marne", 48.7875, 2.3929, 94649),
  c("94028", "Créteil", "94", "Val-de-Marne", 48.7911, 2.4628, 93361),
  c("93001", "Aubervilliers", "93", "Seine-Saint-Denis", 48.9136, 2.3828, 91795),
  c("92025", "Colombes", "92", "Hauts-de-Seine", 48.9227, 2.2536, 90096),
  c("92004", "Asnières-sur-Seine", "92", "Hauts-de-Seine", 48.9119, 2.2882, 88556),
  c("93005", "Aulnay-sous-Bois", "93", "Seine-Saint-Denis", 48.9381, 2.4976, 87205),
  c("78646", "Versailles", "78", "Yvelines", 48.8014, 2.1301, 85272),
  c("92026", "Courbevoie", "92", "Hauts-de-Seine", 48.8966, 2.2567, 83136),
  c("92063", "Rueil-Malmaison", "92", "Hauts-de-Seine", 48.8769, 2.1894, 81300),
  c("94017", "Champigny-sur-Marne", "94", "Val-de-Marne", 48.8176, 2.5159, 79826),
  c("93029", "Drancy", "93", "Seine-Saint-Denis", 48.9304, 2.4504, 73223),
  c("92040", "Issy-les-Moulineaux", "92", "Hauts-de-Seine", 48.8239, 2.2704, 69417),
  c("93051", "Noisy-le-Grand", "93", "Seine-Saint-Denis", 48.8481, 2.5527, 69330),
  c("92044", "Levallois-Perret", "92", "Hauts-de-Seine", 48.8937, 2.2874, 66082),
  c("95127", "Cergy", "95", "Val-d'Oise", 49.0363, 2.0630, 66322),
  c("94041", "Ivry-sur-Seine", "94", "Val-de-Marne", 48.8122, 2.3847, 64458),
  c("92002", "Antony", "92", "Hauts-de-Seine", 48.7533, 2.2983, 63459),
  c("93031", "Épinay-sur-Seine", "93", "Seine-Saint-Denis", 48.9530, 2.3107, 56752),
  c("77284", "Meaux", "77", "Seine-et-Marne", 48.9601, 2.8781, 56093),
  c("93010", "Bondy", "93", "Seine-Saint-Denis", 48.9026, 2.4842, 54444),
  c("92023", "Clamart", "92", "Hauts-de-Seine", 48.8027, 2.2667, 54073),
  c("94033", "Fontenay-sous-Bois", "94", "Val-de-Marne", 48.8518, 2.4770, 53907),
  c("78586", "Sartrouville", "78", "Yvelines", 48.9376, 2.1593, 53065),
  c("93071", "Sevran", "93", "Seine-Saint-Denis", 48.9445, 2.5254, 52044),
];

/** Communes 31-100 — accès Pro uniquement */
export const COMMUNES_PRO: CommuneInfo[] = [
  c("91228", "Évry-Courcouronnes", "91", "Essonne", 48.6244, 2.4297, 69321),
  c("91377", "Massy", "91", "Essonne", 48.7262, 2.2718, 52022),
  c("94071", "Saint-Maur-des-Fossés", "94", "Val-de-Marne", 48.7974, 2.4937, 77872),
  c("93027", "La Courneuve", "93", "Seine-Saint-Denis", 48.9289, 2.3963, 47284),
  c("93007", "Bagnolet", "93", "Seine-Saint-Denis", 48.8694, 2.4214, 37243),
  c("93053", "Pantin", "93", "Seine-Saint-Denis", 48.8943, 2.4040, 59638),
  c("93063", "Rosny-sous-Bois", "93", "Seine-Saint-Denis", 48.8717, 2.4896, 47584),
  c("93070", "Saint-Ouen-sur-Seine", "93", "Seine-Saint-Denis", 48.9074, 2.3346, 53460),
  c("94052", "Maisons-Alfort", "94", "Val-de-Marne", 48.8070, 2.4370, 56483),
  c("94019", "Charenton-le-Pont", "94", "Val-de-Marne", 48.8210, 2.4130, 31543),
  c("94080", "Vincennes", "94", "Val-de-Marne", 48.8477, 2.4353, 49891),
  c("92073", "Suresnes", "92", "Hauts-de-Seine", 48.8699, 2.2292, 49702),
  c("92048", "Meudon", "92", "Hauts-de-Seine", 48.8100, 2.2356, 46389),
  c("92060", "Puteaux", "92", "Hauts-de-Seine", 48.8846, 2.2369, 45667),
  c("92032", "Fontenay-aux-Roses", "92", "Hauts-de-Seine", 48.7890, 2.2929, 28859),
  c("92071", "Sèvres", "92", "Hauts-de-Seine", 48.8240, 2.2134, 24056),
  c("92033", "Garches", "92", "Hauts-de-Seine", 48.8442, 2.1886, 18832),
  c("94076", "Thiais", "94", "Val-de-Marne", 48.7636, 2.3932, 32136),
  c("94022", "Choisy-le-Roi", "94", "Val-de-Marne", 48.7629, 2.4103, 45743),
  c("94069", "Saint-Mandé", "94", "Val-de-Marne", 48.8398, 2.4186, 22820),
  c("94046", "Le Kremlin-Bicêtre", "94", "Val-de-Marne", 48.8109, 2.3599, 27651),
  c("94073", "Sucy-en-Brie", "94", "Val-de-Marne", 48.7700, 2.5255, 26709),
  c("95585", "Sarcelles", "95", "Val-d'Oise", 48.9953, 2.3792, 59198),
  c("95252", "Garges-lès-Gonesse", "95", "Val-d'Oise", 48.9734, 2.3981, 43847),
  c("95268", "Goussainville", "95", "Val-d'Oise", 49.0336, 2.4736, 32310),
  c("95210", "Franconville", "95", "Val-d'Oise", 48.9879, 2.2303, 37087),
  c("95063", "Bezons", "95", "Val-d'Oise", 48.9247, 2.2144, 32375),
  c("78311", "Houilles", "78", "Yvelines", 48.9205, 2.1900, 34086),
  c("78146", "Chatou", "78", "Yvelines", 48.8919, 2.1548, 31965),
  c("78440", "Plaisir", "78", "Yvelines", 48.8178, 1.9481, 32539),
  c("78551", "Le Chesnay-Rocquencourt", "78", "Yvelines", 48.8272, 2.1215, 29050),
  c("78498", "Rambouillet", "78", "Yvelines", 48.6436, 1.8317, 27076),
  c("78621", "Saint-Germain-en-Laye", "78", "Yvelines", 48.8972, 2.0930, 44893),
  c("78423", "Conflans-Sainte-Honorine", "78", "Yvelines", 49.0016, 2.0946, 36186),
  c("78361", "Mantes-la-Jolie", "78", "Yvelines", 48.9904, 1.7162, 46266),
  c("78498", "Poissy", "78", "Yvelines", 48.9287, 2.0486, 40924),
  c("77288", "Melun", "77", "Seine-et-Marne", 48.5397, 2.6603, 42289),
  c("77083", "Chelles", "77", "Seine-et-Marne", 48.8836, 2.5918, 55932),
  c("77468", "Torcy", "77", "Seine-et-Marne", 48.8502, 2.6491, 23653),
  c("77373", "Pontault-Combault", "77", "Seine-et-Marne", 48.8004, 2.6048, 40007),
  c("77131", "Dammarie-les-Lys", "77", "Seine-et-Marne", 48.5159, 2.6368, 22759),
  c("77445", "Savigny-le-Temple", "77", "Seine-et-Marne", 48.5850, 2.5836, 31530),
  c("91174", "Corbeil-Essonnes", "91", "Essonne", 48.6127, 2.4823, 52178),
  c("91471", "Palaiseau", "91", "Essonne", 48.7145, 2.2500, 37541),
  c("91534", "Sainte-Geneviève-des-Bois", "91", "Essonne", 48.6379, 2.3286, 37091),
  c("91027", "Athis-Mons", "91", "Essonne", 48.7065, 2.3866, 36166),
  c("91589", "Savigny-sur-Orge", "91", "Essonne", 48.6784, 2.3484, 38039),
  c("91687", "Viry-Châtillon", "91", "Essonne", 48.6717, 2.3723, 32851),
  c("91326", "Longjumeau", "91", "Essonne", 48.6934, 2.2956, 22510),
  c("91272", "Grigny", "91", "Essonne", 48.6535, 2.3870, 28959),
  c("60057", "Beauvais", "60", "Oise", 49.4299, 2.0810, 56020),
  c("60159", "Compiègne", "60", "Oise", 49.4178, 2.8264, 40382),
  c("60175", "Creil", "60", "Oise", 49.2583, 2.4833, 36741),
  c("60612", "Senlis", "60", "Oise", 49.2070, 2.5850, 16805),
  c("60471", "Nogent-sur-Oise", "60", "Oise", 49.2755, 2.4693, 20082),
  c("60139", "Chantilly", "60", "Oise", 49.1899, 2.4598, 11083),
  c("60463", "Noyon", "60", "Oise", 49.5808, 3.0000, 13771),
  c("60509", "Pont-Sainte-Maxence", "60", "Oise", 49.3035, 2.6050, 14021),
  c("60395", "Méru", "60", "Oise", 49.2336, 2.1336, 15014),
  c("60128", "Chambly", "60", "Oise", 49.1676, 2.2479, 10997),
  c("93032", "Gagny", "93", "Seine-Saint-Denis", 48.8832, 2.5358, 40867),
  c("93047", "Montfermeil", "93", "Seine-Saint-Denis", 48.8969, 2.5588, 27372),
  c("93014", "Le Blanc-Mesnil", "93", "Seine-Saint-Denis", 48.9383, 2.4609, 58166),
  c("93055", "Pierrefitte-sur-Seine", "93", "Seine-Saint-Denis", 48.9622, 2.3600, 31622),
  c("93064", "Les Pavillons-sous-Bois", "93", "Seine-Saint-Denis", 48.9060, 2.5066, 24478),
  c("93050", "Neuilly-sur-Marne", "93", "Seine-Saint-Denis", 48.8580, 2.5408, 38265),
  c("93073", "Stains", "93", "Seine-Saint-Denis", 48.9502, 2.3837, 39908),
  c("93078", "Villepinte", "93", "Seine-Saint-Denis", 48.9595, 2.5411, 38270),
  c("93077", "Villeparisis", "93", "Seine-Saint-Denis", 48.9472, 2.6095, 27840),
  c("92051", "Neuilly-sur-Seine", "92", "Hauts-de-Seine", 48.8848, 2.2686, 63535),
];

/** All communes (top 30 free + top 70 pro) */
export const COMMUNES_ALL: CommuneInfo[] = [...COMMUNES_TOP30, ...COMMUNES_PRO];

/** Set of free commune codes for quick lookup */
const FREE_CODES = new Set(COMMUNES_TOP30.map((c) => c.code));

/** Check if a commune is in the free tier */
export function isFreeCommune(code: string): boolean {
  return FREE_CODES.has(code);
}

/** Lookup map: code → commune info (all communes) */
export const COMMUNES_MAP = new Map(COMMUNES_ALL.map((c) => [c.code, c]));

/** Get communes for a specific department (free only) */
export function communesByDept(dept: string): CommuneInfo[] {
  return COMMUNES_TOP30.filter((c) => c.dept === dept);
}

/** Get ALL communes for a department (pro) */
export function communesByDeptPro(dept: string): CommuneInfo[] {
  return COMMUNES_ALL.filter((c) => c.dept === dept);
}

/** Free tier year range */
export const FREE_ANNEE_MIN = 2024;
export const FREE_ANNEE_MAX = 2025;

/** Pro tier year range */
export const PRO_ANNEE_MIN = 2020;
export const PRO_ANNEE_MAX = 2025;
