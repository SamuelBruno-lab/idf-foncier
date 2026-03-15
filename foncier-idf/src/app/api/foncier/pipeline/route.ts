import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const ADMIN_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Communes IDF departements
const IDF_DEPS = ["75", "77", "78", "91", "92", "93", "94", "95"];

// Ville name lookup (will be enriched by geo API)
async function getCityName(insee: string): Promise<string> {
  try {
    const res = await fetch(
      `https://geo.api.gouv.fr/communes/${insee}?fields=nom`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return insee;
    const data = (await res.json()) as { nom?: string };
    return data.nom ?? insee;
  } catch {
    return insee;
  }
}

// DVF median price fallback per department
const DVF_FALLBACK_PRICE: Record<string, number> = {
  "75": 10500,
  "92": 5800,
  "93": 3800,
  "94": 5200,
  "78": 3500,
  "91": 3200,
  "95": 3000,
  "77": 2800,
  "60": 2200, // Oise
};

type CadastreFeature = {
  properties: {
    id: string;
    commune: string;
    section: string;
    numero: string;
    contenance: number;
  };
  geometry: {
    type: string;
    coordinates: unknown;
  };
};

// BD TOPO WFS configuration
const WFS_BASE_URL = "https://data.geopf.fr/wfs/ows";
const WFS_TYPENAME = "BDTOPO_V3:batiment";
const WFS_PAGE_SIZE = 1000;
const FLOOR_HEIGHT_M = 3.0;

type BDTopoFeature = {
  properties: {
    cleabs: string;
    hauteur?: number | null;
    nombre_d_etages?: number | null;
    etat_de_l_objet?: string;
    usage_1?: string;
  };
  geometry: {
    type: string;
    coordinates: unknown;
  };
};

/**
 * Compute building levels from BD TOPO data.
 * Priority: hauteur (measured, most reliable) > nombre_d_etages > heuristic.
 */
function computeLevels(
  hauteur: number | null | undefined,
  nombreEtages: number | null | undefined,
  footprintM2: number
): number {
  // Prefer hauteur (measured from LiDAR/photogrammetry, most reliable)
  if (hauteur != null && hauteur > 0) {
    return Math.max(1, Math.floor(hauteur / FLOOR_HEIGHT_M));
  }

  // nombre_d_etages as secondary source
  if (nombreEtages != null && nombreEtages > 0) {
    return nombreEtages;
  }

  // Heuristic fallback based on footprint
  if (footprintM2 >= 2000) return 10;
  if (footprintM2 >= 800) return 6;
  if (footprintM2 >= 300) return 4;
  if (footprintM2 >= 100) return 2;
  return 1;
}

/**
 * Approximate footprint area in m² from WGS84 coordinates using
 * a simple latitude-based scaling (accurate enough for IDF region).
 */
function approxAreaM2(geojson: { type: string; coordinates: unknown }): number {
  try {
    // For a rough area, use the bounding box of the first polygon ring
    const coords = geojson.type === "MultiPolygon"
      ? (geojson.coordinates as number[][][][])[0][0]
      : geojson.type === "Polygon"
        ? (geojson.coordinates as number[][][])[0]
        : null;
    if (!coords || coords.length < 3) return 0;

    // Shoelace formula on projected coordinates
    const latMid = coords.reduce((s, c) => s + c[1], 0) / coords.length;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos((latMid * Math.PI) / 180);

    let area = 0;
    for (let i = 0; i < coords.length; i++) {
      const j = (i + 1) % coords.length;
      const xi = coords[i][0] * mPerDegLon;
      const yi = coords[i][1] * mPerDegLat;
      const xj = coords[j][0] * mPerDegLon;
      const yj = coords[j][1] * mPerDegLat;
      area += xi * yj - xj * yi;
    }
    return Math.abs(area) / 2;
  } catch {
    return 0;
  }
}

/**
 * Fetch all buildings from IGN BD TOPO WFS for a commune (paginated).
 */
async function fetchBDTopoBuildings(
  insee: string,
  bbox: string
): Promise<BDTopoFeature[]> {
  const allFeatures: BDTopoFeature[] = [];
  let startIndex = 0;

  while (true) {
    const params = new URLSearchParams({
      SERVICE: "WFS",
      VERSION: "2.0.0",
      REQUEST: "GetFeature",
      TYPENAME: WFS_TYPENAME,
      OUTPUTFORMAT: "application/json",
      SRSNAME: "EPSG:4326",
      BBOX: bbox,
      COUNT: String(WFS_PAGE_SIZE),
      STARTINDEX: String(startIndex),
      CQL_FILTER: `code_insee='${insee}'`,
    });

    const res = await fetch(`${WFS_BASE_URL}?${params.toString()}`, {
      signal: AbortSignal.timeout(120000),
    });

    if (!res.ok) {
      // Retry without CQL filter if it fails
      if (startIndex === 0) {
        const params2 = new URLSearchParams({
          SERVICE: "WFS",
          VERSION: "2.0.0",
          REQUEST: "GetFeature",
          TYPENAME: WFS_TYPENAME,
          OUTPUTFORMAT: "application/json",
          SRSNAME: "EPSG:4326",
          BBOX: bbox,
          COUNT: String(WFS_PAGE_SIZE),
          STARTINDEX: String(startIndex),
        });
        const res2 = await fetch(`${WFS_BASE_URL}?${params2.toString()}`, {
          signal: AbortSignal.timeout(120000),
        });
        if (!res2.ok) break;
        const data = (await res2.json()) as { features: BDTopoFeature[] };
        allFeatures.push(...data.features);
        if (data.features.length < WFS_PAGE_SIZE) break;
        startIndex += WFS_PAGE_SIZE;
        continue;
      }
      break;
    }

    const data = (await res.json()) as { features: BDTopoFeature[] };
    allFeatures.push(...data.features);

    if (data.features.length < WFS_PAGE_SIZE) break;
    startIndex += WFS_PAGE_SIZE;
  }

  return allFeatures;
}

/**
 * Get WGS84 bbox string for a commune from parcels in Supabase.
 */
async function getCommuneBbox(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  insee: string
): Promise<string | null> {
  const { data } = await supabase.rpc("parcels_bbox", { code_insee: insee });
  if (data) {
    const d = Array.isArray(data) ? data[0] : data;
    if (d?.xmin != null && d?.ymin != null && d?.xmax != null && d?.ymax != null) {
      // WFS bbox is lat,lon order
      return `${d.ymin},${d.xmin},${d.ymax},${d.xmax},EPSG:4326`;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  // Auth
  const auth = req.headers.get("x-admin-key");
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    insee?: string;
    step?: string;
  };
  const insee = body.insee;
  const step = body.step ?? "all"; // "ingest", "score", "all"

  if (!insee || !/^\d{5}$/.test(insee)) {
    return NextResponse.json(
      { error: "Paramètre 'insee' requis (5 chiffres)." },
      { status: 400 }
    );
  }

  const dep = insee.startsWith("75") ? "75" : insee.substring(0, 2);
  if (!IDF_DEPS.includes(dep) && dep !== "60") {
    return NextResponse.json(
      { error: `Commune ${insee} hors IDF+Oise.` },
      { status: 400 }
    );
  }

  const logs: string[] = [];
  const supabase = getSupabaseServerClient();

  try {
    // ===== STEP 1: Ingest cadastre =====
    if (step === "all" || step === "ingest") {
      logs.push(`Fetching cadastre for ${insee}...`);

      const cadastreUrl = `https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/${insee}/geojson/parcelles`;
      const res = await fetch(cadastreUrl, {
        signal: AbortSignal.timeout(30000),
        headers: { "Accept-Encoding": "gzip" },
      });

      if (!res.ok) {
        logs.push(`Cadastre API error: ${res.status}`);
        return NextResponse.json(
          { success: false, logs, error: `Cadastre API returned ${res.status}` },
          { status: 502 }
        );
      }

      const geojson = (await res.json()) as {
        features: CadastreFeature[];
      };
      const features = geojson.features;
      logs.push(`Fetched ${features.length} parcels from cadastre`);

      const cityName = await getCityName(insee);
      logs.push(`City: ${cityName}`);

      // Delete existing parcels for this commune (cascade will clean scores)
      const { error: delErr } = await supabase
        .from("parcels")
        .delete()
        .eq("insee_code", insee);
      if (delErr) {
        logs.push(`Warning: delete existing parcels: ${delErr.message}`);
      }

      // Insert parcels via the SQL function (handles ST_Transform)
      // We batch via RPC to handle geometry transformation server-side
      const batchSize = 100;
      let inserted = 0;

      for (let i = 0; i < features.length; i += batchSize) {
        const batch = features.slice(i, i + batchSize);
        const parcelsJson = batch.map((f) => ({
          parcel_id: f.properties.id,
          insee_code: f.properties.commune,
          section: f.properties.section,
          number: f.properties.numero,
          area_m2: f.properties.contenance,
          city_name: cityName,
          geojson: JSON.stringify(f.geometry),
        }));

        const { error: rpcErr } = await supabase.rpc(
          "ingest_cadastre_batch",
          { parcels_json: JSON.stringify(parcelsJson) }
        );

        if (rpcErr) {
          logs.push(
            `Batch ${Math.floor(i / batchSize) + 1} error: ${rpcErr.message}`
          );
          // Try to continue with next batch
        } else {
          inserted += batch.length;
        }
      }

      logs.push(`Inserted ${inserted}/${features.length} parcels`);

      // ===== STEP 1b: Ingest BD TOPO buildings =====
      logs.push(`Fetching BD TOPO buildings for ${insee}...`);

      const bbox = await getCommuneBbox(supabase, insee);
      if (!bbox) {
        logs.push("Warning: could not determine commune bbox, skipping buildings");
      } else {
        const bdtopoFeatures = await fetchBDTopoBuildings(insee, bbox);
        logs.push(`Fetched ${bdtopoFeatures.length} buildings from BD TOPO WFS`);

        // Delete existing buildings for this commune
        const { error: delBldErr } = await supabase
          .from("buildings")
          .delete()
          .eq("insee_code", insee);
        if (delBldErr) {
          logs.push(`Warning: delete existing buildings: ${delBldErr.message}`);
        }

        // Process and insert buildings
        const buildingBatchSize = 50;
        let bldInserted = 0;
        let bldSkipped = 0;

        const validBuildings = bdtopoFeatures.filter((f) => {
          if (f.properties.etat_de_l_objet === "En projet") return false;
          if (!f.geometry) return false;
          return true;
        });

        for (let i = 0; i < validBuildings.length; i += buildingBatchSize) {
          const batch = validBuildings.slice(i, i + buildingBatchSize);
          const buildingsJson = batch.map((f) => {
            const footprint = approxAreaM2(f.geometry);
            const levels = computeLevels(
              f.properties.hauteur,
              f.properties.nombre_d_etages,
              footprint
            );
            return {
              building_id: f.properties.cleabs || `BDTOPO_${insee}_${i}_${bldInserted}`,
              source: "BDTOPO",
              levels_est: levels,
              footprint_m2: Math.round(footprint * 10) / 10,
              insee_code: insee,
              geojson: JSON.stringify(f.geometry),
            };
          });

          const { error: bldErr } = await supabase.rpc(
            "ingest_buildings_batch",
            { buildings_json: JSON.stringify(buildingsJson) }
          );

          if (bldErr) {
            bldSkipped += batch.length;
            if (bldSkipped <= buildingBatchSize) {
              logs.push(`Buildings batch error: ${bldErr.message}`);
            }
          } else {
            bldInserted += batch.length;
          }
        }

        logs.push(
          `Inserted ${bldInserted}/${validBuildings.length} buildings (${bldSkipped} errors)`
        );

        // Log height data quality
        const withHeight = bdtopoFeatures.filter(
          (f) => f.properties.hauteur != null && f.properties.hauteur > 0
        ).length;
        const withFloors = bdtopoFeatures.filter(
          (f) =>
            f.properties.nombre_d_etages != null &&
            f.properties.nombre_d_etages > 0
        ).length;
        logs.push(
          `Height data: ${withHeight} with hauteur, ${withFloors} with nombre_d_etages (of ${bdtopoFeatures.length})`
        );
      }
    }

    // ===== STEP 2: Score =====
    if (step === "all" || step === "score") {
      logs.push(`Scoring ${insee}...`);

      // Get DVF median price for this commune
      let medianPrice =
        DVF_FALLBACK_PRICE[dep] ?? 3000;

      // Try to get real DVF price from existing clusters
      const { data: dvfData } = await supabase
        .from("dvf_clusters_commune")
        .select("prix_m2_median,count")
        .like("cluster_id", `${insee}_%`)
        .order("count", { ascending: false })
        .limit(1);

      if (dvfData && dvfData.length > 0 && dvfData[0].prix_m2_median != null) {
        medianPrice = dvfData[0].prix_m2_median;
        logs.push(`DVF price found: ${medianPrice} €/m²`);
      } else {
        logs.push(`DVF fallback price: ${medianPrice} €/m² (dept ${dep})`);
      }

      // Run scoring via RPC
      const { data: scoreResult, error: scoreErr } = await supabase.rpc(
        "score_commune_parcels",
        {
          p_insee: insee,
          p_median_price: medianPrice,
        }
      );

      if (scoreErr) {
        logs.push(`Scoring error: ${scoreErr.message}`);
        return NextResponse.json(
          { success: false, logs, error: scoreErr.message },
          { status: 500 }
        );
      }

      logs.push(`Scored: ${scoreResult ?? "?"} parcels`);
    }

    // Count final results
    const { count } = await supabase
      .from("parcel_scores")
      .select("parcel_id", { count: "exact", head: true })
      .like("parcel_id", `${insee}%`);

    logs.push(`Total scored parcels for ${insee}: ${count ?? 0}`);

    return NextResponse.json({
      success: true,
      insee,
      scored: count ?? 0,
      logs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logs.push(`FATAL: ${msg}`);
    return NextResponse.json(
      { success: false, logs, error: msg },
      { status: 500 }
    );
  }
}
