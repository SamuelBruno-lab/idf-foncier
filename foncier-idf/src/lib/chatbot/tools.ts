/**
 * DATAMERRY Chatbot — Tools (OpenAI function calling format).
 *
 * Le LLM (Groq Llama 3.1 8B) reçoit ces définitions et décide, selon la
 * question de l'agent immo, quels endpoints DATAMERRY appeler. Chaque tool
 * est exécuté côté serveur via les fonctions handler ci-dessous, qui font
 * des requêtes Supabase directes (pas de boucle HTTP interne).
 *
 * Aligné sur les endpoints existants :
 *   /api/estimate, /api/rendement, /api/plafonds-fiscaux,
 *   /api/rental-strategies, /api/property-report
 */

import { geocodeAddress } from "@/lib/geocode";
import { pointInPolygon } from "@/lib/geo";
import { getStreetview } from "@/lib/streetview";
import { getEcoles } from "@/lib/datasets/ecoles";
import { getTransports } from "@/lib/datasets/transports";
import { getServices } from "@/lib/datasets/services";
import { getSupabaseServerClient } from "@/lib/supabase-server";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type ToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

// ──────────────────────────────────────────────────────────────────────────────
// Définitions tools — exposées au LLM
// ──────────────────────────────────────────────────────────────────────────────

export const TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "estimate_property",
      description:
        "Estime la valeur marché d'un bien immobilier à une adresse donnée. " +
        "Renvoie prix au m² (médiane + fourchette p10/p90), prix total si surface fournie, " +
        "et le nombre de ventes notariées DVF dans la zone (cluster HDBSCAN). " +
        "À utiliser dès qu'on parle d'estimation, de prix, de valeur de marché.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Adresse complète (n° + rue + code postal + ville)" },
          surface: { type: "number", description: "Surface habitable en m² (optionnel)" },
          type_local: {
            type: "string",
            enum: ["Appartement", "Maison"],
            description: "Type du bien (défaut: Appartement)",
          },
        },
        required: ["address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compute_yield",
      description:
        "Calcule le rendement locatif (brut + net estimé) à une adresse, en utilisant " +
        "les loyers OLAP (37 agglos haute qualité) ou ANIL (France entière fallback). " +
        "À utiliser dès qu'on parle de rendement, de location, d'investissement locatif.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Adresse complète" },
          type_local: { type: "string", enum: ["Appartement", "Maison"] },
          pieces: { type: "number", description: "Nombre de pièces (T1=1, T3=3, etc.)" },
        },
        required: ["address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_fiscal_zone",
      description:
        "Renvoie la zone fiscale A/B/C de l'adresse et les plafonds des dispositifs " +
        "Jeanbrun, LLI, Loc'Avantages, Denormandie applicables. " +
        "À utiliser dès qu'on parle de dispositif fiscal, défiscalisation, plafonds.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Adresse complète" },
        },
        required: ["address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_rental_strategies",
      description:
        "Compare en 1 appel les 8 stratégies locatives possibles : libre marché, " +
        "Jeanbrun intermédiaire/social/très social, LLI, Loc'Avantages 3 niveaux. " +
        "Renvoie pour chacune : loyer mensuel max, rendement brut/net, économie IR/an. " +
        "À utiliser dès qu'on demande quelle stratégie choisir, comparer Jeanbrun à LLI, etc.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Adresse complète" },
          surface: { type: "number", description: "Surface en m² (obligatoire pour calcul)" },
          pieces: { type: "number", description: "Nombre de pièces (optionnel)" },
          prix_achat: {
            type: "number",
            description: "Prix d'achat en € (obligatoire pour calculer rendement brut)",
          },
          tmi: {
            type: "number",
            enum: [0, 11, 30, 41, 45],
            description: "TMI du client en % (tranche marginale d'imposition)",
          },
        },
        required: ["address", "surface"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "neighborhood_report",
      description:
        "Récupère un rapport quartier complet : écoles, transports, services proximité, " +
        "scores accessibilité et 'ville à 15 minutes'. " +
        "À utiliser dès qu'on parle de quartier, écoles, transports, qualité de vie, services.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Adresse complète" },
        },
        required: ["address"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compute_market_adjusted_price",
      description:
        "Calcule un prix de mise en vente AJUSTÉ au contexte macro actuel " +
        "(taux OAT 10 ans aujourd'hui vs moyenne historique des ventes du cluster). " +
        "Applique un modèle log-linéaire prix~taux avec β = -9% par +100bp " +
        "(médiane littérature française : Antipa-Lecat OFCE 2013 et analyse DVF×OAT DATAMERRY). " +
        "À utiliser dans le TEMPS 3 du conseil pour proposer un prix d'annonce CONSERVATEUR " +
        "tenant compte de la hausse/baisse des taux depuis l'historique des ventes DVF.",
      parameters: {
        type: "object",
        properties: {
          address: { type: "string", description: "Adresse complète" },
          surface: { type: "number", description: "Surface m² (obligatoire pour prix total)" },
          type_local: {
            type: "string",
            enum: ["Appartement", "Maison"],
            description: "Type de bien (défaut: Appartement)",
          },
        },
        required: ["address"],
      },
    },
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Handlers — chaque fonction correspond à un tool
// ──────────────────────────────────────────────────────────────────────────────

