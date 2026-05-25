/**
 * scripts/issue-cabinet.ts
 *
 * Provisionne un cabinet white-label DATAMERRY en 1 commande.
 *
 * Usage:
 *   npx tsx scripts/issue-cabinet.ts \
 *     --slug "collabimmo" \
 *     --name "Collabimmo" \
 *     --color "#c2410c" \
 *     --cta-url "https://collabimmo.fr/contact" \
 *     --cta-label "Demander un rendez-vous gratuit" \
 *     --email "diara@collabimmo.fr" \
 *     --phone "+33 1 23 45 67 89" \
 *     --logo-url "https://collabimmo.fr/logo.png" \
 *     --legal "Cabinet titulaire carte T n° CPI..."
 *
 * Pré-requis : la clé API du cabinet doit déjà avoir été émise avec
 * scripts/issue-api-key.ts (--plan pilot ou --plan pro). Le script lie ensuite
 * automatiquement la clé au cabinet via api_key_id.
 *
 * Le script :
 *   1. Insère l'entrée dans dim_cabinets_white_label
 *   2. Affiche les URLs publiques à partager (page estimer, assistant, rapport)
 *   3. Affiche le snippet bouton HTML à coller sur le site du cabinet
 */

import { createClient } from "@supabase/supabase-js";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
      out[key] = val;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const slug = (args.slug ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug || !args.name || !args["cta-url"]) {
    console.error(
      "Usage: tsx scripts/issue-cabinet.ts --slug <slug> --name <name> --cta-url <url> " +
        '[--color "#c2410c"] [--logo-url <url>] [--email <m>] [--phone <p>] ' +
        '[--cta-label "Demander un RDV"] [--legal "Carte T n°..."] [--api-key-id <uuid>]',
    );
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    console.error(
      "Variables manquantes : NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
    process.exit(1);
  }

  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Si --api-key-id absent, tente de récupérer la dernière clé du cabinet par email
  let apiKeyId = args["api-key-id"] ?? null;
  if (!apiKeyId && args.email) {
    const { data: keys } = await sb
      .from("dim_api_keys")
      .select("id, plan, created_at")
      .eq("contact_email", args.email)
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(1);
    if (keys && keys.length > 0) {
      apiKeyId = (keys[0] as { id: string }).id;
      console.log(`  ℹ️ Clé API trouvée par email ${args.email} : ${apiKeyId}`);
    }
  }

  const { data, error } = await sb
    .from("dim_cabinets_white_label")
    .upsert(
      {
        slug,
        cabinet_name: args.name,
        primary_color: args.color ?? "#1f3a8a",
        secondary_color: args["secondary-color"] ?? null,
        logo_url: args["logo-url"] ?? null,
        cta_contact_url: args["cta-url"],
        cta_contact_label: args["cta-label"] ?? "Demander un rendez-vous gratuit",
        contact_email: args.email ?? null,
        contact_phone: args.phone ?? null,
        legal_mention: args.legal ?? null,
        api_key_id: apiKeyId,
        active: true,
        notes: args.notes ?? null,
      },
      { onConflict: "slug" },
    )
    .select("slug, cabinet_name, primary_color")
    .single();

  if (error) {
    console.error("Insert failed:", error);
    process.exit(1);
  }

  const base = "https://datamerry.com";
  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("  DATAMERRY CABINET WHITE-LABEL PROVISIONNÉ");
  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Cabinet     :", data.cabinet_name);
  console.log("  Slug        :", data.slug);
  console.log("  Couleur     :", data.primary_color);
  if (apiKeyId) console.log("  Clé liée    :", apiKeyId);
  console.log("");
  console.log("  📎 URLs publiques à partager au cabinet :");
  console.log("");
  console.log(`     Estimer :     ${base}/cabinets/${slug}/estimer`);
  console.log(`     Assistant :   ${base}/cabinets/${slug}/assistant   (chatbot — prochaine release)`);
  console.log(`     Rapport :     ${base}/cabinets/${slug}/rapport     (sur adresse — prochaine release)`);
  console.log("");
  console.log("  📋 Bouton HTML à coller sur le site du cabinet (5 min, n'importe quel CMS) :");
  console.log("");
  console.log(`     <a href="${base}/cabinets/${slug}/estimer"`);
  console.log(`        style="display:inline-block;background:${data.primary_color};color:white;`);
  console.log(`               padding:14px 28px;border-radius:8px;font-weight:700;`);
  console.log(`               text-decoration:none;font-family:sans-serif;font-size:15px;"`);
  console.log(`        target="_blank" rel="noopener">`);
  console.log(`       🏠 Estimer mon bien gratuitement`);
  console.log(`     </a>`);
  console.log("");
  console.log("──────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
