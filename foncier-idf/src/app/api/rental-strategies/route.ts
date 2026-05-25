/**
 * GET /api/rental-strategies?address=...&surface=62&pieces=3&prix_achat=220000&tmi=41
 *
 * Endpoint agrégateur : compare en 1 appel toutes les stratégies locatives
 * pour une adresse + surface + (optionnel) prix d'achat + (optionnel) TMI.
 *
 * Renvoie 5 scénarios côte à côte :
 *   1. LIBRE              — location sans dispositif fiscal (loyer OLAP marché)
 *   2. JEANBRUN intermédiaire — successeur Pinel, amortissement 3.5%/an
 *   3. JEANBRUN social        — amortissement 4.5%/an, plafond 10k€
 *   4. JEANBRUN très social   — amortissement 5.5%/an, plafond 12k€
 *   5. LLI                 — TVA 10% + exo TF 20 ans, plafonds Pinel-like
 *   6. LOC'AVANTAGES       — réduction d'IR proportionnelle (intermédiaire/social/très social)
 *
 * Chaque scénario contient :
 *   - loyer_m2_max (€/m²/mois)
 *   - loyer_mensuel_eur
 *   - rendement_brut_pct (si prix_achat fourni)
 *   - economie_impot_annuelle_eur (si tmi fourni)
 *   - conditions (liste)
 *   - applicable (boolean — selon zone, type bien, etc.)
 *
 * Conçu pour être appelé en 1 fois par le chatbot LLM (Phase 3 post-IBM).
 */

import { NextRequest, NextResponse } from "next/server";

import { geocodeAddress, type GeocodeMeta } from "@/lib/geocode";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { withApiKey } from "@/lib/auth/apiKey";

function bucketFromPieces(pieces: number | null): "T1-T2" | "T3+" | "all" {
  if (pieces == null || !Number.isFinite(pieces)) return "all";
  if (pieces <= 2) return "T1-T2";
  return "T3+";
}

// Hypothèses pour le rendement net (cohérent avec dim_rendement_hypotheses)
const VACANCE_PCT = 5;
const CHARGES_PCT = 15;
const TAXE_FONCIERE_PCT = 8;

// Taux d'amortissement Jeanbrun par niveau (% annuel sur 80% du prix)
const JEANBRUN_AMORT = {
  intermediaire: { taux_pct: 3.5, plafond_annuel_eur: 8000 },
  social: { taux_pct: 4.5, plafond_annuel_eur: 10000 },
  tres_social: { taux_pct: 5.5, plafond_annuel_eur: 12000 },
} as const;

// Loc'Avantages : réduction d'IR sur le loyer brut (Pinel-like)
const LOC_AVANTAGES_REDUCTION_PCT = {
  intermediaire: 15,
  social: 35,
  tres_social: 65,
} as const;

type Plafond = { loyer_max_m2: number; annee: number; source: string | null };

function loyerMensuelMax(plafond: number, surface: number, jeanbrun = false): number {
  // Jeanbrun a un cap 1.2 sur le coefficient, LLI/Loc'Av n'en ont pas
  const coef = jeanbrun
    ? Math.min(0.7 + 19 / surface, 1.2)
    : 0.7 + 19 / surface;
  return Math.round(plafond * coef * surface);
}

function rendementBrut(loyerMensuel: number, prixAchat: number | null): number | null {
  if (!prixAchat || prixAchat <= 0) return null;
  return Math.round((loyerMensuel * 12 * 1000) / prixAchat) / 10;
}

function rendementNet(brut: number | null): number | null {
  if (brut == null) return null;
  return (
    Math.round(brut * (1 - (VACANCE_PCT + CHARGES_PCT + TAXE_FONCIERE_PCT) / 100) * 10) / 10
  );
}

