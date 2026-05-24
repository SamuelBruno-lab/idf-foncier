/**
 * GET /api/rendement?address=...&type=Appartement&pieces=3
 *   ou
 * GET /api/rendement?code_commune=93029&type=Appartement&pieces=3
 *
 * Renvoie le rendement locatif (brut + net estimé) pour une zone :
 *   1. Résolution zone (cluster HDBSCAN si address fournie, sinon commune)
 *   2. Lookup fact_rendement par (zone_id, type, bucket pièces)
 *   3. Fallback commune si pas de ligne cluster
 *   4. Calcul rendement_net = brut × (1 - vacance% - charges% - TF%)
 *
 * Source loyer : OLAP (haute qualité, ~37 agglos) ou ANIL Carte des loyers
 * (France entière en fallback). Le champ `loyer_source` indique laquelle.
 */

import { NextRequest, NextResponse } from "next/server";

import { geocodeAddress, type GeocodeMeta } from "@/lib/geocode";
import { pointInPolygon } from "@/lib/geo";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const TYPE_ALIASES: Record<string, string> = {
  appartement: "Appartement",
  appart: "Appartement",
  appt: "Appartement",
  maison: "Maison",
  commerce: "Local industriel. commercial ou assimilé",
  "local commercial": "Local industriel. commercial ou assimilé",
};

function resolveTypeLocal(input: string | null): string {
  if (!input) return "Appartement";
  const key = input.toLowerCase().trim();
  return TYPE_ALIASES[key] ?? "Appartement";
}

function bucketFromPieces(pieces: number | null): "T1-T2" | "T3+" | "all" {
  if (pieces == null || !Number.isFinite(pieces)) return "all";
  if (pieces <= 2) return "T1-T2";
  return "T3+";
}

type FactRow = {
  zone_id: string;
  code_commune: string;
  type_local: string;
  nb_pieces_bucket: string;
  loyer_source: string;
  loyer_quality: string;
  loyer_annee: number;
  loyer_m2_median: number | null;
  loyer_n_obs: number | null;
  prix_m2_median: number | null;
  prix_window: string | null;
  rendement_brut: number | null;
  rendement_net_est: number | null;
};

