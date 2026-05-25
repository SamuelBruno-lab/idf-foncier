/**
 * scripts/issue-api-key.ts
 *
 * Émet une clé API DATAMERRY à la main, avant que Stripe (Phase 9) ne le fasse
 * automatiquement. Cas d'usage immédiat : clé pilote Collabimmo (gratuit à vie
 * selon engagement Samuel).
 *
 * Usage clé serveur :
 *   npx tsx scripts/issue-api-key.ts \
 *     --cabinet "Collabimmo" \
 *     --email "diara@collabimmo.fr" \
 *     --plan pilot \
 *     --siren 123456789 \
 *     --notes "Pilote n°1, tarif gelé 39€/mo à vie"
 *
 * Usage clé widget (pour intégration <div data-datamerry-report>) :
 *   npx tsx scripts/issue-api-key.ts \
 *     --cabinet "Collabimmo" \
 *     --email "diara@collabimmo.fr" \
 *     --plan widget \
 *     --referrers "collabimmo.fr,www.collabimmo.fr,*.collabimmo.fr"
 *
 * Plans disponibles : pilot | pro | enterprise | internal | widget
 *   - pilot      : 50k req, tarif gelé (utilisé pour Collabimmo)
 *   - pro        : 50k req, 39€ TTC/mo + overage 1€/1000 (offre standard)
 *   - enterprise : sur devis, quota custom
 *   - internal   : usage interne datamerry (tests, dashboard admin)
 *   - widget     : clé publique restreinte par domaine (wdmk_live_…), 5k req/mo par défaut
 *
 * Pré-requis ENV :
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * IMPORTANT : la clé en clair n'est affichée QU'UNE SEULE FOIS, à la sortie de
 * ce script. Copie-la et envoie-la au cabinet par email immédiatement.
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";

const BASE32_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

function generateApiKey(env: "live" | "test" = "live", widget = false): string {
  const bytes = randomBytes(40);
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return `${widget ? "wdmk" : "dmk"}_${env}_${out}`;
}

function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

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

  if (!args.cabinet || !args.email) {
    console.error(
      "Usage: tsx scripts/issue-api-key.ts --cabinet <nom> --email <mail> " +
        "[--plan pilot|pro|enterprise|internal] [--siren 123] [--quota 50000] " +
        "[--env live|test] [--notes \"texte libre\"]",
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

  const plan = (args.plan ?? "pro") as
    | "pilot"
    | "pro"
    | "enterprise"
    | "internal"
    | "widget";
  const quota = Number(args.quota ?? (plan === "widget" ? "5000" : "50000"));
  const env = (args.env ?? "live") as "live" | "test";

  // Clés widget = wdmk_live_… (préfixe différent), exigent un référent
  const isWidget = plan === "widget";
  const allowedReferrers: string[] | null = args.referrers
    ? args.referrers.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    : null;

  if (isWidget && (!allowedReferrers || allowedReferrers.length === 0)) {
    console.error(
      "Pour une clé widget, --referrers est obligatoire. " +
        "Ex: --referrers \"collabimmo.fr,www.collabimmo.fr,*.collabimmo.fr\"",
    );
    process.exit(1);
  }

  const rawKey = generateApiKey(env, isWidget);
  const keyHash = hashApiKey(rawKey);
  const keyPrefix = rawKey.slice(0, 8); // 'dmk_live' / 'wdmk_liv'

  const sb = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await sb
    .from("dim_api_keys")
    .insert({
      cabinet_name: args.cabinet,
      contact_email: args.email,
      siren: args.siren ?? null,
      key_prefix: keyPrefix,
      key_hash: keyHash,
      plan,
      monthly_quota: quota,
      overage_per_1k_eur_ttc:
        plan === "pilot" || plan === "internal" || plan === "widget" ? 0 : 1.0,
      first_month_free: plan === "pro",
      allowed_referrers: allowedReferrers,
      notes: args.notes ?? null,
    })
    .select("id, cabinet_name, plan, monthly_quota, allowed_referrers, created_at")
    .single();

  if (error) {
    console.error("Insert failed:", error);
    process.exit(1);
  }

  console.log("\n──────────────────────────────────────────────────────────────");
  console.log("  DATAMERRY API KEY ISSUED");
  console.log("──────────────────────────────────────────────────────────────");
  console.log("  Cabinet     :", data.cabinet_name);
  console.log("  Plan        :", data.plan);
  console.log("  Quota inclus:", data.monthly_quota, "req/mo");
  if (data.allowed_referrers) {
    console.log("  Domaines    :", (data.allowed_referrers as string[]).join(", "));
  }
  console.log("  ID interne  :", data.id);
  console.log("  Créée le    :", data.created_at);
  console.log("");
  console.log("  CLÉ EN CLAIR (à transmettre au cabinet, NON RÉCUPÉRABLE ensuite):");
  console.log("");
  console.log("    " + rawKey);
  console.log("");
  if (isWidget) {
    console.log("  Intégration HTML (à coller sur le site cabinet) :");
    console.log("");
    console.log("    <script src=\"https://datamerry.com/widget.js\" async></script>");
    console.log("    <div data-datamerry-report");
    console.log(`         data-key="${rawKey}"`);
    console.log("         data-address=\"10 rue de Paris 75001\"");
    console.log("         data-surface=\"62\"></div>");
  } else {
    console.log("  Test rapide :");
    console.log(
      `    curl -H "X-API-Key: ${rawKey}" "https://datamerry.com/api/address/search?q=10+rue+de+rivoli"`,
    );
  }
  console.log("──────────────────────────────────────────────────────────────\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
