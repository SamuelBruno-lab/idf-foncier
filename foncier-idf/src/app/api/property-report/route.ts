/**
 * GET /api/property-report?address=...&surface=62&pieces=3&prix_achat=220000
 *                        &tmi=41&type=Appartement
 *                        &include=streetview,cadastre,ecoles,permis,transports,services,insee
 *                        &precision=fresh|deep
 *
 * Endpoint MÉGA-AGRÉGATEUR — l'argument-massue de DATAMERRY ("Walmart de la
 * data immo"). En 1 appel HTTP, renvoie un rapport propriété complet :
 *
 *   ▪ estimation  (cluster HDBSCAN + commune fallback)
 *   ▪ rendement   (OLAP / ANIL)
 *   ▪ plafonds_fiscaux  (Jeanbrun / LLI / Loc'Avantages / Denormandie)
 *   ▪ strategies_locatives  (8 scénarios chiffrés)
 *   ▪ streetview  (Mapillary first → Google fallback → cache 30j)  [opt-in]
 *   ▪ cadastre, permis, ecoles, transports, services, insee_iris  [opt-in, stubs v1]
 *
 * Pricing : 1 appel = 1 ligne dans api_usage_log, indépendamment du nombre
 * de sub-datasets. Les hits cache (streetview surtout) ne pèsent pas sur le
 * coût marginal côté DATAMERRY.
 *
 * Performance : ~600-1500ms en froid, ~150-300ms en cache chaud (geocodage).
 */

import { NextRequest, NextResponse } from "next/server";

import { geocodeAddress, type GeocodeMeta } from "@/lib/geocode";
import { withApiKey, type ApiKeyRecord } from "@/lib/auth/apiKey";
import { getStreetview, type StreetviewResult } from "@/lib/streetview";
import { getEcoles } from "@/lib/datasets/ecoles";
import { getTransports } from "@/lib/datasets/transports";
import { getServices } from "@/lib/datasets/services";
import { getDpe } from "@/lib/datasets/dpe";
import { getParcelle } from "@/lib/datasets/cadastre";
import { getInseeIris } from "@/lib/datasets/insee";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { pointInPolygon } from "@/lib/geo";

// ──────────────────────────────────────────────────────────────────────────────
// Types & helpers
// ──────────────────────────────────────────────────────────────────────────────

const TYPE_ALIASES: Record<string, string> = {
  appartement: "Appartement",
  appart: "Appartement",
  appt: "Appartement",
  maison: "Maison",
  commerce: "Local industriel. commercial ou assimilé",
};

function resolveTypeLocal(input: string | null): string {
  if (!input) return "Appartement";
  return TYPE_ALIASES[input.toLowerCase().trim()] ?? "Appartement";
}

type IncludeKey =
  | "streetview"
  | "cadastre"
  | "permis"
  | "ecoles"
  | "transports"
  | "services"
  | "insee"
  | "dpe";

const ALL_INCLUDE: IncludeKey[] = [
  "streetview",
  "cadastre",
  "permis",
  "ecoles",
  "transports",
  "services",
  "insee",
  "dpe",
];

function parseInclude(raw: string | null): Set<IncludeKey> {
  if (!raw) return new Set();
  if (raw === "all") return new Set(ALL_INCLUDE);
  const out = new Set<IncludeKey>();
  for (const tok of raw.split(",").map((s) => s.trim().toLowerCase())) {
    if ((ALL_INCLUDE as string[]).includes(tok)) out.add(tok as IncludeKey);
  }
  return out;
}

type ZoneRow = {
  id: string;
  code_commune: string;
  type_local: string;
  count: number;
  hull_coords: number[][] | null;
  centroid_lat: number | null;
  centroid_lon: number | null;
  prix_m2_median: number | null;
  prix_m2_p10: number | null;
  prix_m2_p90: number | null;
};

// ──────────────────────────────────────────────────────────────────────────────
// Sub-agrégats (re-implémentent la logique des endpoints individuels —
// on évite l'appel HTTP interne qui doublerait le logging usage)
// ──────────────────────────────────────────────────────────────────────────────

async function fetchEstimation(
  lat: number,
  lon: number,
  codeInsee: string,
  typeLocal: string,
  surface: number | null,
  precision: "fresh" | "deep",
) {
  const sb = getSupabaseServerClient();
  const tableName =
    precision === "deep" ? "dvf_hdbscan_zones_5y" : "dvf_hdbscan_zones";

  const { data: zones, error } = await sb
    .from(tableName)
    .select(
      "id, code_commune, type_local, count, hull_coords, centroid_lat, centroid_lon, prix_m2_median, prix_m2_p10, prix_m2_p90",
    )
    .eq("code_commune", codeInsee)
    .eq("type_local", typeLocal);

  if (error || !zones?.length) {
    return { available: false as const, error: error?.message ?? "no_zones" };
  }

  const rows = zones as ZoneRow[];
  const point: [number, number] = [lat, lon]; // convention hull_coords = [[lat, lon], …]
  // 1) cluster contenant le point
  let match = rows.find(
    (z) => z.hull_coords && pointInPolygon(point, z.hull_coords),
  );
  // 2) sinon cluster le plus proche du centroïde
  if (!match) {
    let best: { row: ZoneRow; d: number } | null = null;
    for (const z of rows) {
      if (z.centroid_lat == null || z.centroid_lon == null) continue;
      const d =
        (z.centroid_lat - lat) ** 2 + (z.centroid_lon - lon) ** 2;
      if (!best || d < best.d) best = { row: z, d };
    }
    match = best?.row ?? rows[0];
  }

  const prixMedian = match.prix_m2_median;
  const surface_safe = surface && surface > 0 ? surface : null;

  return {
    available: true as const,
    zone_id: match.id,
    cluster_n: match.count,
    prix_m2: {
      median: prixMedian,
      p10: match.prix_m2_p10,
      p90: match.prix_m2_p90,
    },
    prix_total: surface_safe && prixMedian
      ? {
          median: Math.round(prixMedian * surface_safe),
          p10: match.prix_m2_p10 ? Math.round(match.prix_m2_p10 * surface_safe) : null,
          p90: match.prix_m2_p90 ? Math.round(match.prix_m2_p90 * surface_safe) : null,
        }
      : null,
  };
}