type HypothesesRow = {
  type_local: string;
  vacance_pct: number;
  charges_pct: number;
  taxe_fonciere_pct: number;
};

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const address = sp.get("address")?.trim();
  const codeCommune = sp.get("code_commune")?.trim();
  const typeLocal = resolveTypeLocal(sp.get("type"));
  const piecesRaw = sp.get("pieces");
  const pieces = piecesRaw ? Number(piecesRaw) : null;
  const bucket = bucketFromPieces(pieces);

  if (!address && !codeCommune) {
    return NextResponse.json(
      { error: "Paramètre 'address' OU 'code_commune' requis" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseServerClient();

  // ── 1. Résolution zone ─────────────────────────────────────────────
  let resolvedCommune: string;
  let clusterId: string | null = null;
  let addressPayload: Record<string, unknown> | null = null;
  let geocodeMeta: GeocodeMeta | null = null;

  if (address) {
    let geocode;
    try {
      geocode = await geocodeAddress(address, supabase);
    } catch (err) {
      console.error("[/api/rendement] geocoding failed:", err);
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

    // Cherche le cluster HDBSCAN qui contient le point (même pattern que /api/estimate)
    const { data: zones } = await supabase
      .from("dvf_hdbscan_zones")
      .select("id, hull_coords")
      .eq("code_commune", resolvedCommune)
      .eq("type_local", typeLocal);

    const point: [number, number] = [top.lat, top.lon];
    const matched = (zones ?? []).find(
      (z) =>
        z.hull_coords !== null &&
        Array.isArray(z.hull_coords) &&
        z.hull_coords.length >= 3 &&
        pointInPolygon(point, z.hull_coords as number[][]),
    );
    if (matched) {
      clusterId = matched.id;
    }
  } else {
    resolvedCommune = codeCommune!;
  }

  // ── 2. Lookup fact_rendement (cluster prioritaire, sinon commune) ──
  const communeFallbackId = `COMMUNE_${resolvedCommune}`;
  const candidateIds = clusterId
    ? [clusterId, communeFallbackId]
    : [communeFallbackId];

  const { data: factRows, error: factErr } = await supabase
    .from("fact_rendement")
    .select("*")
    .in("zone_id", candidateIds)
    .eq("type_local", typeLocal)
    .eq("nb_pieces_bucket", bucket);

  if (factErr) {
    console.error("[/api/rendement] fact_rendement read error:", factErr);
    return NextResponse.json(
      { error: "Données de rendement indisponibles" },
      { status: 500 },
    );
  }

  // Bucket fallback : si pas de ligne en T1-T2 ou T3+, essaie 'all'
  let row =
    pickRow(factRows as FactRow[] | null, clusterId, communeFallbackId) ?? null;

  if (!row && bucket !== "all") {
    const { data: allRows } = await supabase
      .from("fact_rendement")
      .select("*")
      .in("zone_id", candidateIds)
      .eq("type_local", typeLocal)
      .eq("nb_pieces_bucket", "all");
    row = pickRow(allRows as FactRow[] | null, clusterId, communeFallbackId);
  }

  if (!row) {
    return NextResponse.json(
      {
        error: "Aucune donnée de rendement disponible pour cette zone",
        zone_requested: {
          code_commune: resolvedCommune,
          type_local: typeLocal,
          nb_pieces_bucket: bucket,
        },
        address: addressPayload,
      },
      { status: 404 },
    );
  }

  // ── 3. Récupération des hypothèses pour calcul net ─────────────────
  const { data: hypoRow } = await supabase
    .from("dim_rendement_hypotheses")
    .select("*")
    .eq("type_local", typeLocal)
    .maybeSingle();

  const hypotheses: HypothesesRow = (hypoRow as HypothesesRow | null) ?? {
    type_local: typeLocal,
    vacance_pct: 5,
    charges_pct: 15,
    taxe_fonciere_pct: 8,
  };

  // Si rendement_net_est n'est pas pré-calculé en DB, on le calcule à la volée
  const rendementNet =
    row.rendement_net_est ??
    (row.rendement_brut != null
      ? round2(
          row.rendement_brut *
            (1 -
              (hypotheses.vacance_pct +
                hypotheses.charges_pct +
                hypotheses.taxe_fonciere_pct) /
                100),
        )
      : null);

  // ── 4. Réponse ─────────────────────────────────────────────────────
  return NextResponse.json({
    rendement: {
      brut: row.rendement_brut,
      net_est: rendementNet,
      loyer_m2_median: row.loyer_m2_median,
      prix_m2_median: row.prix_m2_median,
      hypotheses: {
        vacance_pct: hypotheses.vacance_pct,
        charges_pct: hypotheses.charges_pct,
        taxe_fonciere_pct: hypotheses.taxe_fonciere_pct,
      },
    },
    zone: {
      zone_id: row.zone_id,
      code_commune: row.code_commune,
      type_local: row.type_local,
      nb_pieces_bucket: row.nb_pieces_bucket,
      loyer_source: row.loyer_source,
      loyer_quality: row.loyer_quality,
      loyer_annee: row.loyer_annee,
      loyer_n_obs: row.loyer_n_obs,
      prix_window: row.prix_window,
    },
    address: addressPayload,
    geocode_meta: geocodeMeta,
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function pickRow(
  rows: FactRow[] | null,
  clusterId: string | null,
  communeFallbackId: string,
): FactRow | null {
  if (!rows || rows.length === 0) return null;
  if (clusterId) {
    const clusterRow = rows.find((r) => r.zone_id === clusterId);
    if (clusterRow) return clusterRow;
  }
  return rows.find((r) => r.zone_id === communeFallbackId) ?? null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
