/**
 * POST /api/cabinets/{slug}/lead
 *
 * Capture finale d'un lead sur la page white-label /cabinets/{slug}/estimer.
 * Appelé par EstimWizard à la dernière étape (formulaire nom/email/téléphone).
 *
 * Pipeline :
 *   1. Valide l'identité visiteur + consentement RGPD
 *   2. Insère dans dim_cabinet_leads (Stripe billing material)
 *   3. Génère un PDF brandé cabinet via CabinetLeadReportPDF
 *   4. Envoie 2 emails Resend non-bloquants :
 *      - Au visiteur : confirmation + PDF rapport joint
 *      - Au cabinet  : notification lead + PDF rapport joint
 *   5. Renvoie { ok, lead_id, cta_url } pour rediriger côté client
 *
 * Le PDF est rendu en mémoire (renderToBuffer) puis encodé en base64 pour
 * Resend. Coût Vercel : ~300-500ms / lead, ~5 Mo RAM pic.
 */

import { NextRequest, NextResponse } from "next/server";
import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createHash } from "crypto";
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

import {
  CabinetLeadReportPDF,
  type CabinetLeadReportData,
} from "@/lib/pdf/cabinet-lead-report";
import { geocodeAddress } from "@/lib/geocode";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { getTransports } from "@/lib/datasets/transports";
import { getEcoles } from "@/lib/datasets/ecoles";
import { getServices } from "@/lib/datasets/services";
import { getInseeIris } from "@/lib/datasets/insee";
import { getClusterPriceEvolution } from "@/lib/datasets/cluster-price-evolution";
import { getCommunePriceEvolution } from "@/lib/datasets/commune-price-evolution";
import {
  getCommunePriceCeiling,
  capEstimationsByCommuneCeiling,
} from "@/lib/datasets/commune-price-ceiling";
import {
  getSurfaceBucketAdjustment,
  applySurfaceAdjustment,
} from "@/lib/datasets/surface-bucket-adjustment";
import { getProximiteLocale } from "@/lib/datasets/proximite-locale";
import { getLyceesBac } from "@/lib/datasets/lycees-bac";
import { getLyceesPro } from "@/lib/datasets/lycees-pro";
import { getEtablissementsSup } from "@/lib/datasets/etablissements-sup";
import { getEcolesSanteFiness } from "@/lib/datasets/ecoles-sante-finess";
import { getPointsInteret } from "@/lib/datasets/points-interet";
import {
  findNearbyGrandsProjets,
  type GrandProjetRow,
} from "@/lib/datasets/grands-projets";
import { computeParisDistance } from "@/lib/paris-distance";

// ──────────────────────────────────────────────────────────────────────────────
// Supabase (service_role : on insère + on lit le branding cabinet)
// ──────────────────────────────────────────────────────────────────────────────

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Validation entrée
// ──────────────────────────────────────────────────────────────────────────────

type LeadBody = {
  visitor_name?: string;
  visitor_email?: string;
  visitor_phone?: string;
  consentement?: boolean;

  // Snapshot complet du wizard (issu de l'état EstimWizard)
  wizard_answers?: Record<string, unknown>;

  // Résultat de l'estimation déjà calculée côté client
  estimation?: {
    address?: string;
    prix_m2_median?: number | null;
    prix_m2_p10?: number | null;
    prix_m2_p90?: number | null;
    prix_total_median?: number | null;
    nb_ventes?: number | null;
  };
};

