/**
 * Helper serveur : génère le contrat de mandat fondateur et le stocke dans
 * Supabase Storage si pas déjà fait. Réutilisé par l'auto-onboarding et
 * mobilisable par les routes admin.
 *
 * Best-effort : renvoie { ok:false, reason } plutôt que de lever, pour ne
 * jamais bloquer le flux appelant (ex. progression d'onboarding).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateMandatFromMandataire,
  type MandataireRow,
} from "./generate-mandat";

export const MANDAT_BUCKET = "mandats-fondateurs";

const COLS =
  "id, first_name, last_name, email, company_name, founder_number, description, contract_generated_at, commission_eurealimmo_pct";

export async function ensureMandatGenerated(
  sb: SupabaseClient,
  mandataireId: string,
  opts: { force?: boolean } = {},
): Promise<{
  ok: boolean;
  storage_path?: string;
  filename?: string;
  reason?: string;
}> {
  const { data: m, error } = await sb
    .from("eurealimmo_mandataires")
    .select(COLS)
    .eq("id", mandataireId)
    .maybeSingle();

  if (error) return { ok: false, reason: error.message };
  if (!m) return { ok: false, reason: "mandataire_not_found" };

  const row = m as MandataireRow & { contract_generated_at: string | null };
  if (!opts.force && row.contract_generated_at) {
    return { ok: true, reason: "already_generated" };
  }

  let buffer: Buffer;
  let filename: string;
  try {
    ({ buffer, filename } = generateMandatFromMandataire(row));
  } catch (e) {
    // founder_number manquant / = 1, ou erreur de rendu
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  const storagePath = `${mandataireId}/${filename}`;
  const { error: upErr } = await sb.storage.from(MANDAT_BUCKET).upload(storagePath, buffer, {
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    upsert: true,
  });
  if (upErr) return { ok: false, reason: upErr.message };

  await sb
    .from("eurealimmo_mandataires")
    .update({ contract_generated_at: new Date().toISOString() })
    .eq("id", mandataireId);

  return { ok: true, storage_path: storagePath, filename };
}
