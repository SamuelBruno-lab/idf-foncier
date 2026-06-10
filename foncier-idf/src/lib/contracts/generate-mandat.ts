/**
 * Génération automatique du contrat de mandat Eurealimmo Réseau, à partir des
 * templates Word validés, selon le TIER du mandataire (founder / standard).
 *
 * Templates (source de vérité) :
 *   public/legal/templates/contrat-mandat-fondateur.template.docx
 *   public/legal/templates/contrat-mandat-standard.template.docx
 *
 * Tier déterminé par eurealimmo_mandataires.commission_eurealimmo_pct
 * (5 = founder, 8 = standard) — cf. src/lib/contracts/tiers.ts.
 *
 * On NE reconstruit PAS le contrat en code : on remplit le template. Toute
 * modification de fond se fait dans le .docx (rebuild via public/legal).
 */

import fs from "node:fs";
import path from "node:path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { tierFromCommissionPct, type Tier } from "./tiers";

const TEMPLATES_DIR = path.join(process.cwd(), "public", "legal", "templates");

export const TEMPLATE_PATHS: Record<Tier, string> = {
  founder: path.join(TEMPLATES_DIR, "contrat-mandat-fondateur.template.docx"),
  standard: path.join(TEMPLATES_DIR, "contrat-mandat-standard.template.docx"),
};

/** Champs injectés dans les templates (tags docxtemplater). */
export type MandatTags = {
  prenom: string;
  nom: string;
  email: string;
  /** Vide pour le standard (le template standard n'a pas ce tag). */
  numero_fondateur: string;
  date_contrat: string;
  marque: string;
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
  /** 5 = founder, 8 = standard. */
  commission_eurealimmo_pct: number | null;
};

const MOIS_FR = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

export function formatDateFr(d: Date = new Date()): string {
  const jour = d.getDate();
  const j = jour === 1 ? "1er" : String(jour);
  return `${j} ${MOIS_FR[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Détermine le tier (founder/standard) à partir de la commission retenue.
 * @throws si la commission ne correspond ni à 5 ni à 8.
 */
export function resolveTier(m: MandataireRow): Tier {
  const tier = tierFromCommissionPct(m.commission_eurealimmo_pct);
  if (!tier) {
    throw new Error(
      `Tier indéterminé pour ${m.id} : commission_eurealimmo_pct doit être 5 (fondateur) ou 8 (standard), reçu ${m.commission_eurealimmo_pct}.`,
    );
  }
  return tier;
}

/**
 * Mappe une ligne mandataire vers les tags + le tier.
 * @throws si fondateur sans founder_number (2..60), ou founder_number = 1
 *         (réservé à l'Associée Fondatrice n° 1 / contrat manuel Diara).
 */
export function mandataireToTags(
  m: MandataireRow,
  opts: { date?: Date; marque?: string; parcours?: string } = {},
): { tags: MandatTags; tier: Tier } {
  const tier = resolveTier(m);

  let numero = "";
  if (tier === "founder") {
    if (m.founder_number == null) {
      throw new Error(
        `Mandataire ${m.id} (fondateur) sans founder_number : attribuer un numéro (2..60) avant génération.`,
      );
    }
    if (m.founder_number === 1) {
      throw new Error(
        "founder_number = 1 est réservé à l'Associée Fondatrice n° 1 (contrat manuel dédié, Art. 8 / 8 bis). Ne pas générer via template.",
      );
    }
    numero = String(m.founder_number);
  }

  const tags: MandatTags = {
    prenom: m.first_name?.trim() ?? "",
    nom: (m.last_name ?? "").trim().toUpperCase(),
    email: m.email?.trim() ?? "",
    numero_fondateur: numero,
    date_contrat: formatDateFr(opts.date),
    marque: (opts.marque ?? m.company_name ?? "").trim(),
    parcours: (opts.parcours ?? m.description ?? "").trim(),
  };
  return { tags, tier };
}

/** Nom de fichier : contrat-mandat-{tier}[-NN]-{nom}-{prenom}.docx */
export function mandatFilename(tags: MandatTags, tier: Tier): string {
  const slug = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  const suffix = tier === "founder" ? `-${tags.numero_fondateur.padStart(2, "0")}` : "";
  return `contrat-mandat-${tier}${suffix}-${slug(tags.nom)}-${slug(tags.prenom)}.docx`;
}

/** Rend le contrat .docx rempli en mémoire, selon le tier. */
export function buildMandatDocx(tags: MandatTags, tier: Tier): Buffer {
  const content = fs.readFileSync(TEMPLATE_PATHS[tier], "binary");
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
  });
  doc.render(tags);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

/** Helper tout-en-un : ligne DB → { buffer, filename, tags, tier }. */
export function generateMandatFromMandataire(
  m: MandataireRow,
  opts: { date?: Date; marque?: string; parcours?: string } = {},
): { buffer: Buffer; filename: string; tags: MandatTags; tier: Tier } {
  const { tags, tier } = mandataireToTags(m, opts);
  const buffer = buildMandatDocx(tags, tier);
  return { buffer, filename: mandatFilename(tags, tier), tier, tags };
}