function s(v: unknown, max = 200): string {
  return String(v ?? "").trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ──────────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  const { slug: rawSlug } = await ctx.params;
  const slug = rawSlug.toLowerCase();

  let body: LeadBody;
  try {
    body = (await req.json()) as LeadBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // 1) Validation
  const visitor_name = s(body.visitor_name, 120);
  const visitor_email = s(body.visitor_email, 160).toLowerCase();
  const visitor_phone = s(body.visitor_phone, 40);
  const consentement = body.consentement === true;
  const wizard = (body.wizard_answers ?? {}) as Record<string, unknown>;
  const estim = body.estimation ?? {};

  // Helper pour lire les réponses du wizard en string safe (évite les erreurs
  // d'interpolation TS sur unknown dans les template literals des emails HTML)
  const w = (key: string): string => {
    const v = wizard[key];
    if (v == null) return "";
    if (Array.isArray(v)) return v.map(String).join(", ");
    return String(v);
  };

  if (visitor_name.length < 2) {
    return NextResponse.json({ error: "name_required" }, { status: 400 });
  }
  if (!EMAIL_RE.test(visitor_email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  if (!consentement) {
    return NextResponse.json({ error: "consent_required" }, { status: 400 });
  }
  const address = s(wizard.address, 240) || s(estim.address, 240);
  if (address.length < 5) {
    return NextResponse.json({ error: "address_required" }, { status: 400 });
  }

  // 2) Récupère le cabinet (branding + email destinataire)
  const sb = getSupabase();
  const { data: cabinet, error: cabErr } = await sb
    .from("dim_cabinets_white_label")
    .select(
      "slug, cabinet_name, primary_color, secondary_color, contact_email, legal_mention, cta_contact_url, cta_contact_label",
    )
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (cabErr || !cabinet) {
    return NextResponse.json({ error: "cabinet_not_found" }, { status: 404 });
  }

  // 3) Insertion du lead
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ip_hash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
  const user_agent = req.headers.get("user-agent")?.slice(0, 400) ?? null;

  const surface = Number(wizard.surface);
  const type_bien = s(wizard.type_bien, 60) || "Appartement";
  const intent = s(wizard.intent, 30) || null;

  // Insertion lead avec les valeurs ESTIM BRUTES (sans capping) — on garde
  // la trace de ce que l'estimateur a sorti pour le suivi. Le capping
  // s'applique uniquement à l'affichage PDF / email (cf. cappedEstim).
  const insertPayload = {
    cabinet_slug: slug,
    visitor_name,
    visitor_email,
    visitor_phone: visitor_phone || null,
    consentement,
    intent,
    type_bien,
    address,
    surface: Number.isFinite(surface) && surface > 0 ? surface : null,
    wizard_answers: wizard,
    prix_m2_median: estim.prix_m2_median ?? null,
    prix_m2_p10: estim.prix_m2_p10 ?? null,
    prix_m2_p90: estim.prix_m2_p90 ?? null,
    prix_total_median: estim.prix_total_median ?? null,
    nb_ventes: estim.nb_ventes ?? null,
    ip_hash,
    user_agent,
  };

  const { data: inserted, error: insErr } = await sb
    .from("dim_cabinet_leads")
    .insert(insertPayload)
    .select("id")
    .single();

  if (insErr || !inserted) {
    console.error("[/api/cabinets/lead] insert error:", insErr);
    return NextResponse.json({ error: "db_insert_failed" }, { status: 500 });
  }

  const leadId = (inserted as { id: string }).id;

  // 4) ENRICHISSEMENT — géocodage + datasets opensource en parallèle
  //
  // Pour faire un rapport "Immo Data killer" on agrège tout ce que le cabinet
  // n'aurait pas spontanément sous la main : transports, écoles, services
  // quotidien, INSEE socio-démo, distance Paris si IDF.
  //
  // Tout en parallèle pour limiter la latence (~1-2s total même avec 5 fetches).
  // Tous les .catch(() => null) → le PDF se contente de ce qu'on a, jamais bloquant.
  const sbServer = getSupabaseServerClient();
  const geo = await geocodeAddress(address, sbServer).catch(() => null);
  const top = geo?.results[0];

  // Rayon transports ADAPTATIF selon la zone géographique. Différences :
  //   - Paris intra-muros (dept 75) : 500 m → 50+ arrêts dans 800 m, on noie
  //     le lecteur. 500 m garde l'essentiel (3-4 stations majeures).
  //   - Petite couronne IDF (92/93/94) : 900 m → banlieue dense, capture la
  //     gare RER de banlieue (souvent à 700-900 m du centre quartier).
  //     Capture la gare de Drancy à 900 m (test).
  //   - Grande couronne IDF (77/78/91/95) : 1200 m → moins dense, capture
  //     la gare Transilien parfois à 1 km.
  //   - Province / autres : 1500 m → les gares de villes moyennes (50-200 k
  //     habitants) sont en centre, à 1-2 km d'un quartier périphérique.
  //
  // Pour les équipements de proximité (sport/écoles), même barème.
  function detectZoneRadius(code_insee: string | undefined): {
    transports: number;
    equipements: number;
  } {
    if (!code_insee) return { transports: 1500, equipements: 1500 };
    if (code_insee.startsWith("75"))
      return { transports: 500, equipements: 1000 };
    if (/^(92|93|94)/.test(code_insee))
      return { transports: 900, equipements: 1200 };
    if (/^(77|78|91|95)/.test(code_insee))
      return { transports: 1200, equipements: 1500 };
    return { transports: 1500, equipements: 1500 };
  }

  const zoneRadius = top
    ? detectZoneRadius(top.code_insee)
    : { transports: 1500, equipements: 1500 };
  const transportsRadius = zoneRadius.transports;
  const equipementsRadius = zoneRadius.equipements;

  const [
    transports,
    transportsLarge,
    ecoles,
    services,
    inseeIris,
    priceEvolution,
    communePriceEvolution,
    communePriceCeiling,
    surfaceAdjustment,
    lyceesBac,
    lyceesPro,
    etablissementsSup,
    ecolesSanteFiness,
    pointsInteret,
    proximiteLocale,
    grandsProjets,
  ] = top
    ? await Promise.all([
        getTransports(top.lat, top.lon, { radiusM: transportsRadius }).catch(() => null),
        // Limite à 200 : en IDF dense (Pantin, Saint-Denis, etc.) le rayon 5km
        // contient 100+ arrêts de bus. Sans cette limite élevée, la gare RER
        // pourrait être hors top 30 (filtrée par distance avant qu'on trie
        // par priorité RER>train>métro).
        getTransports(top.lat, top.lon, { radiusM: 5000, limit: 200 }).catch(() => null),
        getEcoles(top.lat, top.lon).catch(() => null),
        getServices(top.lat, top.lon).catch(() => null),
        getInseeIris(top.lat, top.lon).catch(() => null),
        // Évolution prix m² au niveau MICRO-MARCHÉ (cluster HDBSCAN) — plus
        // précis que commune-level. Filtre les ventes DVF dans le polygon
        // hull du cluster matchant l'adresse + agrège par année.
        ["Appartement", "Maison"].includes(type_bien)
          ? getClusterPriceEvolution({
              lat: top.lat,
              lon: top.lon,
              code_commune: top.code_insee,
              type_local: type_bien,
              years_back: 8,
            }).catch(() => null)
          : Promise.resolve(null),
        // Évolution prix m² au niveau COMMUNE / arrondissement : sert de
        // RÉFÉRENCE comparative au cluster micro-marché. Permet d'afficher
        // 2 courbes superposées dans le PDF — l'utilisateur voit si son
        // micro-marché surperforme ou sous-performe la commune entière.
        ["Appartement", "Maison"].includes(type_bien)
          ? getCommunePriceEvolution({
              lat: top.lat,
              lon: top.lon,
              code_commune: top.code_insee,
              type_local: type_bien,
              years_back: 8,
            }).catch(() => null)
          : Promise.resolve(null),
        // Plafond de prix RÉALISTE de la commune par bucket de surface :
        // sert à capper les estimations P90 trop optimistes du cluster
        // HDBSCAN qui hérite des petites surfaces (€/m² toujours plus haut).
        // Sans capping : 429 k€ pour un 62m² Drancy → faux espoir vendeur.
        ["Appartement", "Maison"].includes(type_bien) &&
        Number.isFinite(surface) &&
        surface > 0
          ? getCommunePriceCeiling({
              lat: top.lat,
              lon: top.lon,
              code_commune: top.code_insee,
              type_local: type_bien,
              surface_m2: surface,
              years_back: 5,
            }).catch(() => null)
          : Promise.resolve(null),
        // Ajustement bucket de surface (Fix #1) : si le voisinage est
        // dominé par T2 (~30-45 m²) et qu'on estime un T3 (62 m²), on
        // applique le ratio commune T2 → T3 (~0,88 à Drancy) pour
        // recalibrer le €/m² hérité du cluster.
        ["Appartement", "Maison"].includes(type_bien) &&
        Number.isFinite(surface) &&
        surface > 0
          ? getSurfaceBucketAdjustment({
              lat: top.lat,
              lon: top.lon,
              code_commune: top.code_insee,
              type_local: type_bien,
              surface_m2: surface,
              years_back: 5,
            }).catch(() => null)
          : Promise.resolve(null),
        getLyceesBac(top.lat, top.lon).catch(() => null),
        // Lycées d'enseignement PROFESSIONNEL (bac pro). Complète le dataset GT
        // qui ne couvre que général + techno. Mention "85 % de réussite Bac pro"
        // = argument concret pour vendeur en zone industrielle/banlieue.
        getLyceesPro(top.lat, top.lon).catch(() => null),
        // Enseignement SUPÉRIEUR (universités, grandes écoles, IUT, IEP).
        // Rayon 10 km : étudiant accepte 30 min de trajet. Source ESR.
        getEtablissementsSup(top.lat, top.lon).catch(() => null),
        // Écoles paramédicales FINESS : IFSI privés, kiné, ortho, sage-femme…
        // Complète l'ESR qui ne contient que les établissements universitaires.
        getEcolesSanteFiness(top.lat, top.lon).catch(() => null),
        // Top 2 points d'intérêts notables (Overpass + filtre wikipedia=*).
        // Sert à enrichir la phrase argumentaire "proche de … comme la
        // Place des Vosges et le Centre Pompidou".
        getPointsInteret(top.lat, top.lon).catch(() => null),
        // Équipements LOCAUX (Fix #3) : sport, écoles, collèges — sans
        // filtre wikipedia=*. Complète les POI notables avec ce qui pèse
        // dans la décision d'une famille au quotidien (école adjacente,
        // stade, piscine). Rayon adaptatif selon zone (1000 m Paris,
        // 1200 m petite couronne, 1500 m grande couronne + province).
        getProximiteLocale(top.lat, top.lon, equipementsRadius).catch(() => null),
        // KILLER FEATURE forward-looking : grands projets d'infrastructure
        // à proximité (Grand Paris Express, LGV, canaux, ZAC, gigafactories)
        // avec anticipation prix +5 à +30%. Différenciateur vs PriceHubble.
        findNearbyGrandsProjets(top.lat, top.lon, 5000, 5).catch(
          () => [] as GrandProjetRow[],
        ),
      ])
    : [null, null, null, null, null, null, null, null, null, null, null, null, [] as GrandProjetRow[]];

  // Distance + temps trajet Paris.
  // computeParisDistance est async : il interroge d'abord dim_gares (source
  // officielle SNCF+IDFM), avec fallback sur les stops OSM élargis si la DB
  // n'est pas encore peuplée par pipeline_gares_idf.py.
  const parisDistance = top
    ? await computeParisDistance(
        top.lat,
        top.lon,
        top.code_insee,
        transportsLarge?.stops ?? transports?.stops,
      )
    : null;

  // FALLBACK transports : si Overpass a échoué (rate limit, timeout),
  // on essaie 2 fallbacks successifs :
  //   1. paris_distance.nearest_major_station (dim_gares Supabase)
  //   2. 1re section transit de journey_to_paris (IDFM PRIM Navitia)
  // Bien meilleur que d'afficher "0 arrêts" qui ruine la crédibilité.
  if (transports && transports.stops.length === 0) {
    const fallbacks: typeof transports.stops = [];
    if (parisDistance?.nearest_major_station) {
      const g = parisDistance.nearest_major_station;
      fallbacks.push({
        osm_id: 0,
        nom: g.nom,
        type: g.type,
        reseau: g.reseau ?? null,
        ligne: g.ligne ?? null,
        lat: 0,
        lon: 0,
        distance_m: g.distance_m,
        walk_minutes: g.walk_minutes,
      });
    }
    // Fallback PRIM : on parse les sections transit (RER B Drancy, etc.)
    if (parisDistance?.journey_to_paris) {
      const transitSections = parisDistance.journey_to_paris.sections.filter(
        (s) => s.type === "transit" && s.from,
      );
      for (const s of transitSections.slice(0, 3)) {
        const nom = s.from ?? "Station";
        // Évite duplicate avec dim_gares fallback
        if (fallbacks.some((f) => f.nom.toLowerCase() === nom.toLowerCase()))
          continue;
        // Heuristique distance : si on a déjà nearest_major_station, on
        // suppose même distance (les stations PRIM sont alignées avec
        // dim_gares). Sinon distance estimée à 600m (banlieue moyenne).
        const distM =
          parisDistance.nearest_major_station?.distance_m ?? 600;
        fallbacks.push({
          osm_id: 0,
          nom,
          type: s.line?.toLowerCase().startsWith("rer") ? "rer" : "train",
          reseau: null,
          ligne: s.line ?? null,
          lat: 0,
          lon: 0,
          distance_m: distM,
          walk_minutes: Math.round(distM / 80),
        });
      }
    }
    if (fallbacks.length > 0) {
      transports.stops = fallbacks;
      transports.count = fallbacks.length;
      transports.par_type = fallbacks.reduce(
        (acc, s) => {
          acc[s.type] = (acc[s.type] ?? 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );
    }
  }

  // Extraction des GARES À PROXIMITÉ depuis transportsLarge (rayon 5 km
  // déjà fetché). Rayon adaptatif selon zone :
  //   - Paris intra-muros : 1000 m (les gares y sont denses)
  //   - Petite couronne IDF : 1500 m (capture Drancy à 900 m + voisines)
  //   - Grande couronne IDF : 2000 m (la gare Transilien est souvent à 1-2 km)
  //   - Province : 2500 m (norme province : gare centre-ville à 1-2 km
  //     du quartier périphérique)
  function detectGareRadius(code_insee: string | undefined): number {
    if (!code_insee) return 2500;
    if (code_insee.startsWith("75")) return 1000;
    if (/^(92|93|94)/.test(code_insee)) return 1500;
    if (/^(77|78|91|95)/.test(code_insee)) return 2000;
    return 2500;
  }
  const gareRadius = top ? detectGareRadius(top.code_insee) : 2500;
  let garesProches: Array<{
    nom: string;
    type: string;
    ligne: string | null;
    distance_m: number;
    walk_minutes: number;
  }> = [];
  if (transportsLarge && transportsLarge.stops) {
    garesProches = transportsLarge.stops
      .filter((s) => {
        const t = (s.type ?? "").toLowerCase();
        return (
          (t === "rer" ||
            t === "train" ||
            t === "metro" ||
            t === "tramway" ||
            t === "tram") &&
          s.distance_m <= gareRadius
        );
      })
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, 4)
      .map((s) => ({
        nom: s.nom,
        type: s.type,
        ligne: s.ligne,
        distance_m: s.distance_m,
        walk_minutes: s.walk_minutes,
      }));
  }
  // Fallback : si Overpass transportsLarge est aussi vide, on injecte
  // les gares depuis paris-distance (dim_gares ou PRIM Navitia).
  if (garesProches.length === 0 && parisDistance) {
    if (parisDistance.nearest_major_station) {
      const g = parisDistance.nearest_major_station;
      garesProches.push({
        nom: g.nom,
        type: g.type,
        ligne: g.ligne ?? null,
        distance_m: g.distance_m,
        walk_minutes: g.walk_minutes,
      });
    }
    // Fallback supplémentaire : extraction des sections transit PRIM
    if (parisDistance.journey_to_paris) {
      const transitSections = parisDistance.journey_to_paris.sections.filter(
        (s) => s.type === "transit" && s.from,
      );
      for (const s of transitSections.slice(0, 3)) {
        const nom = s.from ?? "Station";
        if (
          garesProches.some((g) => g.nom.toLowerCase() === nom.toLowerCase())
        )
          continue;
        const lineLower = (s.line ?? "").toLowerCase();
        const type = lineLower.startsWith("rer")
          ? "rer"
          : lineLower.startsWith("m") && lineLower.length <= 4
            ? "metro"
            : "train";
        const distM =
          parisDistance.nearest_major_station?.distance_m ?? 600;
        garesProches.push({
          nom,
          type,
          ligne: s.line ?? null,
          distance_m: distM,
          walk_minutes: Math.round(distM / 80),
        });
      }
    }
  }

  // 5a) Ajustement par bucket de surface (Fix #1)
  // Si le voisinage est dominé par un bucket différent du bien à estimer,
  // on recalibre le €/m² via le ratio commune entre les 2 buckets.
  // Ex : voisinage T2 (5 500 €/m²) × ratio commune T2→T3 (0,88) → 4 840 €/m²
  // pour un 62 m². Applique aux P10/Médiane/P90 uniformément.
  const adjustedEstim = applySurfaceAdjustment({
    prix_m2_p10: estim.prix_m2_p10 ?? null,
    prix_m2_median: estim.prix_m2_median ?? null,
    prix_m2_p90: estim.prix_m2_p90 ?? null,
    adjustment: surfaceAdjustment,
  });

  // 5b) Capping des estimations P90 par le plafond commune (Fix #2)
  // Appliqué APRÈS l'ajustement de surface : si malgré la recalibration,
  // le P90 dépasse encore le P95 commune, on cape.
  const cappedEstim = capEstimationsByCommuneCeiling({
    prix_m2_p10: adjustedEstim.prix_m2_p10,
    prix_m2_median: adjustedEstim.prix_m2_median,
    prix_m2_p90: adjustedEstim.prix_m2_p90,
    surface_m2: insertPayload.surface ?? 0,
    ceiling: communePriceCeiling,
  });

  // 5c) GARDE-FOU ABSOLU : P90 ≤ 1,5 × médiane (parité avec /api/estimate)
  // Sécurité si le helper de capping échoue silencieusement.
  if (
    cappedEstim.prix_m2_p90 != null &&
    cappedEstim.prix_m2_median != null &&
    cappedEstim.prix_m2_median > 0
  ) {
    const ratio = cappedEstim.prix_m2_p90 / cappedEstim.prix_m2_median;
    if (ratio > 1.5) {
      const newP90 = Math.round(cappedEstim.prix_m2_median * 1.5);
      cappedEstim.prix_m2_p90 = newP90;
      cappedEstim.prix_total_p90 =
        insertPayload.surface != null && insertPayload.surface > 0
          ? Math.round(newP90 * insertPayload.surface)
          : null;
      cappedEstim.capped = true;
    }
  }

  // 6) Génération PDF
  const pdfData: CabinetLeadReportData = {
    cabinet_name: cabinet.cabinet_name,
    cabinet_legal: cabinet.legal_mention ?? null,
    primary_color: cabinet.primary_color ?? "#1f3a8a",
    secondary_color: cabinet.secondary_color ?? null,
    visitor_name,
    visitor_email,
    address: top?.label ?? address,
    type_bien,
    surface: insertPayload.surface,
    // Valeurs CAPPÉES par le plafond commune (Fix #2) — le P90 est ramené
    // au P95 commune si dépassement. La médiane reste inchangée sauf cas
    // marginal où elle dépassait le P95 commune (improbable).
    prix_m2_median: cappedEstim.prix_m2_median,
    prix_m2_p10: cappedEstim.prix_m2_p10,
    prix_m2_p90: cappedEstim.prix_m2_p90,
    prix_total_median: cappedEstim.prix_total_median,
    nb_ventes: estim.nb_ventes ?? null,
    // Métadonnées capping pour affichage transparent dans le PDF
    capped_to_commune_ceiling: cappedEstim.capped,
    commune_ceiling: communePriceCeiling && communePriceCeiling.available
      ? {
          bucket: communePriceCeiling.bucket,
          prix_m2_p95: communePriceCeiling.prix_m2_p95,
          prix_total_p95: communePriceCeiling.prix_total_p95,
          nb_ventes_bucket: communePriceCeiling.nb_ventes_bucket,
          confiance: communePriceCeiling.confiance,
        }
      : null,
    // Métadonnées ajustement de bucket de surface (Fix #1)
    // Note : surfaceAdjustment.bucket_dominant peut être null si pas assez
    // de données voisinage, mais dans ce cas applied est nécessairement false
    // (applySurfaceAdjustment skip aussi sur confiance low/none). On le
    // re-narrowe explicitement pour rassurer TS.
    surface_adjustment:
      adjustedEstim.applied &&
      surfaceAdjustment &&
      surfaceAdjustment.bucket_dominant != null
        ? {
            bucket_dominant: surfaceAdjustment.bucket_dominant,
            bucket_cible: surfaceAdjustment.bucket_cible,
            pct_ajustement: adjustedEstim.pct,
            ratio: adjustedEstim.ratio,
            nb_ventes_voisinage: surfaceAdjustment.nb_ventes_voisinage,
            confiance: surfaceAdjustment.confiance,
          }
        : null,
    // Fix #3 — Équipements LOCAUX (sport + écoles)
    // Le helper sépare déjà sport et scolaire à la classification ;
    // les casts explicites rassurent TypeScript sur les unions strictes.
    proximite_locale: proximiteLocale && proximiteLocale.available
      ? {
          sport: proximiteLocale.sport.map((e) => ({
            nom: e.nom,
            type: e.type as
              | "stade"
              | "complexe_sportif"
              | "piscine"
              | "terrain"
              | "fitness",
            distance_m: e.distance_m,
            proximite: e.proximite,
          })),
          scolaire: proximiteLocale.scolaire.map((e) => ({
            nom: e.nom,
            type: e.type as "maternelle" | "ecole" | "college",
            distance_m: e.distance_m,
            proximite: e.proximite,
          })),
        }
      : null,
    // Gares proches < 1500m (fix bonus : capture Drancy à 900m)
    gares_proches: garesProches.map((s) => ({
      nom: s.nom,
      type: s.type,
      distance_m: s.distance_m,
      walk_minutes: s.walk_minutes,
      ligne: s.ligne,
    })),
    wizard_answers: wizard,
    generated_at: new Date(),
    // Données opensource enrichies
    paris_distance: parisDistance,
    // Filtre éditorial : on retire les arrêts de bus de la liste affichée
    // s'il y a d'autres modes structurants (RER/métro/tram/train).
    // SINON (zone exclusivement desservie par bus), on GARDE les bus —
    // mieux vaut afficher "12 bus à 900 m" que "0 arrêts" qui fait peur.
    transports: transports
      ? (() => {
          const isStructurant = (t: string) => {
            const v = t.toLowerCase();
            return (
              v === "rer" ||
              v === "metro" ||
              v === "tram" ||
              v === "tramway" ||
              v === "train" ||
              v === "ferry"
            );
          };
          const structurants = transports.stops.filter((s) =>
            isStructurant(s.type ?? ""),
          );
          // Si on a au moins UN mode structurant, on filtre les bus.
          // Sinon on garde tout (bus inclus, mieux que vide).
          const hasStructurant = structurants.length > 0;
          const finalStops = hasStructurant
            ? transports.stops.filter((s) => {
                const t = (s.type ?? "").toLowerCase();
                return t !== "stop"; // on retire toujours les "stop" génériques
              })
            : transports.stops;
          const finalParType = hasStructurant
            ? Object.fromEntries(
                Object.entries(transports.par_type).filter(
                  ([type]) => type !== "stop",
                ),
              )
            : transports.par_type;
          return {
            score_accessibilite: transports.score_accessibilite,
            count: finalStops.length,
            par_type: finalParType,
            top_stops: finalStops.slice(0, 6),
            radius_m: transportsRadius,
          };
        })()
      : null,
    ecoles: ecoles
      ? {
          count: ecoles.count,
          par_type: ecoles.par_type,
          // Sélection 1 plus proche par CYCLE SCOLAIRE (maternelle, élémentaire,
          // collège, lycée). Garantit que la famille voit la couverture complète
          // du cursus, pas seulement les maternelles/primaires qui dominent
          // numériquement (et masquent le lycée à 1,2 km).
          // Le helper Annuaire EN renvoie déjà trié par distance.
          top: (() => {
            const seenCycles = new Set<string>();
            const selected: typeof ecoles.ecoles = [];
            const classifyCycle = (type: string): string => {
              const t = type.toLowerCase();
              if (t.includes("maternel")) return "maternelle";
              if (t.includes("élémentaire") || t.includes("elementaire") || t.includes("primaire")) return "elementaire";
              if (t.includes("collège") || t.includes("college")) return "college";
              if (t.includes("lycée") || t.includes("lycee")) return "lycee";
              return "autre";
            };
            for (const e of ecoles.ecoles) {
              const cycle = classifyCycle(e.type);
              if (cycle === "autre") continue;
              if (seenCycles.has(cycle)) continue;
              seenCycles.add(cycle);
              selected.push(e);
              if (selected.length >= 4) break;
            }
            // Si moins de 4 cycles trouvés, complète avec les plus proches restantes
            if (selected.length < 4) {
              const usedIds = new Set(selected.map((e) => e.identifiant));
              for (const e of ecoles.ecoles) {
                if (usedIds.has(e.identifiant)) continue;
                selected.push(e);
                if (selected.length >= 4) break;
              }
            }
            return selected
              .sort((a, b) => a.distance_m - b.distance_m)
              .map((e) => ({
                nom: e.nom,
                type: e.type,
                statut: e.statut,
                distance_m: e.distance_m,
                walk_minutes: e.walk_minutes,
              }));
          })(),
        }
      : null,
    lycees_bac: lyceesBac && lyceesBac.available
      ? {
          count: lyceesBac.count,
          top: lyceesBac.top.map((l) => ({
            nom: l.nom,
            statut: l.statut,
            commune: l.commune,
            dept: l.dept,
            taux_reussite_general: l.taux_reussite_general,
            taux_reussite_techno: l.taux_reussite_techno,
            taux_mention_general: l.taux_mention_general,
            distance_m: l.distance_m,
            annee_session: l.annee_session,
          })),
        }
      : null,
    // Lycées professionnels (bac pro) — dataset IVAL parallèle au GT.
    lycees_pro: lyceesPro && lyceesPro.available
      ? {
          count: lyceesPro.count,
          top: lyceesPro.top.map((l) => ({
            nom: l.nom,
            statut: l.statut,
            commune: l.commune,
            dept: l.dept,
            taux_reussite_pro: l.taux_reussite_pro,
            taux_mention_pro: l.taux_mention_pro,
            distance_m: l.distance_m,
            annee_session: l.annee_session,
          })),
        }
      : null,
    // Enseignement supérieur : universités, grandes écoles, IUT, IEP, instituts.
    // Source : data.enseignementsup-recherche.gouv.fr (ESR).
    etablissements_sup: etablissementsSup && etablissementsSup.available
      ? {
          count: etablissementsSup.count,
          par_categorie: etablissementsSup.par_categorie,
          top: etablissementsSup.top.map((e) => ({
            nom: e.nom,
            categorie: e.categorie,
            secteur: e.secteur,
            commune: e.commune,
            distance_m: e.distance_m,
            prestige: e.prestige,
          })),
        }
      : null,
    // Écoles paramédicales FINESS (IFSI privés, kiné, ortho, sage-femme…)
    // Complète etablissements_sup (qui couvre les facultés médecine/pharmacie
    // universitaires rattachées à un CHU).
    ecoles_sante: ecolesSanteFiness && ecolesSanteFiness.available
      ? {
          count: ecolesSanteFiness.count,
          top: ecolesSanteFiness.top.map((e) => ({
            nom: e.nom,
            type: e.type,
            categorie_finess: e.categorie_finess,
            commune: e.commune,
            distance_m: e.distance_m,
          })),
        }
      : null,
    // CFA (Centres de Formation d'Apprentis) — extraction depuis ecoles.ecoles
    // qui contient déjà tous les types Annuaire EN. Filtre par type contenant
    // "centre de formation d'apprentis" / "CFA" / "apprenti". Max 3 plus proches.
    cfa: ecoles
      ? (() => {
          const matchesCfa = (s: string | null | undefined): boolean => {
            if (!s) return false;
            const v = s.toLowerCase();
            return (
              v.includes("centre de formation") ||
              v.includes("apprenti") ||
              v.includes("cfa")
            );
          };
          const cfas = ecoles.ecoles
            .filter((e) => matchesCfa(e.type) || matchesCfa(e.nature))
            .slice(0, 3)
            .map((e) => ({
              nom: e.nom,
              type: e.type,
              statut: e.statut,
              distance_m: e.distance_m,
              walk_minutes: e.walk_minutes,
            }));
          return cfas.length > 0 ? { count: cfas.length, top: cfas } : null;
        })()
      : null,
    points_interet: pointsInteret && pointsInteret.available
      ? {
          count: pointsInteret.count,
          top: pointsInteret.top.map((p) => ({
            nom: p.nom,
            type: p.type,
            distance_m: p.distance_m,
          })),
        }
      : null,
    services: services
      ? {
          score_quotidien: services.score_quotidien,
          count: services.count,
          par_categorie: services.par_categorie,
        }
      : null,
    insee: inseeIris
      ? {
          revenu_median_uc_eur: inseeIris.revenu_median_uc_eur,
          taux_proprietaires_pct: inseeIris.taux_proprietaires_pct,
          taux_csp_plus_pct: inseeIris.taux_csp_plus_pct,
          population_municipale: inseeIris.population_municipale,
        }
      : null,
    price_evolution: priceEvolution && priceEvolution.available
      ? {
          type_local: priceEvolution.type_local,
          years: priceEvolution.years,
          variation_pct_total: priceEvolution.variation_pct_total,
          variation_pct_5y: priceEvolution.variation_pct_5y,
          annee_min: priceEvolution.annee_min,
          annee_max: priceEvolution.annee_max,
          // Métadonnées cluster (nouveauté) :
          scope: "cluster" as const,
          nb_total_ventes_cluster: priceEvolution.nb_total_ventes_cluster,
          match_method: priceEvolution.match_method,
          // Référence comparative commune (2e courbe sur le graphique) :
          commune_years:
            communePriceEvolution && communePriceEvolution.available
              ? communePriceEvolution.years
              : null,
          commune_variation_pct_total:
            communePriceEvolution && communePriceEvolution.available
              ? communePriceEvolution.variation_pct_total
              : null,
          commune_code:
            communePriceEvolution && communePriceEvolution.available
              ? communePriceEvolution.code_commune
              : null,
        }
      // Fallback : pas de cluster mais commune dispo → on affiche quand même
      // l'évolution commune-level (mieux que rien pour le vendeur).
      : communePriceEvolution && communePriceEvolution.available
        ? {
            type_local: communePriceEvolution.type_local,
            years: communePriceEvolution.years,
            variation_pct_total: communePriceEvolution.variation_pct_total,
            variation_pct_5y: null,
            annee_min: communePriceEvolution.annee_min,
            annee_max: communePriceEvolution.annee_max,
            scope: "commune" as const,
            nb_total_ventes_cluster: communePriceEvolution.nb_total_ventes_commune,
            match_method: null,
            commune_years: null,
            commune_variation_pct_total: null,
            commune_code: communePriceEvolution.code_commune,
          }
        : null,
    // KILLER FEATURE forward-looking : grands projets infra à proximité.
    // GPE, LGV, canaux, ZAC, gigafactories — avec impact prix anticipé.
    // Différenciateur unique vs PriceHubble/Immo Data (qui sont backward).
    grands_projets: grandsProjets && grandsProjets.length > 0
      ? grandsProjets.map((g) => ({
          nom: g.nom,
          type: g.type,
          importance: g.importance,
          etat: g.etat,
          date_livraison_estimee: g.date_livraison_estimee,
          impact_prix_pct_min: g.impact_prix_pct_min,
          impact_prix_pct_max: g.impact_prix_pct_max,
          description: g.description,
          distance_m: g.distance_m,
        }))
      : null,
  };

  let pdfBuffer: Buffer | null = null;
  try {
    pdfBuffer = await renderToBuffer(
      createElement(CabinetLeadReportPDF, { data: pdfData }) as unknown as ReactElement<DocumentProps>,
    );
  } catch (err) {
    console.error("[/api/cabinets/lead] pdf render failed:", err);
    // Pas bloquant : on continue, on enverra les emails sans PDF.
  }

  const pdfBase64 = pdfBuffer ? pdfBuffer.toString("base64") : null;
  const pdfFilename = `Estimation-${cabinet.cabinet_name}-${Date.now()}.pdf`;

  // 5) Envoi des 2 emails Resend (non-bloquants pour la réponse)
  const updates: Partial<{ email_to_visitor_sent: boolean; email_to_cabinet_sent: boolean }> = {};

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const cabinetName = cabinet.cabinet_name;
    const primary = cabinet.primary_color ?? "#1f3a8a";
    const ctaUrl = cabinet.cta_contact_url ?? "#";
    const ctaLabel = cabinet.cta_contact_label ?? "En savoir plus";

    // ── EMAIL #1 : Au visiteur ──────────────────────────────────────────────
    const isTerrainEmail = type_bien === "Terrain";
    const hasEstimationEmail = estim.prix_total_median != null;

    // Texte du paragraphe d'expertise adapté selon le type de bien
    const expertParagraph = isTerrainEmail
      ? `<p><strong>Un expert ${cabinetName} vous recontactera sous 24h ouvrées</strong> pour discuter de votre projet de terrain. L'estimation d'un terrain repose sur la <strong>charge foncière</strong> (bilan promoteur) et nécessite une étude dédiée (consultation PLU/PLUi, identification des promoteurs potentiels, modélisation du bilan promoteur).</p>`
      : hasEstimationEmail
        ? `<p><strong>Un expert ${cabinetName} vous recontactera sous 24h ouvrées</strong> pour affiner cette estimation avec une visite physique gratuite (état réel, étage exact, exposition, prestations) et vous accompagner dans votre projet.</p>`
        : `<p><strong>Un expert ${cabinetName} vous recontactera sous 24h ouvrées</strong> pour réaliser une analyse personnalisée tenant compte des spécificités de votre bien.</p>`;

    // Bloc disclaimer adapté également
    const disclaimerHtml = isTerrainEmail
      ? `Ce document est une <strong>fiche de synthèse de votre demande</strong>. L'estimation d'un terrain ne peut pas être automatisée — elle nécessite une étude charge foncière / bilan promoteur dédiée.`
      : hasEstimationEmail
        ? `Cette estimation est <strong>indicative</strong>, calculée à partir des ventes notariées DVF du micro-marché. Elle ne se substitue pas à un avis de valeur professionnel d'un expert immobilier.`
        : `Pour ce type de bien ou ce micro-marché, une analyse personnalisée est nécessaire. Un expert vous contactera pour réaliser cette estimation.`;

    const visitorHtml = `
<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f8fafc; padding:20px;">
<div style="max-width:560px; margin:0 auto; background:white; border-radius:12px; overflow:hidden; border:1px solid #e2e8f0;">
  <div style="background:${primary}; color:white; padding:24px;">
    <h1 style="margin:0; font-size:22px;">${cabinetName}</h1>
    <p style="margin:6px 0 0; opacity:0.9; font-size:13px;">${isTerrainEmail ? "Votre demande d'étude de terrain" : "Votre estimation immobilière"}</p>
  </div>
  <div style="padding:24px; color:#0f172a;">
    <p>Bonjour <strong>${visitor_name}</strong>,</p>
    <p>Merci pour votre demande ${isTerrainEmail ? "d'étude" : "d'estimation"} pour le bien situé <strong>${address}</strong>.</p>
    ${hasEstimationEmail ? `
    <div style="background:#f1f5f9; padding:16px; border-radius:8px; text-align:center; margin:16px 0; border:1px solid ${primary}40;">
      <div style="font-size:11px; text-transform:uppercase; color:${primary}; font-weight:700; letter-spacing:1px;">Estimation marché</div>
      <div style="font-size:28px; font-weight:800; color:${primary}; margin-top:6px;">${new Intl.NumberFormat("fr-FR").format(estim.prix_total_median!)} €</div>
      ${estim.prix_m2_median ? `<div style="font-size:12px; color:#475569; margin-top:4px;">${new Intl.NumberFormat("fr-FR").format(Math.round(estim.prix_m2_median))} €/m²</div>` : ""}
    </div>
    ` : ""}
    <p>Vous trouverez ci-joint un rapport PDF récapitulant ${isTerrainEmail ? "votre demande et le contexte méthodologique" : hasEstimationEmail ? "cette estimation indicative" : "votre demande"} et les caractéristiques que vous nous avez communiquées.</p>
    ${expertParagraph}
    <p style="margin-top:24px;">
      <a href="${ctaUrl}" style="display:inline-block; background:${primary}; color:white; padding:12px 24px; border-radius:8px; text-decoration:none; font-weight:700; font-size:14px;">${ctaLabel} →</a>
    </p>
    <p style="font-size:12px; color:#64748b; margin-top:24px; padding-top:16px; border-top:1px solid #e2e8f0;">
      ${disclaimerHtml}
    </p>
  </div>
  <div style="background:#f8fafc; padding:14px 24px; font-size:11px; color:#94a3b8; text-align:center; border-top:1px solid #e2e8f0;">
    ${cabinet.legal_mention ?? ""}<br/>
    Estimation propulsée par <strong>DATAMERRY®</strong>
  </div>
</div>
</body></html>`;

    // Payload typé en Record<string, unknown> pour éviter les divergences de
    // types entre versions du SDK Resend (replyTo vs reply_to, signature
    // d'attachments…). À runtime la lib accepte n'importe quoi de bien formé.
    const visitorPayload: Record<string, unknown> = {
      from: `${cabinetName} <no-reply@datamerry.com>`,
      to: visitor_email,
      subject: `Votre estimation pour ${address} — ${cabinetName}`,
      html: visitorHtml,
    };
    if (pdfBase64) {
      visitorPayload.attachments = [{ filename: pdfFilename, content: pdfBase64 }];
    }

    const visitorSend = await resend.emails
      .send(visitorPayload as unknown as Parameters<typeof resend.emails.send>[0])
      .catch((err: unknown) => {
        console.error("[/api/cabinets/lead] visitor email failed:", err);
        return null;
      });
    if (visitorSend && !(visitorSend as { error?: unknown }).error) {
      updates.email_to_visitor_sent = true;
    }

    // ── EMAIL #2 : Au cabinet ───────────────────────────────────────────────
    if (cabinet.contact_email) {
      const intentDisplay =
        intent === "vendeur" ? "🏷️ Vendeur" :
        intent === "acheteur" ? "🔑 Acheteur" :
        intent === "curieux" ? "👀 Renseignement" : "—";

      const cabinetHtml = `
<!DOCTYPE html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#f8fafc; padding:20px;">
<div style="max-width:600px; margin:0 auto; background:white; border-radius:12px; overflow:hidden; border:1px solid #e2e8f0;">
  <div style="background:${primary}; color:white; padding:20px;">
    <h1 style="margin:0; font-size:18px;">🎯 Nouveau lead — ${cabinetName}</h1>
    <p style="margin:6px 0 0; opacity:0.9; font-size:12px;">Capturé via DATAMERRY · ${new Date().toLocaleString("fr-FR")}</p>
  </div>
  <div style="padding:20px; color:#0f172a; font-size:14px;">
    <h2 style="color:${primary}; font-size:14px; text-transform:uppercase; letter-spacing:1px; margin-top:0;">Contact visiteur</h2>
    <table style="width:100%; font-size:13px; border-collapse:collapse;">
      <tr><td style="padding:6px 0; color:#64748b;">Nom</td><td style="padding:6px 0; font-weight:700;">${visitor_name}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Email</td><td style="padding:6px 0;"><a href="mailto:${visitor_email}" style="color:${primary};">${visitor_email}</a></td></tr>
      ${visitor_phone ? `<tr><td style="padding:6px 0; color:#64748b;">Téléphone</td><td style="padding:6px 0;"><a href="tel:${visitor_phone}" style="color:${primary};">${visitor_phone}</a></td></tr>` : ""}
      <tr><td style="padding:6px 0; color:#64748b;">Intention</td><td style="padding:6px 0;">${intentDisplay}</td></tr>
    </table>

    <h2 style="color:${primary}; font-size:14px; text-transform:uppercase; letter-spacing:1px; margin-top:24px;">Bien</h2>
    <table style="width:100%; font-size:13px; border-collapse:collapse;">
      <tr><td style="padding:6px 0; color:#64748b;">Adresse</td><td style="padding:6px 0; font-weight:700;">${address}</td></tr>
      <tr><td style="padding:6px 0; color:#64748b;">Type</td><td style="padding:6px 0;">${type_bien}</td></tr>
      ${insertPayload.surface ? `<tr><td style="padding:6px 0; color:#64748b;">Surface</td><td style="padding:6px 0;">${insertPayload.surface} m²</td></tr>` : ""}
      ${w("pieces") ? `<tr><td style="padding:6px 0; color:#64748b;">Pièces</td><td style="padding:6px 0;">T${w("pieces")}</td></tr>` : ""}
      ${w("etage") ? `<tr><td style="padding:6px 0; color:#64748b;">Étage</td><td style="padding:6px 0;">${w("etage")}</td></tr>` : ""}
      ${w("annee_construction") ? `<tr><td style="padding:6px 0; color:#64748b;">Année</td><td style="padding:6px 0;">${w("annee_construction")}</td></tr>` : ""}
      ${w("dpe") && w("dpe") !== "inconnu" ? `<tr><td style="padding:6px 0; color:#64748b;">DPE</td><td style="padding:6px 0;">Classe ${w("dpe").toUpperCase()}</td></tr>` : ""}
      ${w("etat") ? `<tr><td style="padding:6px 0; color:#64748b;">État</td><td style="padding:6px 0;">${w("etat")}</td></tr>` : ""}
      ${w("exterieurs") ? `<tr><td style="padding:6px 0; color:#64748b;">Extérieurs</td><td style="padding:6px 0;">${w("exterieurs")}</td></tr>` : ""}
    </table>

    ${estim.prix_total_median ? `
    <h2 style="color:${primary}; font-size:14px; text-transform:uppercase; letter-spacing:1px; margin-top:24px;">Estimation DATAMERRY</h2>
    <div style="background:#f1f5f9; padding:14px; border-radius:8px; text-align:center; border:1px solid ${primary}40;">
      <div style="font-size:24px; font-weight:800; color:${primary};">${new Intl.NumberFormat("fr-FR").format(estim.prix_total_median)} €</div>
      ${estim.prix_m2_median ? `<div style="font-size:12px; color:#475569; margin-top:4px;">${new Intl.NumberFormat("fr-FR").format(Math.round(estim.prix_m2_median))} €/m² · ${estim.nb_ventes ?? "?"} ventes DVF</div>` : ""}
    </div>
    ` : ""}

    <p style="margin-top:20px; padding:12px; background:#fef9c3; border-radius:6px; font-size:12px; color:#713f12;">
      💡 Le rapport PDF complet est joint à cet email. Le visiteur l'a aussi reçu.<br/>
      <strong>Rappelez ce lead sous 24h pour maximiser la conversion.</strong>
    </p>
  </div>
  <div style="background:#f8fafc; padding:12px 20px; font-size:11px; color:#94a3b8; text-align:center; border-top:1px solid #e2e8f0;">
    Lead ID : ${leadId}<br/>
    Notification automatique DATAMERRY · vous recevez cet email parce que vous êtes le cabinet propriétaire du slug "${slug}"
  </div>
</div>
</body></html>`;

      const cabinetPayload: Record<string, unknown> = {
        from: `DATAMERRY <no-reply@datamerry.com>`,
        to: cabinet.contact_email,
        replyTo: visitor_email, // Diara peut répondre directement au visiteur
        subject: `🎯 Nouveau lead ${cabinetName} · ${visitor_name} · ${address}`,
        html: cabinetHtml,
      };
      if (pdfBase64) {
        cabinetPayload.attachments = [{ filename: pdfFilename, content: pdfBase64 }];
      }

      const cabinetSend = await resend.emails
        .send(cabinetPayload as unknown as Parameters<typeof resend.emails.send>[0])
        .catch((err: unknown) => {
          console.error("[/api/cabinets/lead] cabinet email failed:", err);
          return null;
        });
      if (cabinetSend && !(cabinetSend as { error?: unknown }).error) {
        updates.email_to_cabinet_sent = true;
      }
    }
  } else {
    console.warn("[/api/cabinets/lead] RESEND_API_KEY missing — emails skipped");
  }

  // 6) Met à jour les flags d'envoi email (non-bloquant)
  if (Object.keys(updates).length > 0) {
    void sb.from("dim_cabinet_leads").update(updates).eq("id", leadId);
  }

  return NextResponse.json({
    ok: true,
    lead_id: leadId,
    cta_url: cabinet.cta_contact_url,
    cta_label: cabinet.cta_contact_label,
  });
}
