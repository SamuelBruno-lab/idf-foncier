import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { RENDEMENT_HABITABLE } from "@/lib/foncier-helpers";

const ADMIN_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Enrich parcels with real surface habitable from DPE (ADEME) and DVF,
 * falling back to BD TOPO estimation.
 *
 * Cascade priority:
 *   1. DPE (ADEME) — surface_habitable_logement
 *   2. DVF — surface_reelle_bati (from latest transaction)
 *   3. Estimation — existing_gfa_est × RENDEMENT_HABITABLE
 */

// ── ADEME DPE API ──────────────────────────────────────────────────────────

const DPE_API_BASE =
  "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines";

type DpeRecord = {
  surface_habitable_logement?: number;
  date_reception_dpe?: string;
  adresse_ban?: string;
  code_postal_ban?: string;
  nom_commune_ban?: string;
  identifiant_ban?: string;
  _geopoint?: string;
};

async function fetchDpeForCommune(
  insee: string,
  cityName: string
): Promise<DpeRecord[]> {
  const allRecords: DpeRecord[] = [];
  let after: string | null = null;
  const maxPages = 50; // safety limit
  let page = 0;

  while (page < maxPages) {
    const params = new URLSearchParams({
      q_fields: "nom_commune_ban,code_postal_ban",
      q: cityName,
      size: "1000",
      select:
        "surface_habitable_logement,date_reception_dpe,adresse_ban,code_postal_ban,nom_commune_ban,identifiant_ban,_geopoint",
      sort: "-date_reception_dpe",
    });

    // Filter by postal code prefix matching the INSEE code
    const deptCode = insee.startsWith("75") ? "75" : insee.substring(0, 2);
    params.set(
      "qs",
      `code_postal_ban:${deptCode}* AND nom_commune_ban:"${cityName}"`
    );

    if (after) {
      params.set("after", after);
    }

    const res = await fetch(`${DPE_API_BASE}?${params.toString()}`, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) break;

    const data = (await res.json()) as {
      results: DpeRecord[];
      next?: string;
    };

    if (!data.results || data.results.length === 0) break;
    allRecords.push(...data.results);

    // Parse "after" cursor from next URL
    if (data.next) {
      try {
        const nextUrl = new URL(data.next);
        after = nextUrl.searchParams.get("after");
        if (!after) break;
      } catch {
        break;
      }
    } else {
      break;
    }

    page++;
  }

  return allRecords;
}

// ── DVF surface lookup ─────────────────────────────────────────────────────

type DvfSurfaceRow = {
  id_parcelle: string;
  surface_reelle_bati: number | null;
  date_mutation: string | null;
};

async function fetchDvfSurfaces(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  insee: string
): Promise<Map<string, { surface: number; date: string | null }>> {
  const map = new Map<string, { surface: number; date: string | null }>();

  // Query DVF points that have a parcel ID matching this commune
  const { data } = await supabase
    .from("dvf_points")
    .select("id_parcelle,surface_reelle_bati,date_mutation")
    .like("id_parcelle", `${insee}%`)
    .not("surface_reelle_bati", "is", null)
    .gt("surface_reelle_bati", 0)
    .order("date_mutation", { ascending: false });

  if (data) {
    for (const row of data as DvfSurfaceRow[]) {
      if (!row.id_parcelle || !row.surface_reelle_bati) continue;
      // Keep only the most recent transaction per parcel
      if (!map.has(row.id_parcelle)) {
        map.set(row.id_parcelle, {
          surface: row.surface_reelle_bati,
          date: row.date_mutation,
        });
      }
    }
  }

  return map;
}

// ── Geocode matching: associate DPE records to parcels ─────────────────────

type ParcelGeo = {
  parcel_id: string;
  lat: number;
  lon: number;
  existing_gfa_est: number;
};

async function getParcelCentroids(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  insee: string
): Promise<ParcelGeo[]> {
  // Get parcel centroids in WGS84 for matching
  const { data } = await supabase.rpc("parcels_centroids_wgs84", {
    code_insee: insee,
  });

  if (!data) return [];
  return (data as { parcel_id: string; lat: number; lon: number; existing_gfa_est: number }[]).map(
    (r) => ({
      parcel_id: r.parcel_id,
      lat: r.lat,
      lon: r.lon,
      existing_gfa_est: r.existing_gfa_est ?? 0,
    })
  );
}

/**
 * Match DPE records to parcels by proximity (< 50m).
 * Returns a map: parcel_id -> { surface, count, latestDate }
 */
function matchDpeToParcels(
  dpeRecords: DpeRecord[],
  parcels: ParcelGeo[]
): Map<
  string,
  { totalSurface: number; count: number; latestDate: string | null }
> {
  const result = new Map<
    string,
    { totalSurface: number; count: number; latestDate: string | null }
  >();

  if (parcels.length === 0 || dpeRecords.length === 0) return result;

  const MAX_DIST_M = 50;

  for (const dpe of dpeRecords) {
    if (!dpe._geopoint || !dpe.surface_habitable_logement) continue;
    if (dpe.surface_habitable_logement <= 0) continue;

    const [latStr, lonStr] = dpe._geopoint.split(",");
    const dpeLat = parseFloat(latStr);
    const dpeLon = parseFloat(lonStr);
    if (isNaN(dpeLat) || isNaN(dpeLon)) continue;

    // Find closest parcel
    let bestDist = Infinity;
    let bestParcel: string | null = null;

    for (const p of parcels) {
      const dLat = (dpeLat - p.lat) * 111320;
      const dLon =
        (dpeLon - p.lon) * 111320 * Math.cos((p.lat * Math.PI) / 180);
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      if (dist < bestDist) {
        bestDist = dist;
        bestParcel = p.parcel_id;
      }
    }

    if (bestParcel && bestDist <= MAX_DIST_M) {
      const existing = result.get(bestParcel);
      if (existing) {
        existing.totalSurface += dpe.surface_habitable_logement;
        existing.count += 1;
        if (
          dpe.date_reception_dpe &&
          (!existing.latestDate ||
            dpe.date_reception_dpe > existing.latestDate)
        ) {
          existing.latestDate = dpe.date_reception_dpe;
        }
      } else {
        result.set(bestParcel, {
          totalSurface: dpe.surface_habitable_logement,
          count: 1,
          latestDate: dpe.date_reception_dpe ?? null,
        });
      }
    }
  }

  return result;
}