type TypeLocal = "Appartement" | "Maison";

const TYPE_DEFAULT: TypeLocal = "Appartement";

function resolveTypeLocal(input?: string): TypeLocal {
  if (!input) return TYPE_DEFAULT;
  const v = input.toLowerCase().trim();
  if (v.startsWith("maison")) return "Maison";
  return "Appartement";
}

async function geocode(address: string) {
  const sb = getSupabaseServerClient();
  const res = await geocodeAddress(address, sb);
  const top = res.results[0];
  if (!top) throw new Error(`Adresse non trouvée: ${address}`);
  return { sb, top };
}

// ── Tool: estimate_property ──────────────────────────────────────────────────
async function handleEstimate(args: {
  address: string;
  surface?: number;
  type_local?: string;
}) {
  const { sb, top } = await geocode(args.address);
  const typeLocal = resolveTypeLocal(args.type_local);

  const { data: zones, error } = await sb
    .from("dvf_hdbscan_zones")
    .select(
      "id, count, hull_coords, centroid_lat, centroid_lon, prix_m2_median, prix_m2_p10, prix_m2_p90",
    )
    .eq("code_commune", top.code_insee)
    .eq("type_local", typeLocal);

  if (error || !zones?.length) {
    return {
      available: false,
      address: top.label,
      reason: "Pas de cluster DVF pour cette commune × type",
    };
  }

  type Row = {
    id: string;
    count: number;
    hull_coords: number[][] | null;
    centroid_lat: number | null;
    centroid_lon: number | null;
    prix_m2_median: number | null;
    prix_m2_p10: number | null;
    prix_m2_p90: number | null;
  };
  const rows = zones as Row[];
  const point: [number, number] = [top.lat, top.lon];
  let match = rows.find((z) => z.hull_coords && pointInPolygon(point, z.hull_coords));
  if (!match) {
    let best: { row: Row; d: number } | null = null;
    for (const z of rows) {
      if (z.centroid_lat == null || z.centroid_lon == null) continue;
      const d = (z.centroid_lat - top.lat) ** 2 + (z.centroid_lon - top.lon) ** 2;
      if (!best || d < best.d) best = { row: z, d };
    }
    match = best?.row ?? rows[0];
  }

  const surface = args.surface && args.surface > 0 ? args.surface : null;
  return {
    available: true,
    address: top.label,
    code_insee: top.code_insee,
    type_local: typeLocal,
    surface,
    prix_m2_median: match.prix_m2_median,
    prix_m2_p10: match.prix_m2_p10,
    prix_m2_p90: match.prix_m2_p90,
    prix_total_median: surface && match.prix_m2_median ? Math.round(match.prix_m2_median * surface) : null,
    prix_total_p10: surface && match.prix_m2_p10 ? Math.round(match.prix_m2_p10 * surface) : null,
    prix_total_p90: surface && match.prix_m2_p90 ? Math.round(match.prix_m2_p90 * surface) : null,
    nb_ventes_dvf: match.count,
  };
}

