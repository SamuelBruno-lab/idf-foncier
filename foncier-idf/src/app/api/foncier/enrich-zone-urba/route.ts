import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const ADMIN_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Ingere les VRAIES zones PLU (geometrie + destinations autorisees/
 * interdites) depuis l'API officielle IGN "GPU zone-urba" -- corrige le
 * fallback Phase 1 (une seule zone "union de toutes les parcelles" par
 * commune, destinations_autorisees jamais rempli) qui rendait le filtre
 * persona inoperant (memes parcelles pour logement/commerce/industrie).
 *
 * API testee en direct (2026-07) : accepte un `geom` GeoJSON (Point ou
 * Polygon) en WGS84, renvoie les zones intersectant avec leurs codes CNIG
 * destoui/destcdt/destnon (nomenclature R151-27/28) -- pas d'auth requise,
 * pas de cle API.
 */

const GPU_ZONE_URBA_URL = "https://apicarto.ign.fr/api/gpu/zone-urba";

// Codes CNIG officiels (R151-27/28), valides par recoupement empirique sur
// plusieurs familles de zones reelles (cf. sql/77_ingest_zone_urba_batch.sql
// pour le detail des verifications). Codes 37/46/47/55 rencontres dans les
// donnees mais non documentes dans le standard a 20 sous-destinations --
// volontairement non mappes plutot que devines.
const CNIG_CODE_TO_KEY: Record<string, string> = {
  "11": "agricole",
  "12": "forestier",
  "21": "logement",
  "22": "hebergement",
  "31": "commerce_detail",
  "32": "restauration",
  "33": "commerce_gros",
  "34": "activites_services",
  "35": "hebergement_hotelier",
  "36": "cinema",
  "41": "administration_publique",
  "42": "administration_publique",
  "43": "equipement_sante",
  "44": "salle_spectacle",
  "45": "salle_spectacle",
  "51": "industrie",
  "52": "entrepot",
  "53": "bureau",
  "54": "centre_congres",
};

function mapCodes(codes: string | null | undefined): string[] {
  if (!codes) return [];
  const mapped = codes
    .split("-")
    .map((c) => CNIG_CODE_TO_KEY[c.trim()])
    .filter((x): x is string => Boolean(x));
  return Array.from(new Set(mapped));
}

type GpuZoneFeature = {
  geometry: unknown;
  properties: {
    libelle: string;
    typezone: string | null;
    partition: string | null;
    destoui: string | null;
    destcdt: string | null;
    destnon: string | null;
  };
};

type BboxRow = { xmin: number; ymin: number; xmax: number; ymax: number };

export async function POST(req: NextRequest) {
  const auth = req.headers.get("x-admin-key");
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { insee?: string };
  const insee = body.insee;
  if (!insee) {
    return NextResponse.json({ error: "insee_required" }, { status: 400 });
  }

  const supabase = getSupabaseServerClient();

  // Bbox de la commune -- meme RPC que le pipeline BD TOPO (parcels_bbox),
  // suppose le cadastre deja ingere pour cette commune.
  const { data: bboxData } = await supabase.rpc("parcels_bbox", { code_insee: insee });
  const bbox = (Array.isArray(bboxData) ? bboxData[0] : bboxData) as BboxRow | null;
  if (!bbox?.xmin) {
    return NextResponse.json(
      { error: "bbox_not_found", message: "Cadastre non ingere pour cette commune (lancer step=ingest d'abord)." },
      { status: 400 }
    );
  }

  const geomParam = JSON.stringify({
    type: "Polygon",
    coordinates: [
      [
        [bbox.xmin, bbox.ymin],
        [bbox.xmax, bbox.ymin],
        [bbox.xmax, bbox.ymax],
        [bbox.xmin, bbox.ymax],
        [bbox.xmin, bbox.ymin],
      ],
    ],
  });

  let gpuRes: Response;
  try {
    gpuRes = await fetch(`${GPU_ZONE_URBA_URL}?${new URLSearchParams({ geom: geomParam })}`, {
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "gpu_api_unreachable", detail: e instanceof Error ? e.message : String(e) },
      { status: 502 }
    );
  }
  if (!gpuRes.ok) {
    return NextResponse.json(
      { error: "gpu_api_error", status: gpuRes.status },
      { status: 502 }
    );
  }

  const geojson = (await gpuRes.json()) as { features: GpuZoneFeature[] };
  const features = geojson.features ?? [];

  const zones = features.map((f) => {
    const p = f.properties;
    const autorisees = Array.from(new Set([...mapCodes(p.destoui), ...mapCodes(p.destcdt)]));
    const interdites = mapCodes(p.destnon);
    return {
      insee_code: insee,
      zone_libelle: p.libelle,
      zone_family: p.typezone,
      gpu_partition: p.partition,
      geojson: JSON.stringify(f.geometry),
      destinations_autorisees: autorisees,
      destinations_interdites: interdites,
    };
  });

  const batchSize = 100;
  let ingested = 0;
  const errors: string[] = [];
  for (let i = 0; i < zones.length; i += batchSize) {
    const batch = zones.slice(i, i + batchSize);
    const { error } = await supabase.rpc("ingest_zone_urba_batch", {
      zones_json: JSON.stringify(batch),
    });
    if (error) {
      errors.push(error.message);
    } else {
      ingested += batch.length;
    }
  }

  return NextResponse.json({
    insee,
    zones_found: zones.length,
    zones_ingested: ingested,
    zones_distinctes: new Set(zones.map((z) => z.zone_libelle)).size,
    errors: errors.length ? errors : undefined,
  });
}
