/**
 * POST /api/cabinets/{slug}/admin/mandataires/contrats/batch
 *
 * Génère en lot les contrats de mandat fondateur pour tous les mandataires
 * éligibles (founder_number renseigné, ≠ 1, actifs). Stocke chaque .docx dans
 * Supabase Storage et renvoie le récapitulatif par mandataire.
 *
 * Body JSON optionnel :
 *   { "only_missing"?: boolean }   // ne (re)génère que ceux sans contrat (défaut true)
 *   { "ids"?: string[] }           // restreint à une liste d'UUID
 *
 * Note : la place fondateur n° 1 (Associée Fondatrice n° 1) est volontairement
 * exclue — elle dispose d'un contrat dédié (Art. 8 / 8 bis).
 *
 * Auth : session admin du même cabinet (slug).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAdminSession } from "@/lib/admin-auth";
import {
  generateMandatFromMandataire,
  type MandataireRow,
} from "@/lib/contracts/generate-mandat";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

const BUCKET = "mandats-fondateurs";
const MANDATAIRE_COLS =
  "id, first_name, last_name, email, company_name, founder_number, description, contract_generated_at, commission_eurealimmo_pct";

type Row = MandataireRow & { contract_generated_at: string | null };

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  const session = getAdminSession(req);
  if (!session || session.slug !== slug) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { only_missing?: boolean; ids?: string[] } = {};
  try {
    const txt = await req.text();
    if (txt) body = JSON.parse(txt);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const onlyMissing = body.only_missing ?? true;

  const sb = getSupabase();

  // Tous les mandataires actifs avec un tier déterminable (commission 5 ou 8).
  // La fondatrice n° 1 (Diara) et les fondateurs sans numéro sont écartés
  // par le try/catch de génération (contrat manuel / pré-requis manquant).
  let filter = sb
    .from("eurealimmo_mandataires")
    .select(MANDATAIRE_COLS)
    .in("commission_eurealimmo_pct", [5, 8])
    .eq("is_active", true);

  if (body.ids && body.ids.length > 0) {
    filter = filter.in("id", body.ids);
  }

  const { data, error } = await filter.order("founder_number", { ascending: true });
  if (error) {
    console.error("[contrats/batch] query:", error);
    return NextResponse.json({ error: "db_error", detail: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as Row[];
  const results: Array<{
    id: string;
    founder_number: number | null;
    status: "generated" | "skipped" | "error";
    filename?: string;
    storage_path?: string;
    detail?: string;
  }> = [];

  for (const m of rows) {
    if (onlyMissing && m.contract_generated_at) {
      results.push({ id: m.id, founder_number: m.founder_number, status: "skipped", detail: "déjà généré" });
      continue;
    }
    try {
      const { buffer, filename } = generateMandatFromMandataire(m);
      const storagePath = `${m.id}/${filename}`;
      const { error: upErr } = await sb.storage.from(BUCKET).upload(storagePath, buffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        upsert: true,
      });
      if (upErr) {
        results.push({ id: m.id, founder_number: m.founder_number, status: "error", detail: upErr.message });
        continue;
      }
      await sb
        .from("eurealimmo_mandataires")
        .update({ contract_generated_at: new Date().toISOString() })
        .eq("id", m.id);
      results.push({ id: m.id, founder_number: m.founder_number, status: "generated", filename, storage_path: storagePath });
    } catch (e) {
      results.push({
        id: m.id,
        founder_number: m.founder_number,
        status: "error",
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const summary = {
    total: rows.length,
    generated: results.filter((r) => r.status === "generated").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
  };

  return NextResponse.json({ ok: true, summary, results });
}