// ── Tool: compute_yield ──────────────────────────────────────────────────────
async function handleYield(args: {
  address: string;
  type_local?: string;
  pieces?: number;
}) {
  const { sb, top } = await geocode(args.address);
  const typeLocal = resolveTypeLocal(args.type_local);
  const bucket =
    args.pieces == null ? "all" : args.pieces <= 2 ? "T1-T2" : "T3+";

  const { data } = await sb
    .from("fact_rendement")
    .select(
      "loyer_source, loyer_quality, loyer_m2_median, prix_m2_median, rendement_brut, rendement_net_est",
    )
    .eq("code_commune", top.code_insee)
    .eq("type_local", typeLocal)
    .eq("nb_pieces_bucket", bucket)
    .maybeSingle();

  if (!data) {
    return { available: false, address: top.label, reason: "Pas de loyer OLAP/ANIL pour cette zone" };
  }
  return { available: true, address: top.label, ...data };
}

// ── Tool: get_fiscal_zone ────────────────────────────────────────────────────
async function handleFiscalZone(args: { address: string }) {
  const { sb, top } = await geocode(args.address);

  const { data: zone } = await sb
    .from("dim_zonage_abc")
    .select("zone_abc")
    .eq("code_insee", top.code_insee)
    .maybeSingle();

  if (!zone) {
    return { available: false, address: top.label, reason: "Commune non zonée A/B/C" };
  }

  const zoneAbc = (zone as { zone_abc: string }).zone_abc;
  const { data: plafonds } = await sb
    .from("dim_plafonds_loyers_2025")
    .select("dispositif, niveau, loyer_max_m2, annee, source")
    .eq("zone_abc", zoneAbc);

  return {
    available: true,
    address: top.label,
    zone_abc: zoneAbc,
    plafonds: plafonds ?? [],
  };
}

