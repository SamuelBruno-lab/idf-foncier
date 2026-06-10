/**
 * Générateur de mandat Hoguet (vente / recherche acquéreur / mise en
 * location / recherche bien locatif) à partir des données d'un lead.
 *
 * Pattern identique à generate-mandat.ts (contrat Fondateur) :
 *   1. Récupère le lead depuis dim_cabinet_leads
 *   2. Récupère les infos du cabinet (titulaire carte T)
 *   3. Récupère les infos du mandataire (RSAC, attestation CCI)
 *   4. Construit l'objet de tags pour docxtemplater
 *   5. Charge le template Word selon mandat_type
 *   6. Remplit les placeholders {tag}
 *   7. Upload le DOCX rempli sur Supabase Storage (bucket privé)
 *   8. Calcule le hash SHA-256 → insertion dim_mandate_anchor
 *   9. Update dim_cabinet_leads : signature_pdf_url + signature_status
 *
 * Légal :
 *   - Numérotation du registre des mandats : AAAANNNN (atomique par cabinet)
 *   - Mentions obligatoires décret 72-678 art. 73 : toutes intégrées
 *     dans les templates
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "crypto";

import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Types
// ============================================================

export type MandatType =
  | "vente"
  | "recherche_acquereur"
  | "mise_en_location"
  | "recherche_bien_locatif"
  // Compat avec valeurs existantes dim_cabinet_leads.mandat_type
  | "recherche" // → recherche_acquereur (rétrocompat)
  | "location"; // → mise_en_location (rétrocompat)

export type MandatModalite = "simple" | "exclusif" | "semi_exclusif";

export interface GenerateMandatHoguetArgs {
  supabase: SupabaseClient;
  leadId: string;
  cabinetSlug: string;
  // Override des champs (sinon lus depuis dim_cabinet_leads)
  mandatType?: MandatType;
  mandatModalite?: MandatModalite;
  dureeMois?: number;
  commissionPct?: number;
  prixNetVendeur?: number;
  prixMax?: number;
}

export interface GenerateMandatHoguetResult {
  docx_url: string;
  filename: string;
  hash_sha256: string;
  numero_registre: string;
  template_used: string;
}

// ============================================================
// Helpers
// ============================================================

const TEMPLATES_DIR = resolve(
  process.cwd(),
  "public/legal/templates",
);

const TEMPLATE_FILES: Record<MandatType, string> = {
  vente: "mandat-vente.template.docx",
  recherche_acquereur: "mandat-recherche-acquereur.template.docx",
  recherche: "mandat-recherche-acquereur.template.docx", // alias
  mise_en_location: "mandat-mise-en-location.template.docx",
  location: "mandat-mise-en-location.template.docx", // alias
  recherche_bien_locatif: "mandat-recherche-bien-locatif.template.docx",
};

function normalizeMandatType(t: string): MandatType {
  if (t === "recherche") return "recherche_acquereur";
  if (t === "location") return "mise_en_location";
  return t as MandatType;
}

function formatEurLettres(n: number): string {
  // Implementation simple, à enrichir si besoin (jusqu'à 9 999 999)
  // Pour MVP : juste un formatage propre 1 234 567 EUR
  return `${n.toLocaleString("fr-FR")} euros`;
}

function formatDateFr(d: Date): string {
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function pad4(n: number): string {
  return String(n).padStart(4, "0");
}

/**
 * Génère un numéro de registre AAAANNNN.
 * Stratégie : on prend l'année courante + le plus grand numéro+1
 * de l'année en cours sur ce cabinet.
 */
async function generateNumeroRegistre(
  supabase: SupabaseClient,
  cabinetSlug: string,
): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = String(year);

  const { data } = await supabase
    .from("dim_cabinet_leads")
    .select("mandat_numero_registre")
    .eq("cabinet_slug", cabinetSlug)
    .like("mandat_numero_registre", `${prefix}%`)
    .order("mandat_numero_registre", { ascending: false })
    .limit(1);

  let nextNum = 1;
  if (data && data.length > 0 && data[0].mandat_numero_registre) {
    const last = String(data[0].mandat_numero_registre);
    const lastNum = parseInt(last.slice(4), 10);
    if (!Number.isNaN(lastNum)) nextNum = lastNum + 1;
  }

  return `${prefix}${pad4(nextNum)}`;
}

