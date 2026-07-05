import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const ADMIN_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Enrich parcels with DPE "passoire thermique" (F/G) flags, at BUILDING
 * grain (copropriete probable vs maison individuelle) then matched to
 * parcels by proximity — same pattern as enrich-surface/route.ts.
 *
 * IMPORTANT : dataset ADEME different de enrich-surface. "dpe03existant"
 * (deja utilise par enrich-surface pour surface_habitable_logement)
 * n'expose NI id_rnb NI numero_dpe_immeuble_associe (verifie ce soir) —
 * inutilisable pour un vrai regroupement par batiment. On utilise donc
 * "meg-83tjwtg8dyz4vv7h1dqe" ("DPE Logements existants depuis juillet
 * 2021"), qui expose ces deux champs (taux de remplissage observe sur
 * Vitry : id_rnb 5%, numero_dpe_immeuble_associe 82%, adresse_ban 100%).
 *
 * Rattachement au foncier : DIRECT point-groupe-DPE -> parcelle (comme le
 * prototype Python valide ce soir), PAS via la table buildings (BD TOPO),
 * qui n'expose aucun identifiant comparable au DPE (pas de id_rnb/cleabs).
 */

const DPE_API_BASE =
  "https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines";

const MAX_DIST_M = 50; // meme tolerance que enrich-surface (coherence codebase)
const PASSOIRE_RATIO_THRESHOLD = 0.5; // >= 50% d'etiquettes F/G -> "passoire"

type DpeFgRecord = {
  etiquette_dpe?: string; // A-G
  id_rnb?: string | null;
  numero_dpe_immeuble_associe?: string | null;
  adresse_ban?: string;
  _geopoint?: string;
};