// ── Tool: compare_rental_strategies ──────────────────────────────────────────
async function handleRentalStrategies(args: {
  address: string;
  surface: number;
  pieces?: number;
  prix_achat?: number;
  tmi?: number;
}) {
  // Réutilise les sous-agrégats : on calcule à la volée 8 scénarios
  // simplifiés (la version /api/rental-strategies en JSON est plus riche).
  const yieldData = await handleYield({
    address: args.address,
    type_local: "Appartement",
    pieces: args.pieces,
  });
  const fiscal = await handleFiscalZone({ address: args.address });

  const surface = args.surface;
  const prix = args.prix_achat ?? null;
  const tmi = args.tmi ?? 30;

  // Hypothèses (alignées avec /api/rental-strategies)
  const VACANCE_PCT = 5;
  const CHARGES_PCT = 15;
  const TF_PCT = 8;

  const loyerMarche =
    yieldData.available && "loyer_m2_median" in yieldData ? yieldData.loyer_m2_median : null;

  function compute(strategy: string, loyer_m2: number | null, jeanbrun = false, amort_annuel_eur: number | null = null) {
    if (loyer_m2 == null) {
      return { strategy, applicable: false, raison: "Loyer/m² indisponible pour cette zone" };
    }
    const coef = jeanbrun ? Math.min(0.7 + 19 / surface, 1.2) : 0.7 + 19 / surface;
    const loyer_mensuel = Math.round(loyer_m2 * coef * surface);
    const loyer_annuel = loyer_mensuel * 12;
    const rendement_brut = prix ? Math.round((loyer_annuel / prix) * 1000) / 10 : null;
    const rendement_net =
      rendement_brut != null
        ? Math.round(rendement_brut * (1 - (VACANCE_PCT + CHARGES_PCT + TF_PCT) / 100) * 10) / 10
        : null;
    const economie_ir_an = amort_annuel_eur ? Math.round(amort_annuel_eur * (tmi / 100)) : null;
    return {
      strategy,
      applicable: true,
      loyer_m2,
      loyer_mensuel_eur: loyer_mensuel,
      rendement_brut_pct: rendement_brut,
      rendement_net_pct: rendement_net,
      economie_ir_an_eur: economie_ir_an,
    };
  }

  // Plafonds par dispositif (fallback à loyer marché si non récupéré)
  const plafonds: Record<string, number | null> = {};
  if (fiscal.available && Array.isArray(fiscal.plafonds)) {
    for (const p of fiscal.plafonds as Array<{ dispositif: string; niveau: string; loyer_max_m2: number }>) {
      plafonds[`${p.dispositif}_${p.niveau}`] = p.loyer_max_m2;
    }
  }

  // Calcul amortissement Jeanbrun (sur 80% du prix d'achat)
  const baseAmort = prix ? prix * 0.8 : null;
  const amortJB = (taux: number, cap: number) =>
    baseAmort ? Math.min(baseAmort * (taux / 100), cap) : null;

  const scenarios = [
    compute("libre_marche", loyerMarche),
    compute("jeanbrun_intermediaire", plafonds["jeanbrun_intermediaire"] ?? null, true, amortJB(3.5, 8000)),
    compute("jeanbrun_social", plafonds["jeanbrun_social"] ?? null, true, amortJB(4.5, 10000)),
    compute("jeanbrun_tres_social", plafonds["jeanbrun_tres_social"] ?? null, true, amortJB(5.5, 12000)),
    compute("lli", plafonds["lli_all"] ?? null),
    compute("loc_avantages_intermediaire", plafonds["loc_avantages_intermediaire"] ?? null),
    compute("loc_avantages_social", plafonds["loc_avantages_social"] ?? null),
    compute("loc_avantages_tres_social", plafonds["loc_avantages_tres_social"] ?? null),
  ];

  return {
    address: args.address,
    surface,
    prix_achat: prix,
    tmi_pct: tmi,
    zone_abc: fiscal.available ? fiscal.zone_abc : null,
    scenarios,
    note:
      "Jeanbrun = amortissement (pas réduction IR directe). Cap du coefficient 1.2 vs LLI sans cap. " +
      "Horizon ≥ 15 ans recommandé pour Jeanbrun car amortissement réintégré à la plus-value.",
  };
}

// ── Tool: neighborhood_report ────────────────────────────────────────────────
async function handleNeighborhood(args: { address: string }) {
  const { top } = await geocode(args.address);

  const [streetview, ecoles, transports, services] = await Promise.all([
    getStreetview(top.lat, top.lon).catch(() => null),
    getEcoles(top.lat, top.lon).catch(() => null),
    getTransports(top.lat, top.lon).catch(() => null),
    getServices(top.lat, top.lon).catch(() => null),
  ]);

  return {
    address: top.label,
    streetview_url: streetview?.image_url ?? null,
    streetview_source: streetview?.source ?? null,
    ecoles: ecoles
      ? { count: ecoles.count, par_type: ecoles.par_type, top: ecoles.ecoles.slice(0, 5) }
      : null,
    transports: transports
      ? {
          count: transports.count,
          score_accessibilite_sur_100: transports.score_accessibilite,
          par_type: transports.par_type,
          top: transports.stops.slice(0, 5),
        }
      : null,
    services: services
      ? {
          count: services.count,
          score_quotidien_sur_100: services.score_quotidien,
          par_categorie: services.par_categorie,
        }
      : null,
  };
}

// ── Tool: compute_market_adjusted_price ──────────────────────────────────────
//
// Modèle log-linéaire : log(prix) = α + β × taux_oat
// β par défaut = -0.094 → exp(-0.094) - 1 ≈ -9.0% par +100bp de taux OAT
//
// Sources :
//   - Antipa & Lecat (OFCE 2013, DOLS panel 2003-2008) : -7,1%/+1pt taux bancaire
//   - DATAMERRY analyses/dvf_oat_correlation.py (à actualiser quand exécuté)
//
// Override via env DATAMERRY_BETA_OAT (ex: "-0.085" pour -8,5%/+100bp).
const BETA_OAT_DEFAULT = -0.094;
// Fenêtre historique par défaut (proxy en attendant d'exposer min/max date de
// mutation par cluster HDBSCAN). Les transactions DVF du cluster sont
// majoritairement dans cette fenêtre pour les datasets adaptive et 5y.
const OAT_HISTORICAL_WINDOW_START = "2020-01-01";
const OAT_HISTORICAL_WINDOW_END = "2025-12-31";