async function handleRentalStrategies(
  req: NextRequest,
): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const address = sp.get("address")?.trim();
  const codeCommune = sp.get("code_commune")?.trim();
  const surfaceRaw = sp.get("surface");
  const surface = surfaceRaw ? Number(surfaceRaw) : null;
  const prixAchatRaw = sp.get("prix_achat");
  const prixAchat = prixAchatRaw ? Number(prixAchatRaw) : null;
  const tmiRaw = sp.get("tmi");
  const tmi = tmiRaw ? Number(tmiRaw) : null;
  const piecesRaw = sp.get("pieces");
  const pieces = piecesRaw ? Number(piecesRaw) : null;

  if (!address && !codeCommune) {
    return NextResponse.json(
      { error: "address ou code_commune requis" },
      { status: 400 },
    );
  }
  if (!surface || surface <= 0) {
    return NextResponse.json(
      { error: "surface (m²) requise et > 0" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();

  // ── 1. Résolution adresse + zone ABC ─────────────────────────────────
  let resolvedCommune: string;
  let addressPayload: Record<string, unknown> | null = null;
  let geocodeMeta: GeocodeMeta | null = null;
  if (address) {
    const g = await geocodeAddress(address, supabase);
    const top = g.results[0];
    if (!top) {
      return NextResponse.json({ error: "Adresse introuvable" }, { status: 404 });
    }
    resolvedCommune = top.code_insee;
    addressPayload = {
      label: top.label,
      lat: top.lat,
      lon: top.lon,
      code_insee: top.code_insee,
      city: top.city,
    };
    geocodeMeta = g.meta;
  } else {
    resolvedCommune = codeCommune!;
  }

  // Zone ABC pour les plafonds fiscaux
  const { data: zoneRow } = await supabase
    .from("dim_zonage_abc")
    .select("zone")
    .eq("code_insee", resolvedCommune)
    .order("annee", { ascending: false })
    .limit(1)
    .maybeSingle();
  const zone = (zoneRow?.zone as string | undefined) ?? null;

  // ── 2. Plafonds fiscaux pour cette zone ──────────────────────────────
  const plafonds = new Map<string, Plafond>();
  if (zone) {
    const { data: rows } = await supabase
      .from("dim_plafond_loyer")
      .select("dispositif, loyer_max_m2, annee, source_juridique")
      .eq("zone", zone)
      .order("annee", { ascending: false });
    for (const r of rows ?? []) {
      const d = r.dispositif as string;
      if (!plafonds.has(d)) {
        plafonds.set(d, {
          loyer_max_m2: Number(r.loyer_max_m2),
          annee: Number(r.annee),
          source: (r.source_juridique as string | null) ?? null,
        });
      }
    }
  }

  // ── 3. Loyer marché libre (OLAP / ANIL) ──────────────────────────────
  const bucket = bucketFromPieces(pieces);
  const { data: marche } = await supabase
    .from("fact_rendement")
    .select("loyer_m2_median, loyer_source, loyer_quality, loyer_annee")
    .eq("code_commune", resolvedCommune)
    .eq("type_local", "Appartement")
    .in("nb_pieces_bucket", [bucket, "all"])
    .order("nb_pieces_bucket", { ascending: false })
    .limit(1)
    .maybeSingle();

  const loyerMarcheM2 = marche?.loyer_m2_median ? Number(marche.loyer_m2_median) : null;

  // ── 4. Construction des scénarios ────────────────────────────────────
  type Scenario = {
    label: string;
    applicable: boolean;
    conditions: string[];
    loyer_m2_zone: number | null;
    loyer_m2_effective: number | null;
    loyer_mensuel_eur: number | null;
    rendement_brut_pct: number | null;
    rendement_net_pct: number | null;
    avantage_fiscal: Record<string, unknown> | null;
    economie_impot_annuelle_eur: number | null;
    advisory: string | null;
  };

  // Scénario LIBRE — pas de dispositif, loyer marché OLAP
  const loyerLibreMensuel = loyerMarcheM2 ? Math.round(loyerMarcheM2 * surface) : null;
  const scenarioLibre: Scenario = {
    label: "Location libre (sans dispositif fiscal)",
    applicable: loyerMarcheM2 != null,
    conditions: ["Aucune condition particulière", "Aucun plafond de loyer", "Loyer fixé librement par le bailleur"],
    loyer_m2_zone: null,
    loyer_m2_effective: loyerMarcheM2,
    loyer_mensuel_eur: loyerLibreMensuel,
    rendement_brut_pct: rendementBrut(loyerLibreMensuel ?? 0, prixAchat),
    rendement_net_pct: rendementNet(rendementBrut(loyerLibreMensuel ?? 0, prixAchat)),
    avantage_fiscal: {
      type: "aucun",
      fiscalite: "Loyers imposés au barème IR (TMI) + prélèvements sociaux 17.2%",
      cas_d_usage: "Toute typologie. Surtout pertinent si TMI ≤ 30% ou si vous voulez rester libre du locataire",
    },
    economie_impot_annuelle_eur: null,
    advisory: null,
  };

  // Helpers pour scénarios fiscaux à plafond
  const buildPlafondScenario = (
    dispositif: string,
    label: string,
    plafondKey: string,
    conditions: string[],
    avantage: Record<string, unknown>,
    advisory: string | null,
    isJeanbrun = false,
    reductionIRPct: number | null = null,
    amortPct: number | null = null,
    amortPlafondAnnuel: number | null = null,
  ): Scenario => {
    const plafond = plafonds.get(plafondKey);
    if (!plafond) {
      return {
        label,
        applicable: false,
        conditions,
        loyer_m2_zone: null,
        loyer_m2_effective: null,
        loyer_mensuel_eur: null,
        rendement_brut_pct: null,
        rendement_net_pct: null,
        avantage_fiscal: avantage,
        economie_impot_annuelle_eur: null,
        advisory,
      };
    }
    const loyerMensuel = loyerMensuelMax(plafond.loyer_max_m2, surface, isJeanbrun);
    const brut = rendementBrut(loyerMensuel, prixAchat);

    // Économie d'impôt annuelle selon mécanisme
    let economieImpot: number | null = null;
    if (tmi && tmi > 0) {
      if (amortPct && prixAchat) {
        // Jeanbrun / LLI ancien : amortissement déductible
        const base = prixAchat * 0.8;
        const amortTheorique = (base * amortPct) / 100;
        const amortReel = amortPlafondAnnuel
          ? Math.min(amortTheorique, amortPlafondAnnuel)
          : amortTheorique;
        economieImpot = Math.round(amortReel * (tmi / 100));
      } else if (reductionIRPct && loyerMensuel) {
        // Loc'Avantages : réduction d'IR sur le loyer brut
        const loyerAnnuel = loyerMensuel * 12;
        economieImpot = Math.round(loyerAnnuel * (reductionIRPct / 100));
      }
    }

    return {
      label,
      applicable: true,
      conditions,
      loyer_m2_zone: plafond.loyer_max_m2,
      loyer_m2_effective: loyerMensuel / surface,
      loyer_mensuel_eur: loyerMensuel,
      rendement_brut_pct: brut,
      rendement_net_pct: rendementNet(brut),
      avantage_fiscal: avantage,
      economie_impot_annuelle_eur: economieImpot,
      advisory,
    };
  };

  const JEANBRUN_COMMON_CONDITIONS = [
    "Logements collectifs uniquement (maisons individuelles exclues)",
    "Neuf, VEFA, ou ancien avec travaux ≥ 30 000€ (réhabilitation)",
    "Engagement de location 9 ans (prorogeable)",
    "Résidence principale du locataire",
    "Plafonds de ressources du locataire à respecter",
  ];

  const scenarioJeanbrunInt = buildPlafondScenario(
    "jeanbrun_intermediaire",
    "Jeanbrun niveau intermédiaire",
    "jeanbrun_intermediaire",
    JEANBRUN_COMMON_CONDITIONS,
    {
      type: "amortissement",
      mecanisme: "Amortissement déductible des revenus fonciers : 3.5%/an sur 80% du prix, plafonné à 8 000€/an",
      hors_plafond_niches_fiscales: true,
      reintegration_plus_value: "Oui à la revente (cf. réforme LMNP 02/2025)",
    },
    "Intéressant pour TMI ≥ 41%. Horizon long recommandé (≥15 ans) pour amortir la réintégration PV à la revente.",
    true,
    null,
    JEANBRUN_AMORT.intermediaire.taux_pct,
    JEANBRUN_AMORT.intermediaire.plafond_annuel_eur,
  );

  const scenarioJeanbrunSoc = buildPlafondScenario(
    "jeanbrun_social",
    "Jeanbrun niveau social",
    "jeanbrun_social",
    JEANBRUN_COMMON_CONDITIONS,
    {
      type: "amortissement",
      mecanisme: "Amortissement 4.5%/an sur 80% du prix, plafonné à 10 000€/an",
      hors_plafond_niches_fiscales: true,
    },
    "Plus avantageux fiscalement que Jeanbrun intermédiaire mais loyer encore plus décoté (-30% marché).",
    true,
    null,
    JEANBRUN_AMORT.social.taux_pct,
    JEANBRUN_AMORT.social.plafond_annuel_eur,
  );

  const scenarioJeanbrunVS = buildPlafondScenario(
    "jeanbrun_tres_social",
    "Jeanbrun niveau très social",
    "jeanbrun_tres_social",
    JEANBRUN_COMMON_CONDITIONS,
    {
      type: "amortissement",
      mecanisme: "Amortissement 5.5%/an sur 80% du prix, plafonné à 12 000€/an",
      hors_plafond_niches_fiscales: true,
    },
    "Maximum d'amortissement. Loyer -45% marché — adapté seulement si gros besoin de défiscalisation et acceptation locataire très modeste.",
    true,
    null,
    JEANBRUN_AMORT.tres_social.taux_pct,
    JEANBRUN_AMORT.tres_social.plafond_annuel_eur,
  );

  const scenarioLLI = buildPlafondScenario(
    "lli",
    "LLI (Logement Locatif Intermédiaire)",
    "lli",
    [
      "Investisseur particulier ou société (étendu aux particuliers depuis 2024)",
      "Logements collectifs neufs/VEFA",
      "Engagement location 20 ans",
      "Plafonds ressources locataire selon zone",
      "Zone Abis/A/B1/B2 uniquement (pas zone C)",
    ],
    {
      type: "tva_reduite_+_exo_tf",
      mecanisme: "TVA réduite à 10% (au lieu de 20%) à l'achat + exonération de taxe foncière 20 ans",
      pas_de_reduction_ir_directe: true,
    },
    "Avantage à l'achat (TVA -10pts ≈ 8% du prix net) + cash-flow protégé (TF=0 pendant 20 ans). Pas d'amortissement comme Jeanbrun.",
    false,
  );

  const buildLocAvantages = (niveau: "intermediaire" | "social" | "tres_social"): Scenario => {
    const reduction = LOC_AVANTAGES_REDUCTION_PCT[niveau];
    return buildPlafondScenario(
      `loc_avantages_${niveau}`,
      `Loc'Avantages niveau ${niveau.replace("_", " ")}`,
      `loc_avantages_${niveau}`,
      [
        "Ancien rénové ou neuf",
        "Maisons ou appartements éligibles",
        "Conventionnement Anah",
        "Engagement location 6 ans minimum",
        `Réduction d'IR de ${reduction}% sur le loyer brut annuel`,
      ],
      {
        type: "reduction_ir",
        mecanisme: `Réduction d'IR de ${reduction}% du loyer brut annuel`,
        cumulable_deficit_foncier: true,
      },
      "Adapté à l'ancien rénové. Moins technique que Jeanbrun, calcul plus simple. Bon pour TMI 30%.",
      false,
      reduction,
    );
  };

  // ── 5. Réponse ───────────────────────────────────────────────────────
  return NextResponse.json({
    address: addressPayload,
    code_commune: resolvedCommune,
    zone_abc: zone,
    surface_m2: surface,
    prix_achat: prixAchat,
    tmi: tmi,
    marche_libre: {
      loyer_m2_median: loyerMarcheM2,
      source: marche?.loyer_source ?? null,
      quality: marche?.loyer_quality ?? null,
      annee: marche?.loyer_annee ?? null,
    },
    scenarios: {
      libre: scenarioLibre,
      jeanbrun_intermediaire: scenarioJeanbrunInt,
      jeanbrun_social: scenarioJeanbrunSoc,
      jeanbrun_tres_social: scenarioJeanbrunVS,
      lli: scenarioLLI,
      loc_avantages_intermediaire: buildLocAvantages("intermediaire"),
      loc_avantages_social: buildLocAvantages("social"),
      loc_avantages_tres_social: buildLocAvantages("tres_social"),
    },
    llm_guidance: {
      ordre_presentation:
        "Pour une question d'investissement locatif, présenter les 2 GRANDES catégories : (1) location LIBRE sans dispositif (rendement brut max, fiscalité barème IR pleine), (2) dispositifs fiscaux SOUS CONDITIONS (Jeanbrun/LLI = neuf ou rénovation lourde ; Loc'Avantages = conventionnement Anah ancien rénové). Comparer cash-flow net après impôt selon TMI.",
      regle_tmi: {
        tmi_11: "Privilégier libre — Jeanbrun/LLI peu utile car amortissement efface peu d'IR",
        tmi_30: "Marginal — calculer cash-flow net après impôt pour décider",
        tmi_41: "Jeanbrun intermédiaire ou LLI deviennent très intéressants",
        tmi_45: "Maximum d'avantage Jeanbrun, surtout si horizon ≥ 15 ans",
      },
      surface_warning:
        "Si la surface demandée s'écarte fortement de la médiane de la zone, appliquer une décote (grandes surfaces) ou prime (petites surfaces) au prix au m².",
      revente_warning:
        "Pour Jeanbrun et LMNP au réel, l'amortissement est réintégré dans la plus-value à la revente. Conseil : horizon ≥ 15 ans, idéalement jusqu'à l'exonération PV à 22 ans.",
    },
    geocode_meta: geocodeMeta,
  });
}

export const GET = withApiKey(handleRentalStrategies, {
  endpoint: "/api/rental-strategies",
});