// ── Main endpoint ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const auth = req.headers.get("x-admin-key");
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    insee?: string;
  };
  const insee = body.insee;

  if (!insee || !/^\d{5}$/.test(insee)) {
    return NextResponse.json(
      { error: "Parametre 'insee' requis (5 chiffres)." },
      { status: 400 }
    );
  }

  const logs: string[] = [];
  const supabase = getSupabaseServerClient();

  try {
    // 1. Get city name
    let cityName = insee;
    try {
      const res = await fetch(
        `https://geo.api.gouv.fr/communes/${insee}?fields=nom`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const data = (await res.json()) as { nom?: string };
        cityName = data.nom ?? insee;
      }
    } catch {
      /* keep insee as fallback */
    }
    logs.push(`Commune: ${cityName} (${insee})`);

    // 2. Get parcel centroids for geo-matching
    const parcels = await getParcelCentroids(supabase, insee);
    logs.push(`Parcelles chargees: ${parcels.length}`);

    if (parcels.length === 0) {
      return NextResponse.json({
        success: false,
        logs,
        error: "Aucune parcelle trouvee. Executez le pipeline foncier d'abord.",
      });
    }

    // 3. Fetch DPE data from ADEME
    logs.push("Recuperation DPE ADEME...");
    let dpeRecords: DpeRecord[] = [];
    try {
      dpeRecords = await fetchDpeForCommune(insee, cityName);
      logs.push(`DPE recuperes: ${dpeRecords.length}`);
    } catch (e) {
      logs.push(
        `Erreur DPE: ${e instanceof Error ? e.message : String(e)}`
      );
    }

    // 4. Match DPE to parcels
    const dpeMatches = matchDpeToParcels(dpeRecords, parcels);
    logs.push(
      `Parcelles avec DPE: ${dpeMatches.size} / ${parcels.length}`
    );

    // 5. Fetch DVF surfaces
    logs.push("Recuperation surfaces DVF...");
    const dvfSurfaces = await fetchDvfSurfaces(supabase, insee);
    logs.push(`Parcelles avec DVF: ${dvfSurfaces.size}`);

    // 6. Build cascade and upsert
    let countDpe = 0;
    let countDvf = 0;
    let countEstimation = 0;
    const upsertRows: {
      parcel_id: string;
      surface_habitable_reelle: number;
      surface_hab_source: string;
      dpe_count: number;
      dpe_date_dernier: string | null;
      surface_dvf: number | null;
      dvf_date_derniere: string | null;
      surface_estimation: number;
    }[] = [];

    for (const p of parcels) {
      const estimation = Math.round(p.existing_gfa_est * RENDEMENT_HABITABLE);
      const dpe = dpeMatches.get(p.parcel_id);
      const dvf = dvfSurfaces.get(p.parcel_id);

      let surfaceReelle: number;
      let source: string;

      if (dpe && dpe.totalSurface > 0) {
        // Priority 1: DPE
        surfaceReelle = Math.round(dpe.totalSurface);
        source = "dpe";
        countDpe++;
      } else if (dvf && dvf.surface > 0) {
        // Priority 2: DVF
        surfaceReelle = Math.round(dvf.surface);
        source = "dvf";
        countDvf++;
      } else {
        // Priority 3: Estimation
        surfaceReelle = estimation;
        source = "estimation";
        countEstimation++;
      }

      upsertRows.push({
        parcel_id: p.parcel_id,
        surface_habitable_reelle: surfaceReelle,
        surface_hab_source: source,
        dpe_count: dpe?.count ?? 0,
        dpe_date_dernier: dpe?.latestDate ?? null,
        surface_dvf: dvf?.surface ?? null,
        dvf_date_derniere: dvf?.date ?? null,
        surface_estimation: estimation,
      });
    }

    logs.push(
      `Cascade: ${countDpe} DPE, ${countDvf} DVF, ${countEstimation} estimation`
    );

    // 7. Batch upsert
    const batchSize = 100;
    let upserted = 0;

    for (let i = 0; i < upsertRows.length; i += batchSize) {
      const batch = upsertRows.slice(i, i + batchSize);
      const { error } = await supabase
        .from("parcel_surface_habitable")
        .upsert(batch, { onConflict: "parcel_id" });

      if (error) {
        logs.push(`Upsert batch ${Math.floor(i / batchSize) + 1} erreur: ${error.message}`);
      } else {
        upserted += batch.length;
      }
    }

    logs.push(`Upsert: ${upserted} / ${upsertRows.length} parcelles`);

    return NextResponse.json({
      success: true,
      insee,
      stats: {
        total: parcels.length,
        dpe: countDpe,
        dvf: countDvf,
        estimation: countEstimation,
        dpe_records_fetched: dpeRecords.length,
      },
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