async function fetchDpeFgForCommune(insee: string): Promise<DpeFgRecord[]> {
  const allRecords: DpeFgRecord[] = [];
  let after: string | null = null;
  const maxPages = 200; // garde-fou anti-boucle (communes denses type Paris ~800k DPE)
  let page = 0;

  while (page < maxPages) {
    const params = new URLSearchParams({
      qs: `code_insee_ban:${insee}`,
      size: "1000",
      select:
        "etiquette_dpe,id_rnb,numero_dpe_immeuble_associe,adresse_ban,_geopoint",
    });
    if (after) params.set("after", after);

    const res = await fetch(`${DPE_API_BASE}?${params.toString()}`, {
      signal: AbortSignal.timeout(30000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) break;

    const data = (await res.json()) as { results: DpeFgRecord[]; next?: string };
    if (!data.results || data.results.length === 0) break;
    allRecords.push(...data.results);

    if (data.next) {
      try {
        after = new URL(data.next).searchParams.get("after");
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

function normalizeAddress(a?: string): string {
  return (a ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

type BuildingGroup = {
  buildingKey: string;
  lon: number | null;
  lat: number | null;
  nLogements: number;
  nPassoire: number;
  matchingMethod: "id_rnb" | "numero_dpe_immeuble" | "adresse";
};

/** Port direct de dpe_batiment_dept.py: group_by_batiment + computeBuildingFlags. */
function groupByBuilding(records: DpeFgRecord[]): Map<string, BuildingGroup> {
  const groups = new Map<string, BuildingGroup>();
  for (const r of records) {
    const key = r.id_rnb || r.numero_dpe_immeuble_associe || normalizeAddress(r.adresse_ban);
    if (!key) continue;
    const method: BuildingGroup["matchingMethod"] = r.id_rnb
      ? "id_rnb"
      : r.numero_dpe_immeuble_associe
        ? "numero_dpe_immeuble"
        : "adresse";

    let g = groups.get(key);
    if (!g) {
      g = { buildingKey: key, lon: null, lat: null, nLogements: 0, nPassoire: 0, matchingMethod: method };
      groups.set(key, g);
    }
    g.nLogements += 1;
    if (r.etiquette_dpe === "F" || r.etiquette_dpe === "G") g.nPassoire += 1;
    if (g.lon === null && r._geopoint) {
      const [latStr, lonStr] = r._geopoint.split(",");
      const lat = parseFloat(latStr);
      const lon = parseFloat(lonStr);
      if (!isNaN(lat) && !isNaN(lon)) {
        g.lat = lat;
        g.lon = lon;
      }
    }
  }
  return groups;
}

type ParcelGeo = { parcel_id: string; lat: number; lon: number };

async function getParcelCentroids(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  insee: string
): Promise<ParcelGeo[]> {
  const { data } = await supabase.rpc("parcels_centroids_wgs84", { code_insee: insee });
  if (!data) return [];
  return (data as { parcel_id: string; lat: number; lon: number }[]).map((r) => ({
    parcel_id: r.parcel_id,
    lat: r.lat,
    lon: r.lon,
  }));
}

/** Meme calcul de distance approx que matchDpeToParcels (enrich-surface). */
function nearestParcel(lat: number, lon: number, parcels: ParcelGeo[]): { parcelId: string; dist: number } | null {
  let bestDist = Infinity;
  let bestParcel: string | null = null;
  for (const p of parcels) {
    const dLat = (lat - p.lat) * 111320;
    const dLon = (lon - p.lon) * 111320 * Math.cos((p.lat * Math.PI) / 180);
    const dist = Math.sqrt(dLat * dLat + dLon * dLon);
    if (dist < bestDist) {
      bestDist = dist;
      bestParcel = p.parcel_id;
    }
  }
  return bestParcel ? { parcelId: bestParcel, dist: bestDist } : null;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("x-admin-key");
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { insee?: string };
  const insee = body.insee;
  if (!insee || !/^\d{5}$/.test(insee)) {
    return NextResponse.json({ error: "Parametre 'insee' requis (5 chiffres)." }, { status: 400 });
  }

  const logs: string[] = [];
  const supabase = getSupabaseServerClient();

  try {
    logs.push(`Commune: ${insee}`);

    const parcels = await getParcelCentroids(supabase, insee);
    logs.push(`Parcelles chargees: ${parcels.length}`);
    if (parcels.length === 0) {
      return NextResponse.json({
        success: false,
        logs,
        error: "Aucune parcelle trouvee. Executez le pipeline foncier d'abord.",
      });
    }

    logs.push("Recuperation DPE ADEME (dataset meg-83tjwtg8dyz4vv7h1dqe)...");
    const dpeRecords = await fetchDpeFgForCommune(insee);
    logs.push(`DPE recuperes: ${dpeRecords.length}`);

    const groups = groupByBuilding(dpeRecords);
    logs.push(`Batiments groupes: ${groups.size}`);

    // 1. Upsert dpe_batiment_groupes (grain natif, tracabilite)
    const groupeRows = Array.from(groups.values()).map((g) => {
      const ratio = g.nLogements > 0 ? g.nPassoire / g.nLogements : 0;
      const copro = g.nLogements >= 2;
      const passoire = ratio >= PASSOIRE_RATIO_THRESHOLD;
      return {
        building_key: g.buildingKey,
        insee_code: insee,
        lon: g.lon,
        lat: g.lat,
        dpe_total_count: g.nLogements,
        dpe_fg_count: g.nPassoire,
        dpe_fg_ratio: ratio,
        copropriete_probable: copro,
        nb_logements_estime: g.nLogements,
        dpe_passoire: passoire,
        dpe_passoire_copro: passoire && copro,
        dpe_passoire_maison: passoire && !copro,
        matching_method: g.matchingMethod,
      };
    });

    let upsertedGroupes = 0;
    const batchSize = 500;
    for (let i = 0; i < groupeRows.length; i += batchSize) {
      const batch = groupeRows.slice(i, i + batchSize);
      const { error } = await supabase
        .from("dpe_batiment_groupes")
        .upsert(batch, { onConflict: "insee_code,building_key" });
      if (error) {
        logs.push(`Upsert groupes batch ${Math.floor(i / batchSize) + 1} erreur: ${error.message}`);
      } else {
        upsertedGroupes += batch.length;
      }
    }
    logs.push(`dpe_batiment_groupes upsert: ${upsertedGroupes} / ${groupeRows.length}`);

    // 2. Rattachement DIRECT groupe -> parcelle la plus proche (< 50 m),
    //    meme pattern que matchDpeToParcels (enrich-surface).
    const parcelFlags = new Map<
      string,
      { any: boolean; copro: boolean; maison: boolean; nPassoire: number }
    >();
    let matched = 0;

    for (const row of groupeRows) {
      if (row.lon === null || row.lat === null) continue;
      const nearest = nearestParcel(row.lat, row.lon, parcels);
      if (!nearest || nearest.dist > MAX_DIST_M) continue;
      matched++;

      const existing = parcelFlags.get(nearest.parcelId) ?? {
        any: false,
        copro: false,
        maison: false,
        nPassoire: 0,
      };
      if (row.dpe_passoire) {
        existing.any = true;
        existing.nPassoire += 1;
        if (row.dpe_passoire_copro) existing.copro = true;
        if (row.dpe_passoire_maison) existing.maison = true;
      }
      parcelFlags.set(nearest.parcelId, existing);
    }
    logs.push(`Groupes rattaches a une parcelle (< ${MAX_DIST_M} m): ${matched} / ${groupeRows.length}`);

    const parcelRows = Array.from(parcelFlags.entries()).map(([parcelId, f]) => ({
      parcel_id: parcelId,
      dpe_passoire_any: f.any,
      dpe_passoire_copro: f.copro,
      dpe_passoire_maison: f.maison,
      nb_groupes_passoire: f.nPassoire,
      updated_at: new Date().toISOString(),
    }));

    let upsertedParcels = 0;
    for (let i = 0; i < parcelRows.length; i += batchSize) {
      const batch = parcelRows.slice(i, i + batchSize);
      const { error } = await supabase
        .from("parcel_dpe_stats")
        .upsert(batch, { onConflict: "parcel_id" });
      if (error) {
        logs.push(`Upsert parcel_dpe_stats batch ${Math.floor(i / batchSize) + 1} erreur: ${error.message}`);
      } else {
        upsertedParcels += batch.length;
      }
    }
    logs.push(`parcel_dpe_stats upsert: ${upsertedParcels} / ${parcelRows.length}`);

    const nPassoireCopro = groupeRows.filter((g) => g.dpe_passoire_copro).length;
    const nPassoireMaison = groupeRows.filter((g) => g.dpe_passoire_maison).length;

    return NextResponse.json({
      success: true,
      insee,
      stats: {
        parcelles_total: parcels.length,
        dpe_records_fetched: dpeRecords.length,
        batiments_groupes: groups.size,
        batiments_passoire_copro: nPassoireCopro,
        batiments_passoire_maison: nPassoireMaison,
        parcelles_avec_passoire: parcelRows.filter((p) => p.dpe_passoire_any).length,
      },
      logs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logs.push(`FATAL: ${msg}`);
    return NextResponse.json({ success: false, logs, error: msg }, { status: 500 });
  }
}