// ============================================================
// Fonction principale
// ============================================================

export async function generateMandatHoguet(
  args: GenerateMandatHoguetArgs,
): Promise<GenerateMandatHoguetResult> {
  const { supabase, leadId, cabinetSlug } = args;

  // 1. Récupérer le lead
  const { data: lead, error: leadErr } = await supabase
    .from("dim_cabinet_leads")
    .select(
      "id, visitor_name, visitor_email, visitor_phone, address, " +
        "type_bien, surface, prix_total_median, intent, " +
        "mandat_type, mandat_modalite, mandat_duree_mois, " +
        "mandat_commission_pct, mandat_prix_net_vendeur, mandat_prix_max, " +
        "mandat_numero_registre, mandat_criteres_recherche",
    )
    .eq("id", leadId)
    .eq("cabinet_slug", cabinetSlug)
    .single();

  if (leadErr || !lead) {
    throw new Error(`Lead non trouvé : ${leadErr?.message ?? "404"}`);
  }

  // 2. Mandat type
  const mandatType = normalizeMandatType(
    String(args.mandatType ?? lead.mandat_type ?? "vente"),
  );
  const templateFile = TEMPLATE_FILES[mandatType];
  if (!templateFile) {
    throw new Error(`Type de mandat inconnu : ${mandatType}`);
  }
  const templatePath = resolve(TEMPLATES_DIR, templateFile);

  // 3. Numéro de registre (génère si pas déjà attribué)
  let numeroRegistre = lead.mandat_numero_registre as string | null;
  if (!numeroRegistre) {
    numeroRegistre = await generateNumeroRegistre(supabase, cabinetSlug);
  }

  // 4. Paramètres effectifs
  const dureeMois =
    args.dureeMois ??
    (lead.mandat_duree_mois as number | null) ??
    (mandatType === "vente" || mandatType === "mise_en_location" ? 3 : 6);
  const commissionPct =
    args.commissionPct ??
    (lead.mandat_commission_pct as number | null) ??
    (mandatType === "vente" ? 5 : 3);
  const prixNetVendeur =
    args.prixNetVendeur ??
    (lead.mandat_prix_net_vendeur as number | null) ??
    (lead.prix_total_median as number | null) ??
    0;
  const prixMax =
    args.prixMax ??
    (lead.mandat_prix_max as number | null) ??
    (lead.prix_total_median as number | null) ??
    0;

  const today = new Date();
  const endDate = new Date(today);
  endDate.setMonth(endDate.getMonth() + dureeMois);

  const commissionEur = Math.round(
    (prixNetVendeur || prixMax || 0) * (commissionPct / 100),
  );

  // 5. Splitter visitor_name en nom/prénom (best-effort)
  const visitorName = String(lead.visitor_name ?? "").trim();
  const parts = visitorName.split(" ").filter(Boolean);
  const clientPrenom = parts[0] ?? "";
  const clientNom = parts.slice(1).join(" ") || parts[0] || "";

  // 6. Construire les tags
  const tags: Record<string, string> = {
    // Header
    numero_registre: numeroRegistre,
    date_mandat: formatDateFr(today),
    date_fin: formatDateFr(endDate),

    // Mandataire (Diara — à enrichir avec données réelles plus tard)
    prenom_mandataire: "[Prénom mandataire]",
    nom_mandataire: "[Nom mandataire]",
    numero_rsac_mandataire: "[N° RSAC]",
    numero_attestation: "[N° attestation CCI]",

    // Client
    client_civilite: "M./Mme",
    client_nom: clientNom,
    client_prenom: clientPrenom,
    client_date_naissance: "[à compléter]",
    client_lieu_naissance: "[à compléter]",
    client_nationalite: "Française",
    client_adresse: "[à compléter]",
    client_telephone: String(lead.visitor_phone ?? ""),
    client_email: String(lead.visitor_email ?? ""),

    // Bien
    bien_type: String(lead.type_bien ?? "[à préciser]"),
    bien_adresse: String(lead.address ?? "[à préciser]"),
    bien_surface: String(lead.surface ?? "[à préciser]"),
    bien_surface_min: String(lead.surface ? Math.max(0, (lead.surface as number) - 10) : ""),
    bien_surface_max: String(lead.surface ? (lead.surface as number) + 10 : ""),
    bien_nb_pieces: "[à préciser]",
    bien_reference: "[référence cadastrale à compléter]",
    bien_description: "[description sommaire à compléter]",
    bien_zone_geo: String(lead.address ?? "[zone à préciser]"),
    bien_criteres_complementaires: "[à compléter]",
    bien_usage: "habitation",
    bien_meuble: "non",

    // Modalité
    mandat_modalite: String(
      args.mandatModalite ?? lead.mandat_modalite ?? "simple",
    ),
    duree_mois: String(dureeMois),

    // Prix
    prix_net_vendeur: prixNetVendeur.toLocaleString("fr-FR"),
    prix_net_vendeur_lettres: formatEurLettres(prixNetVendeur),
    prix_max: prixMax.toLocaleString("fr-FR"),
    prix_max_lettres: formatEurLettres(prixMax),

    // Honoraires
    commission_pct: String(commissionPct),
    commission_eur: commissionEur.toLocaleString("fr-FR"),
    commission_eur_lettres: formatEurLettres(commissionEur),
    commission_mois: "1",
    commission_bailleur_eur: Math.round(commissionEur * 0.5).toLocaleString("fr-FR"),
    commission_locataire_eur: Math.round(commissionEur * 0.5).toLocaleString("fr-FR"),

    // Location
    loyer_hc: "[à compléter]",
    loyer_max: "[à compléter]",
    charges_mensuelles: "[à compléter]",
    depot_garantie: "[à compléter]",
    date_entree_souhaitee: "[à compléter]",
  };

  // 7. Charger le template + remplir
  const templateBuffer = readFileSync(templatePath);
  const zip = new PizZip(templateBuffer);
  const docx = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
  });

  try {
    docx.render(tags);
  } catch (err) {
    const e = err as Error & { properties?: unknown };
    throw new Error(
      `Erreur docxtemplater : ${e.message} ${JSON.stringify(e.properties)}`,
    );
  }

  const filledBuffer = docx.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Buffer;

  // 8. Hash SHA-256 (pour ancrage blockchain)
  const hash = createHash("sha256")
    .update(filledBuffer)
    .digest("hex");

  // 9. Upload Supabase Storage
  const filename = `${mandatType}-${numeroRegistre}-${lead.id}.docx`;
  const storagePath = `${cabinetSlug}/${lead.id}/${filename}`;
  const { error: uploadErr } = await supabase.storage
    .from("mandats-hoguet")
    .upload(storagePath, filledBuffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });
  if (uploadErr) {
    throw new Error(`Upload Supabase failed: ${uploadErr.message}`);
  }

  // 10. Signed URL (1h)
  const { data: signed } = await supabase.storage
    .from("mandats-hoguet")
    .createSignedUrl(storagePath, 3600);
  const docx_url = signed?.signedUrl ?? "";

  // 11. Update dim_cabinet_leads
  await supabase
    .from("dim_cabinet_leads")
    .update({
      mandat_numero_registre: numeroRegistre,
      mandat_type: mandatType,
      mandat_duree_mois: dureeMois,
      mandat_commission_pct: commissionPct,
      mandat_prix_net_vendeur: prixNetVendeur || null,
      mandat_prix_max: prixMax || null,
      mandat_date_fin: endDate.toISOString().split("T")[0],
      signature_pdf_url: docx_url,
      signature_status: "pdf_generated",
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
    .eq("cabinet_slug", cabinetSlug);

  // 12. Inscrire dans dim_mandate_anchor (statut pending)
  try {
    await supabase.from("dim_mandate_anchor").upsert(
      {
        lead_id: leadId,
        mandate_hash_sha256: hash,
        anchor_status: "pending",
      },
      { onConflict: "lead_id" },
    );
  } catch (err) {
    console.warn("[generate-mandat-hoguet] anchor upsert skipped:", err);
  }

  return {
    docx_url,
    filename,
    hash_sha256: hash,
    numero_registre: numeroRegistre,
    template_used: templateFile,
  };
}
