/**
 * Génération automatique du CONTRAT DE MANDAT « Associé(e) Fondateur(trice) »
 * Eurealimmo Réseau, à partir du template Word validé.
 *
 * Source de vérité : public/legal/templates/contrat-mandat-fondateur.template.docx
 *   — produit à partir du contrat V2 de Diara (Associée Fondatrice n° 1), dont
 *     ont été retirés les Articles 8 (prime de cession) et 8 bis (préemption),
 *     réservés intuitu personae à la fondatrice n° 1.
 *   — placeholders remplacés par des tags docxtemplater {champ}.
 *
 * On NE reconstruit PAS le contrat en code : on remplit le template. Toute
 * modification de fond se fait dans le .docx (rebuild via public/legal).
 *
 * Délimiteurs docxtemplater : { } (vérifié : aucune accolade parasite dans le
 * corps du contrat).
 */

import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";

export const TEMPLATE_PATH = path.join(
  process.cwd(),
  "public",
  "legal",
  "templates",
  "contrat-mandat-fondateur.template.docx",
);

/** Champs effectivement injectés dans le template (cf. tags du .docx). */
export type MandatTags = {
  prenom: string;
  nom: string;
  email: string;
  /** Numéro de place fondateur, 2..60 (la n° 1 = Diara, contrat dédié). */
  numero_fondateur: string;
  /** Date du contrat, déjà formatée en français (ex. « 1er juillet 2026 »). */
  date_contrat: string;
  /** Marque/sous-marque éventuelle du fondateur. Vide si aucune. */
  marque: string;
  /** Phrase libre de parcours dans le préambule. Vide si non renseigné. */
  parcours: string;
};

/** Sous-ensemble de public.eurealimmo_mandataires nécessaire à la génération. */
export type MandataireRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  company_name: string | null;
  founder_number: number | null;
  description: string | null;
};

const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** Formate une date en français : « 1er juillet 2026 » / « 12 mars 2026 ». */
export function formatDateFr(d: Date = new Date()): string {
  const jour = d.getDate();
  const j = jour === 1 ? "1er" : String(jour);
  return `${j} ${MOIS_FR[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Mappe une ligne mandataire vers les tags du template.
 * @throws si founder_number est absent (numéro à attribuer au préalable)
 *         ou égal à 1 (réservé à la fondatrice n° 1 / contrat dédié).
 */
export function mandataireToTags(
  m: MandataireRow,
  opts: { date?: Date; marque?: string; parcours?: string } = {},
): MandatTags {
  if (m.founder_number == null) {
    throw new Error(
      `Mandataire ${m.id} sans founder_number : attribuer un numéro de place fondateur (2..60) avant génération.`,
    );
  }
  if (m.founder_number === 1) {
    throw new Error(
      "founder_number = 1 est réservé à l'Associée Fondatrice n° 1 (contrat dédié avec Art. 8 / 8 bis). " +
        "Utiliser le contrat spécifique, pas le template générique.",
    );
  }
  return {
    prenom: m.first_name?.trim() ?? "",
    nom: (m.last_name ?? "").trim().toUpperCase(),
    email: m.email?.trim() ?? "",
    numero_fondateur: String(m.founder_number),
    date_contrat: formatDateFr(opts.date),
    // Marque : priorité au paramètre explicite, sinon company_name, sinon vide.
    marque: (opts.marque ?? m.company_name ?? "").trim(),
    parcours: (opts.parcours ?? m.description ?? "").trim(),
  };
}

/** Nom de fichier normalisé : contrat-mandat-fondateur-07-dupont-marc.docx */
export function mandatFilename(tags: MandatTags): string {
  const slug = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  const num = tags.numero_fondateur.padStart(2, "0");
  return `contrat-mandat-fondateur-${num}-${slug(tags.nom)}-${slug(tags.prenom)}.docx`;
}

/**
 * Rend le contrat .docx rempli en mémoire.
 * @returns Buffer du fichier .docx
 * @throws Docxtemplater render error si un tag est manquant/malformé.
 */
export function buildMandatDocx(tags: MandatTags): Buffer {
  const content = fs.readFileSync(TEMPLATE_PATH, "binary");
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
  });
  doc.render(tags);
  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Buffer;
}

/** Helper tout-en-un : ligne DB → { buffer, filename, tags }. */
export function generateMandatFromMandataire(
  m: MandataireRow,
  opts: { date?: Date; marque?: string; parcours?: string } = {},
): { buffer: Buffer; filename: string; tags: MandatTags } {
  const tags = mandataireToTags(m, opts);
  const buffer = buildMandatDocx(tags);
  return { buffer, filename: mandatFilename(tags), tags };
}
