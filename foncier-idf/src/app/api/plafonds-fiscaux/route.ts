/**
 * GET /api/plafonds-fiscaux?address=...&surface=62&pieces=3
 *   ou
 * GET /api/plafonds-fiscaux?code_insee=93029&surface=62&pieces=3
 *
 * Renvoie pour une adresse :
 *   - Zone A/B/C
 *   - Éligibilité ACV / Denormandie / ORT / Loc'Avantages / LLI
 *   - Plafonds de loyer 2025 pour chaque dispositif applicable
 *   - Calcul loyer LLI max pour ce logement précis (si surface fournie) :
 *     formule Art. 2 terdecies D CGI : LMZONE × (0.7 + 19/surface_utile)
 *   - Écart % entre plafond LLI et loyer de marché (si fact_rendement dispo)
 *
 * Pinel = clos au 31/12/2024, jamais renvoyé comme applicable.
 */

import { NextRequest, NextResponse } from "next/server";

import { geocodeAddress, type GeocodeMeta } from "@/lib/geocode";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const CURRENT_YEAR = 2025;

type ZoneAbc = "Abis" | "A" | "B1" | "B2" | "C";

function bucketFromPieces(pieces: number | null): "T1-T2" | "T3+" | "all" {
  if (pieces == null || !Number.isFinite(pieces)) return "all";
  if (pieces <= 2) return "T1-T2";
  return "T3+";
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const address = sp.get("address")?.trim();
  const codeCommune = sp.get("code_commune")?.trim();
  const surfaceRaw = sp.get("surface");
  const surface = surfaceRaw ? Number(surfaceRaw) : null;
  const piecesRaw = sp.get("pieces");
  const pieces = piecesRaw ? Number(piecesRaw) : null;

  if (!address && !codeCommune) {
    return NextResponse.json(
      { error: "Paramètre 'address' OU 'code_commune' requis" },
      { status: 400 },
    );
  }
  if (surface !== null && (!Number.isFinite(surface) || surface <= 0)) {
    return NextResponse.json(
      { error: "Paramètre 'surface' invalide" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();

  // ── 1. Résolution commune ──────────────────────────────────────────
  let resolvedCommune: string;
  let addressPayload: Record<string, unknown> | null = null;
  let geocodeMeta: GeocodeMeta | null = null;

  if (address) {
    let geocode;
    try {
      geocode = await geocodeAddress(address, supabase);
    } catch (err) {
      console.error("[/api/plafonds-fiscaux] geocoding failed:", err);
      return NextResponse.json(
        { error: "Service de géocodage indisponible" },
        { status: 503 },
      );
    }
    const top = geocode.results[0];
    if (!top) {
      return NextResponse.json(
        { error: "Adresse introuvable" },
        { status: 404 },
      );
    }
    geocodeMeta = geocode.meta;
    resolvedCommune = top.code_insee;
    addressPayload = {
      label: top.label,
      lat: top.lat,
      lon: top.lon,
      code_insee: top.code_insee,
      postcode: top.postcode,
      city: top.city,
    };
  } else {
    resolvedCommune = codeCommune!;
  }

  // ── 2. Lookups en parallèle ────────────────────────────────────────
  const [zoneRes, eligRes] = await Promise.all([
    supabase
      .from("dim_zonage_abc")
      .select("zone")
      .eq("code_insee", resolvedCommune)
      .order("annee", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("dim_commune_eligibilite")
      .select("programme, annee")
      .eq("code_insee", resolvedCommune)
      .eq("annee", CURRENT_YEAR),
  ]);

  const zone = (zoneRes.data?.zone as ZoneAbc | undefined) ?? null;
  if (!zone) {
    return NextResponse.json(
      {
        error: "Zone A/B/C non disponible pour cette commune",
        code_commune: resolvedCommune,
        hint: "Vérifier que dim_zonage_abc est populée (cf. pipeline_plafonds.py)",
        address: addressPayload,
      },
      { status: 404 },
    );
  }

  const programmes = new Set<string>(
    (eligRes.data ?? []).map((r) => r.programme as string),
  );
  const acv = programmes.has("acv");
  const denormandieEligible =
    programmes.has("denormandie") || programmes.has("ort") || acv;

  // ── 3. Plafonds de loyer (toutes lignes pour cette zone, année courante)
  const { data: plafondsRows } = await supabase
    .from("dim_plafond_loyer")
    .select("dispositif, loyer_max_m2, source_juridique")
    .eq("zone", zone)
    .eq("annee", CURRENT_YEAR);

  const plafonds = new Map<string, { loyer_max_m2: number; source: string | null }>();
  for (const row of plafondsRows ?? []) {
    plafonds.set(row.dispositif as string, {
      loyer_max_m2: Number(row.loyer_max_m2),
      source: (row.source_juridique as string | null) ?? null,
    });
  }

  // ── 4. Loyer de marché (depuis fact_rendement) pour l'écart % ─────
  type MarcheRow = {
    loyer_m2_median: number | null;
    loyer_source: string | null;
    loyer_quality: string | null;
  };
  const bucket = bucketFromPieces(pieces);
  let marcheData: MarcheRow | null = null;
  try {
    const res = await supabase
      .from("fact_rendement")
      .select("loyer_m2_median, loyer_source, loyer_quality")
      .eq("code_commune", resolvedCommune)
      .eq("type_local", "Appartement")
      .in("nb_pieces_bucket", [bucket, "all"])
      .order("nb_pieces_bucket", { ascending: false })  // bucket précis d'abord
      .limit(1)
      .maybeSingle();
    if (res.data) {
      marcheData = res.data as unknown as MarcheRow;
    }
  } catch (err) {
    console.warn("[plafonds] fact_rendement lookup failed:", err);
  }

  const loyerMarche =
    marcheData && marcheData.loyer_m2_median != null
      ? Number(marcheData.loyer_m2_median)
      : null;

  // ── 5. Construction réponse ───────────────────────────────────────
  const lli = plafonds.get("lli") ?? null;
  const locInt = plafonds.get("loc_avantages_intermediaire") ?? null;
  const locSoc = plafonds.get("loc_avantages_social") ?? null;
  const locVS = plafonds.get("loc_avantages_tres_social") ?? null;
  const deno = plafonds.get("denormandie") ?? null;
  const jeanInt = plafonds.get("jeanbrun_intermediaire") ?? null;
  const jeanSoc = plafonds.get("jeanbrun_social") ?? null;
  const jeanVS = plafonds.get("jeanbrun_tres_social") ?? null;

  const lliApplicable = lli !== null && zone !== "C";
  // Jeanbrun couvre toutes les zones y compris C (contrairement à Pinel/LLI)
  const jeanbrunApplicable = jeanInt !== null;

  let calculLLI = null;
  if (lliApplicable && surface && lli) {
    const loyerM2Logement = round2(lli.loyer_max_m2 * (0.7 + 19 / surface));
    calculLLI = {
      surface_utile_m2: surface,
      loyer_m2_max_pour_ce_logement: loyerM2Logement,
      loyer_mensuel_max_eur: Math.round(loyerM2Logement * surface),
      formule: "LMZONE × (0.7 + 19 / surface_utile)",
      source_juridique: lli.source ?? "Art. 2 terdecies D annexe III CGI",
    };
  }

  // Jeanbrun a une formule légèrement différente : le coefficient est plafonné à 1.2
  // (vs sans cap pour LLI). Cf. arrêté du 6 janvier 2026.
  let calculJeanbrun = null;
  if (jeanbrunApplicable && surface && jeanInt) {
    const coeff = Math.min(0.7 + 19 / surface, 1.2);
    const buildLevel = (
      row: { loyer_max_m2: number; source: string | null } | null,
    ) =>
      row == null
        ? null
        : {
            loyer_m2_zone: row.loyer_max_m2,
            loyer_m2_max_pour_ce_logement: round2(row.loyer_max_m2 * coeff),
            loyer_mensuel_max_eur: Math.round(row.loyer_max_m2 * coeff * surface),
          };
    calculJeanbrun = {
      surface_utile_m2: surface,
      coefficient: round2(coeff),
      formule: "LMZONE × min(0.7 + 19 / surface_utile ; 1.2)",
      source_juridique: jeanInt.source ?? "Arrêté du 6 janvier 2026",
      intermediaire: buildLevel(jeanInt),
      social: buildLevel(jeanSoc),
      tres_social: buildLevel(jeanVS),
    };
  }

  const ecartMarchePct =
    lliApplicable && lli && loyerMarche
      ? round1(((lli.loyer_max_m2 - loyerMarche) / loyerMarche) * 100)
      : null;

  return NextResponse.json({
    zone_abc: zone,
    annee_reference: CURRENT_YEAR,
    eligibilites: {
      jeanbrun: jeanbrunApplicable,             // toutes zones France
      lli: lliApplicable,
      loc_avantages: locInt !== null,           // toutes zones
      denormandie: denormandieEligible && deno !== null,
      acv,
      ort: programmes.has("ort"),
      pinel: false,                             // dispositif clos 31/12/2024
    },
    plafonds_loyer_m2: {
      jeanbrun_intermediaire: jeanInt?.loyer_max_m2 ?? null,
      jeanbrun_social: jeanSoc?.loyer_max_m2 ?? null,
      jeanbrun_tres_social: jeanVS?.loyer_max_m2 ?? null,
      lli: lli?.loyer_max_m2 ?? null,
      loc_avantages_intermediaire: locInt?.loyer_max_m2 ?? null,
      loc_avantages_social: locSoc?.loyer_max_m2 ?? null,
      loc_avantages_tres_social: locVS?.loyer_max_m2 ?? null,
      denormandie: denormandieEligible ? (deno?.loyer_max_m2 ?? null) : null,
    },
    calcul_jeanbrun_pour_logement: calculJeanbrun,
    calcul_lli_pour_logement: calculLLI,
    marche: loyerMarche
      ? {
          loyer_m2_median: loyerMarche,
          source: marcheData?.loyer_source ?? null,
          quality: marcheData?.loyer_quality ?? null,
        }
      : null,
    ecart_lli_vs_marche_pct: ecartMarchePct,
    notes: {
      pinel: "Dispositif clos depuis le 31/12/2024 — non éligible aux nouvelles opérations",
      jeanbrun:
        "Successeur du Pinel depuis 2025. Réduction d'IR -30 à -45% sur 9 ans. " +
        "Couvre toute la France métropolitaine + DOM. 3 niveaux de loyer (intermédiaire/social/très social).",
    },
    address: addressPayload,
    geocode_meta: geocodeMeta,
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