async function handleMarketAdjustedPrice(args: {
  address: string;
  surface?: number;
  type_local?: string;
}) {
  // 1) Prix de base via le tool d'estimation existant
  const estim = await handleEstimate({
    address: args.address,
    surface: args.surface,
    type_local: args.type_local,
  });
  if (!estim.available) {
    return {
      available: false,
      reason: "estimation_prix_indisponible",
      details:
        "reason" in estim ? estim.reason : "Le cluster DVF n'a pas pu être identifié.",
    };
  }
  if (estim.prix_m2_median == null) {
    return {
      available: false,
      reason: "no_prix_m2_in_cluster",
      details: "Le cluster DVF identifié n'a pas de prix médian (count=0 ou data corrompue).",
    };
  }

  // 2) Récupère OAT actuel + OAT moyen historique
  const sb = getSupabaseServerClient();

  let taux_actuel: number | null = null;
  try {
    const { data: latest, error } = await sb
      .from("fact_taux_oat10y")
      .select("taux_oat_10y, date_obs")
      .order("date_obs", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!error && latest) {
      taux_actuel = Number((latest as { taux_oat_10y: number }).taux_oat_10y);
    }
  } catch (err) {
    console.warn("[chatbot] fact_taux_oat10y query latest failed:", err);
  }

  if (taux_actuel == null) {
    return {
      available: false,
      reason: "oat_table_empty_or_missing",
      hint:
        "La table fact_taux_oat10y est vide ou inaccessible. " +
        "Lance : python pipeline_oat10y.py --bootstrap (Phase A).",
      // On renvoie quand même le prix brut pour que le LLM puisse continuer
      prix_m2_cluster_brut: estim.prix_m2_median,
      prix_total_cluster_brut: estim.prix_total_median ?? null,
    };
  }

  let taux_moyen_historique: number | null = null;
  try {
    const { data: rows, error } = await sb
      .from("fact_taux_oat10y")
      .select("taux_oat_10y")
      .gte("date_obs", OAT_HISTORICAL_WINDOW_START)
      .lte("date_obs", OAT_HISTORICAL_WINDOW_END);
    if (!error && rows && rows.length > 0) {
      const typed = rows as Array<{ taux_oat_10y: number }>;
      taux_moyen_historique =
        typed.reduce((acc, r) => acc + Number(r.taux_oat_10y), 0) / typed.length;
    }
  } catch (err) {
    console.warn("[chatbot] fact_taux_oat10y avg query failed:", err);
  }

  if (taux_moyen_historique == null) {
    return {
      available: false,
      reason: "oat_avg_unavailable",
      hint:
        "Impossible de calculer OAT moyen historique " +
        `${OAT_HISTORICAL_WINDOW_START} → ${OAT_HISTORICAL_WINDOW_END}.`,
      taux_oat_actuel: taux_actuel,
      prix_m2_cluster_brut: estim.prix_m2_median,
    };
  }

  // 3) Application du modèle log-linéaire
  const betaRaw = process.env.DATAMERRY_BETA_OAT;
  const BETA = betaRaw ? Number(betaRaw) : BETA_OAT_DEFAULT;
  const delta_taux_pts = taux_actuel - taux_moyen_historique;
  const adjustment_factor = Math.exp(BETA * delta_taux_pts);
  const delta_pct = (adjustment_factor - 1) * 100;

  const prix_m2_brut = estim.prix_m2_median;
  const prix_m2_ajuste = Math.round(prix_m2_brut * adjustment_factor);

  const surface_safe = args.surface && args.surface > 0 ? args.surface : null;
  const prix_total_ajuste = surface_safe
    ? Math.round(prix_m2_ajuste * surface_safe)
    : null;

  // Suggestions opérationnelles (prix annonce / plancher / plan B)
  const prix_annonce_m2 = Math.round(prix_m2_ajuste * 1.04); // marge négo +4%
  const prix_plancher_m2 = Math.round(prix_m2_ajuste * 0.95); // -5% sous la valeur ajustée
  const prix_annonce_total = surface_safe ? prix_annonce_m2 * surface_safe : null;
  const prix_plancher_total = surface_safe ? prix_plancher_m2 * surface_safe : null;

  return {
    available: true,
    address: estim.address,
    surface: surface_safe,

    // Avant ajustement (référence cluster brute)
    prix_m2_cluster_brut: prix_m2_brut,
    prix_total_cluster_brut: estim.prix_total_median ?? null,
    nb_ventes_dvf: estim.nb_ventes_dvf,

    // Contexte marché OAT
    taux_oat_actuel_pct: round(taux_actuel, 4),
    taux_oat_moyen_historique_pct: round(taux_moyen_historique, 4),
    delta_taux_pts: round(delta_taux_pts, 3),
    periode_historique: `${OAT_HISTORICAL_WINDOW_START} → ${OAT_HISTORICAL_WINDOW_END}`,

    // Paramètres modèle
    beta_applique: BETA,
    elasticite_par_100bp_pct: round((Math.exp(BETA) - 1) * 100, 2),
    methodologie:
      "Modèle log-linéaire log(prix) = α + β × taux_oat. " +
      "β par défaut = -0.094 (médiane littérature française : Antipa-Lecat OFCE 2013 et benchmark DATAMERRY). " +
      "Override via variable env DATAMERRY_BETA_OAT.",

    // Résultat ajusté
    delta_pct: round(delta_pct, 2),
    prix_m2_ajuste,
    prix_total_ajuste,

    // Suggestions opérationnelles
    suggestions: {
      prix_annonce_m2,
      prix_annonce_total,
      prix_plancher_m2,
      prix_plancher_total,
      note:
        "Prix annonce = ajusté × 1.04 (marge de négociation +4%). " +
        "Prix plancher = ajusté × 0.95 (en-dessous, le bien est largement sous-coté). " +
        "Plan B à 60 jours si pas d'offre : repasser au prix ajusté brut.",
    },

    warnings: [
      delta_pct < -15
        ? "Forte décote (-15%+) liée à la remontée des taux OAT vs historique. " +
          "Plus value latente faible pour le vendeur — argumenter horizon long terme."
        : null,
      delta_pct > 10
        ? "Prime liée à la baisse des taux OAT vs historique. " +
          "Opportunité de timing pour le vendeur, mais attention aux acheteurs prudents."
        : null,
      Math.abs(delta_taux_pts) < 0.2
        ? "Faible delta de taux : ajustement marginal, le prix cluster reste très représentatif."
        : null,
    ].filter(Boolean),
  };
}

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

// ──────────────────────────────────────────────────────────────────────────────
// Dispatcher
// ──────────────────────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  rawArgs: string,
): Promise<unknown> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return { error: "invalid_arguments", raw: rawArgs };
  }

  try {
    switch (name) {
      case "estimate_property":
        return await handleEstimate(args as Parameters<typeof handleEstimate>[0]);
      case "compute_yield":
        return await handleYield(args as Parameters<typeof handleYield>[0]);
      case "get_fiscal_zone":
        return await handleFiscalZone(args as Parameters<typeof handleFiscalZone>[0]);
      case "compare_rental_strategies":
        return await handleRentalStrategies(args as Parameters<typeof handleRentalStrategies>[0]);
      case "neighborhood_report":
        return await handleNeighborhood(args as Parameters<typeof handleNeighborhood>[0]);
      case "compute_market_adjusted_price":
        return await handleMarketAdjustedPrice(
          args as Parameters<typeof handleMarketAdjustedPrice>[0],
        );
      default:
        return { error: `unknown_tool: ${name}` };
    }
  } catch (err) {
    return { error: "tool_execution_failed", message: String(err) };
  }
}