async function fetchRendement(
  codeInsee: string,
  typeLocal: string,
  pieces: number | null,
) {
  const sb = getSupabaseServerClient();
  const bucket =
    pieces == null ? "all" : pieces <= 2 ? "T1-T2" : "T3+";

  const { data, error } = await sb
    .from("fact_rendement")
    .select(
      "loyer_source, loyer_quality, loyer_m2_median, prix_m2_median, rendement_brut, rendement_net_est",
    )
    .eq("code_commune", codeInsee)
    .eq("type_local", typeLocal)
    .eq("nb_pieces_bucket", bucket)
    .maybeSingle();

  if (error || !data) return { available: false as const };
  return { available: true as const, ...data };
}

async function fetchPlafonds(codeInsee: string) {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("dim_zonage_abc")
    .select("zone_abc, code_insee")
    .eq("code_insee", codeInsee)
    .maybeSingle();
  if (error || !data) return { available: false as const };
  return { available: true as const, zone_abc: data.zone_abc };
}

// ──────────────────────────────────────────────────────────────────────────────
// Datasets externes — Phase 10B + 10C branchés.
// Permis Sit@del2 : encore stub (nécessite pipeline d'ingestion CSV mensuel).
// ──────────────────────────────────────────────────────────────────────────────

async function fetchPermis(_codeInsee: string) {
  return {
    available: false as const,
    todo:
      "Sit@del2 — pipeline d'ingestion CSV mensuel à implémenter " +
      "(téléchargement statistiques.developpement-durable.gouv.fr → table fact_permis_construire).",
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Handler
// ──────────────────────────────────────────────────────────────────────────────

async function handlePropertyReport(
  req: NextRequest,
  _ctx: { key: ApiKeyRecord },
): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const address = sp.get("address")?.trim();
  const surfaceRaw = sp.get("surface");
  const surface = surfaceRaw ? Number(surfaceRaw) : null;
  const piecesRaw = sp.get("pieces");
  const pieces = piecesRaw ? Number(piecesRaw) : null;
  const typeLocal = resolveTypeLocal(sp.get("type"));
  const precision = sp.get("precision") === "deep" ? "deep" : "fresh";
  const include = parseInclude(sp.get("include"));

  if (!address || address.length < 3) {
    return NextResponse.json(
      { error: "Paramètre 'address' requis (min 3 caractères)" },
      { status: 400 },
    );
  }

  // 1) Géocodage
  const sb = getSupabaseServerClient();
  let geocode;
  try {
    geocode = await geocodeAddress(address, sb);
  } catch (err) {
    console.error("[/api/property-report] geocode failed:", err);
    return NextResponse.json(
      { error: "Géocodage indisponible" },
      { status: 503 },
    );
  }
  const top = geocode.results[0];
  if (!top) {
    return NextResponse.json(
      { error: "Adresse non trouvée", meta: geocode.meta },
      { status: 404 },
    );
  }

  const lat = top.lat;
  const lon = top.lon;
  const codeInsee = top.code_insee;

  // 2) Sub-agrégats — exécutés en parallèle
  const [estimation, rendement, plafonds, streetview, cadastre, permis, ecoles, transports, services, insee, dpe] =
    await Promise.all([
      fetchEstimation(lat, lon, codeInsee, typeLocal, surface, precision as "fresh" | "deep"),
      fetchRendement(codeInsee, typeLocal, pieces),
      fetchPlafonds(codeInsee),
      include.has("streetview")
        ? getStreetview(lat, lon)
        : Promise.resolve<StreetviewResult>({
            available: false,
            source: "none",
            image_url: null,
            attribution: "",
            copyright: null,
            captured_at: null,
            cached: false,
            cost_eur: 0,
          }),
      include.has("cadastre") ? getParcelle(lat, lon) : Promise.resolve(null),
      include.has("permis") ? fetchPermis(codeInsee) : Promise.resolve(null),
      include.has("ecoles") ? getEcoles(lat, lon) : Promise.resolve(null),
      include.has("transports") ? getTransports(lat, lon) : Promise.resolve(null),
      include.has("services") ? getServices(lat, lon) : Promise.resolve(null),
      include.has("insee") ? getInseeIris(lat, lon, codeInsee) : Promise.resolve(null),
      include.has("dpe") ? getDpe(lat, lon, top.postcode) : Promise.resolve(null),
    ]);

  // 3) Réponse
  return NextResponse.json({
    address: {
      label: top.label,
      lat,
      lon,
      code_insee: codeInsee,
      postcode: top.postcode,
      city: top.city,
    },
    query: {
      type_local: typeLocal,
      surface,
      pieces,
      precision,
      include: Array.from(include),
    },
    estimation,
    rendement,
    plafonds,
    streetview: include.has("streetview") ? streetview : null,
    cadastre,
    permis,
    ecoles,
    transports,
    services_proximite: services,
    insee_iris: insee,
    dpe,
    geocode_meta: geocode.meta as GeocodeMeta,
    api_version: "1.1",
    bundle: "DATAMERRY all-in — 39€ TTC/mo, 1er mois offert",
  });
}

export const GET = withApiKey(handlePropertyReport, {
  endpoint: "/api/property-report",
});
