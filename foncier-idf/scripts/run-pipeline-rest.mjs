/**
 * Pipeline foncier ICH via Supabase REST API (curl-based, proxy-compatible).
 * Usage: node scripts/run-pipeline-rest.mjs [--insee 92078]
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = readFileSync(resolve(__dirname, "../.env.local"), "utf8");
for (const line of envFile.split("\n")) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── Supabase REST helper (via curl) ────────────────────────────
function supabaseGet(table, params = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const out = execSync(`curl -s "${url}" -H "apikey: ${SERVICE_KEY}" -H "Authorization: Bearer ${SERVICE_KEY}"`, {
    maxBuffer: 50 * 1024 * 1024,
    timeout: 60000,
  });
  return JSON.parse(out.toString());
}

function supabaseUpsert(table, rows) {
  const tmpFile = `/tmp/supabase_upsert_${Date.now()}.json`;
  writeFileSync(tmpFile, JSON.stringify(rows));
  try {
    const out = execSync(
      `curl -s -X POST "${SUPABASE_URL}/rest/v1/${table}" ` +
      `-H "apikey: ${SERVICE_KEY}" ` +
      `-H "Authorization: Bearer ${SERVICE_KEY}" ` +
      `-H "Content-Type: application/json" ` +
      `-H "Prefer: resolution=merge-duplicates" ` +
      `-d @${tmpFile}`,
      { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }
    );
    const text = out.toString().trim();
    if (text && text.startsWith("{") && text.includes("error")) {
      const err = JSON.parse(text);
      if (err.code) return { error: err };
    }
    return { error: null };
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}

function fetchAllPaginated(table, filter, select) {
  const PAGE = 1000;
  let all = [];
  let offset = 0;
  while (true) {
    const params = `select=${encodeURIComponent(select)}&${filter}&offset=${offset}&limit=${PAGE}`;
    const data = supabaseGet(table, params);
    if (!Array.isArray(data)) throw new Error(`${table}: ${JSON.stringify(data)}`);
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return all;
}

// ─── ICH Bilan Parameters ───────────────────────────────────────
const CONSTRUCTION_COST_M2 = 1800;
const VRD_COST_M2_TERRAIN = 100;
const SELLABLE_RATIO = 0.75;
const MARGIN_RATIO = 0.08;
const COMMERCIALISATION_RATIO = 0.025;
const FRAIS_FINANCIERS_RATIO = 0.06;
const PARKING_COST_PER_PLACE = 13500;
const TAXE_VALEUR_FORFAITAIRE = 854;
const TAXE_TAUX_DEFAULT = 0.05;

const PLU_RULES = {
  UA: { vocation: "mixte",       max_height: 25, ces: 0.80, green_ratio: 0.10, setback_front: 0, setback_side: 0, parking_avg: 1.3 },
  UB: { vocation: "residentiel", max_height: 18, ces: 0.60, green_ratio: 0.20, setback_front: 3, setback_side: 3, parking_avg: 1.3 },
  UC: { vocation: "residentiel", max_height: 12, ces: 0.40, green_ratio: 0.30, setback_front: 5, setback_side: 3, parking_avg: 1.3 },
  UD: { vocation: "residentiel", max_height: 9,  ces: 0.30, green_ratio: 0.40, setback_front: 5, setback_side: 4, parking_avg: 1.2 },
  UE: { vocation: "economique",  max_height: 15, ces: 0.60, green_ratio: 0.15, setback_front: 5, setback_side: 5, parking_avg: 0 },
  UX: { vocation: "economique",  max_height: 20, ces: 0.65, green_ratio: 0.15, setback_front: 5, setback_side: 5, parking_avg: 0 },
  UP: { vocation: "mixte",       max_height: 50, ces: 0.70, green_ratio: 0.15, setback_front: 0, setback_side: 0, parking_avg: 1.3 },
  AU: { vocation: "mixte",       max_height: 15, ces: 0.50, green_ratio: 0.25, setback_front: 5, setback_side: 4, parking_avg: 1.3 },
  A:  { vocation: "residentiel", max_height: 7,  ces: 0.10, green_ratio: 0.70, setback_front: 10, setback_side: 5, parking_avg: 1.1 },
  N:  { vocation: "residentiel", max_height: 7,  ces: 0.05, green_ratio: 0.80, setback_front: 10, setback_side: 10, parking_avg: 0 },
};

function assignPluZone(coverageRatio, zoneFamily) {
  if (zoneFamily === "A") return "A";
  if (zoneFamily === "N") return "N";
  if (zoneFamily === "AU") return "AU";
  if (coverageRatio >= 0.65) return "UA";
  if (coverageRatio >= 0.45) return "UB";
  if (coverageRatio >= 0.25) return "UC";
  return "UD";
}

function computeSetbackPenalty(area, setbackFront, setbackSide) {
  if (!area || area <= 0) return 1.0;
  const side = Math.sqrt(area);
  const effectiveW = Math.max(side - 2 * setbackSide, side * 0.3);
  const effectiveD = Math.max(side - setbackFront, side * 0.3);
  return (effectiveW * effectiveD) / (side * side);
}

async function main() {
  const insee = process.argv.includes("--insee")
    ? process.argv[process.argv.indexOf("--insee") + 1]
    : "92078";

  console.log(`=== Pipeline ICH via REST — insee=${insee} ===`);

  // 1. Fetch parcels
  console.log("[1/5] Fetching parcels...");
  const parcels = fetchAllPaginated("parcels",
    `insee_code=eq.${insee}`,
    "parcel_id,insee_code,area_m2,city_name"
  );
  console.log(`  → ${parcels.length} parcels`);
  if (parcels.length === 0) { console.log("No parcels found. Exiting."); return; }

  // 2. Fetch building stats
  console.log("[2/5] Fetching building stats...");
  const parcelIds = parcels.map(p => p.parcel_id);
  // Supabase REST: use IN filter with batched requests
  const bsMap = {};
  const BS_BATCH = 200;
  for (let i = 0; i < parcelIds.length; i += BS_BATCH) {
    const batch = parcelIds.slice(i, i + BS_BATCH);
    const inFilter = `parcel_id=in.(${batch.map(id => `"${id}"`).join(",")})`;
    const data = supabaseGet("parcel_building_stats",
      `select=${encodeURIComponent("parcel_id,total_building_area_m2,max_building_height,coverage_ratio,building_count")}&${inFilter}`
    );
    if (Array.isArray(data)) data.forEach(b => { bsMap[b.parcel_id] = b; });
  }
  console.log(`  → ${Object.keys(bsMap).length} building stats`);

  // 3. Fetch market stats
  console.log("[3/5] Fetching market stats...");
  const msMap = {};
  for (let i = 0; i < parcelIds.length; i += BS_BATCH) {
    const batch = parcelIds.slice(i, i + BS_BATCH);
    const inFilter = `parcel_id=in.(${batch.map(id => `"${id}"`).join(",")})`;
    const data = supabaseGet("parcel_market_stats",
      `select=${encodeURIComponent("parcel_id,median_price_m2,hdbscan_zone_id")}&${inFilter}`
    );
    if (Array.isArray(data)) data.forEach(m => { msMap[m.parcel_id] = m; });
  }
  console.log(`  → ${Object.keys(msMap).length} market stats`);

  // 4. Fetch constructibility
  console.log("[4/5] Fetching constructibility...");
  const cMap = {};
  for (let i = 0; i < parcelIds.length; i += BS_BATCH) {
    const batch = parcelIds.slice(i, i + BS_BATCH);
    const inFilter = `parcel_id=in.(${batch.map(id => `"${id}"`).join(",")})`;
    const data = supabaseGet("parcel_constructibility",
      `select=${encodeURIComponent("parcel_id,estimated_gfa,max_height_est,max_footprint_ratio_est,dominant_zone_family,underuse_ratio,residual_potential_est")}&${inFilter}`
    );
    if (Array.isArray(data)) data.forEach(c => { cMap[c.parcel_id] = c; });
  }
  console.log(`  → ${Object.keys(cMap).length} constructibility records`);

  // 5. Compute ICH bilan scores
  console.log("[5/5] Computing ICH bilan + scores...");
  const scoreRows = [];
  const constUpdates = [];

  for (const p of parcels) {
    const bs = bsMap[p.parcel_id] || {};
    const ms = msMap[p.parcel_id] || {};
    const cn = cMap[p.parcel_id] || {};

    const area = p.area_m2 || 0;
    const coverageRatio = bs.coverage_ratio ?? 0;
    const zoneFamily = cn.dominant_zone_family || "U";

    const pluZoneCode = assignPluZone(coverageRatio, zoneFamily);
    const plu = PLU_RULES[pluZoneCode] || PLU_RULES.UC;

    const cesApplied = plu.ces;
    const maxHeight = plu.max_height;
    const greenRatio = plu.green_ratio;
    const setbackPenalty = computeSetbackPenalty(area, plu.setback_front, plu.setback_side);
    const buildableFootprint = area * cesApplied * (1 - greenRatio) * setbackPenalty;
    const floors = Math.max(1, Math.floor(maxHeight / 3));
    const estimatedGfa = buildableFootprint * floors;

    const existingArea = bs.total_building_area_m2 || 0;
    const residual = Math.max(0, estimatedGfa - existingArea);
    const underuseRatio = estimatedGfa > 0 ? residual / estimatedGfa : 0;

    const medianPrice = ms.median_price_m2 || 4500;

    // === ICH Bilan Promoteur ===
    const surfaceHabitable = estimatedGfa * SELLABLE_RATIO;
    const caTotal = surfaceHabitable * medianPrice;

    const marge = MARGIN_RATIO * caTotal;
    const coutConstruction = CONSTRUCTION_COST_M2 * estimatedGfa;
    const coutVrd = VRD_COST_M2_TERRAIN * area;
    const coutPublicite = COMMERCIALISATION_RATIO * caTotal;
    const coutDette = FRAIS_FINANCIERS_RATIO * (coutConstruction + coutPublicite + coutVrd);

    const nbLogements = plu.vocation === "economique" ? 0 : Math.max(1, Math.round(estimatedGfa / 60));
    const nbParking = Math.round(nbLogements * plu.parking_avg);
    const parkingCost = nbParking * PARKING_COST_PER_PLACE;

    const taxeAmenagement = estimatedGfa * TAXE_VALEUR_FORFAITAIRE * TAXE_TAUX_DEFAULT;

    const totalDepenses = marge + coutConstruction + coutVrd + coutPublicite + coutDette + parkingCost + taxeAmenagement;
    const chargeFonciere = caTotal - totalDepenses;
    const chargeFonciereM2 = area > 0 ? chargeFonciere / area : 0;
    const prixParLogement = nbLogements > 0 ? caTotal / nbLogements : 0;

    // === Scores ===
    const sizeScore = area <= 200 ? 2 : area <= 500 ? 5 : area <= 1000 ? 7 : area <= 2000 ? 9 : 10;
    const underuseScore = Math.min(10, underuseRatio * 12);
    const marketScore = Math.min(10, medianPrice / 1000);
    const zoningScore = zoneFamily === "U" ? 8 : zoneFamily === "AU" ? 6 : 2;
    const landValueScore = chargeFonciere > 0
      ? (chargeFonciereM2 <= 100 ? 3 : chargeFonciereM2 <= 300 ? 5 : chargeFonciereM2 <= 600 ? 7 : 9)
      : 0;

    const mutabilityScore = Math.min(10, Math.max(0,
      0.25 * sizeScore + 0.30 * underuseScore + 0.15 * marketScore + 0.10 * zoningScore + 0.20 * landValueScore
    ));

    let bestUse;
    if (plu.vocation === "economique") {
      bestUse = estimatedGfa > 1000 ? "activite_economique" : "bureaux_commerces";
    } else if (area < 300) {
      bestUse = "division_parcellaire";
    } else if (coverageRatio < 0.05 && area > 500) {
      bestUse = "dent_creuse";
    } else if (underuseRatio > 0.4) {
      bestUse = "densification_residentielle";
    } else {
      bestUse = "analyse_complementaire";
    }

    const explanationJson = {
      plu_zone_code: pluZoneCode, zone_vocation: plu.vocation,
      ces_applied: cesApplied, max_height_est: maxHeight,
      setback_front_m: plu.setback_front, setback_side_m: plu.setback_side,
      coverage_ratio: parseFloat(coverageRatio.toFixed(3)),
      buildable_footprint: Math.round(buildableFootprint),
      floors_est: floors, estimated_gfa: Math.round(estimatedGfa),
      surface_habitable: Math.round(surfaceHabitable),
      residual_potential: Math.round(residual),
      underuse_ratio: parseFloat(underuseRatio.toFixed(3)),
      median_price_m2: medianPrice,
      ca_total: Math.round(caTotal),
      marge_promoteur: Math.round(marge),
      cout_construction: Math.round(coutConstruction),
      cout_vrd: Math.round(coutVrd),
      cout_publicite: Math.round(coutPublicite),
      cout_dette: Math.round(coutDette),
      nb_logements_est: nbLogements,
      nb_parking_places: nbParking,
      cout_parking: Math.round(parkingCost),
      taxe_amenagement: Math.round(taxeAmenagement),
      taxe_amenagement_taux: TAXE_TAUX_DEFAULT,
      total_depenses: Math.round(totalDepenses),
      charge_fonciere: Math.round(chargeFonciere),
      charge_fonciere_m2_terrain: Math.round(chargeFonciereM2),
      prix_par_logement: Math.round(prixParLogement),
      method: "ICH_bilan_promoteur_v2",
      construction_cost_m2: CONSTRUCTION_COST_M2,
    };

    scoreRows.push({
      parcel_id: p.parcel_id,
      mutability_score: parseFloat(mutabilityScore.toFixed(2)),
      size_score: parseFloat(sizeScore.toFixed(2)),
      underuse_score: parseFloat(underuseScore.toFixed(2)),
      market_score: parseFloat(marketScore.toFixed(2)),
      zoning_score: parseFloat(zoningScore.toFixed(2)),
      land_value_score: parseFloat(landValueScore.toFixed(2)),
      land_value_est: Math.round(chargeFonciere),
      program_value_est: Math.round(caTotal),
      best_use: bestUse,
      explanation_json: explanationJson,
      computed_at: new Date().toISOString(),
    });

    constUpdates.push({
      parcel_id: p.parcel_id,
      estimated_gfa: Math.round(estimatedGfa),
      max_height_est: maxHeight,
      max_footprint_ratio_est: cesApplied,
      buildable_footprint_est: Math.round(buildableFootprint),
      floors_est: floors,
      setback_penalty_est: parseFloat(setbackPenalty.toFixed(3)),
      parking_penalty_est: 1.0,
      min_green_ratio_est: greenRatio,
      underuse_ratio: parseFloat(underuseRatio.toFixed(3)),
      residual_potential_est: Math.round(residual),
      dominant_zone_family: zoneFamily,
      updated_at: new Date().toISOString(),
    });
  }

  // Upsert constructibility
  console.log(`  Upserting ${constUpdates.length} constructibility records...`);
  const BATCH = 100;
  for (let i = 0; i < constUpdates.length; i += BATCH) {
    const batch = constUpdates.slice(i, i + BATCH);
    const result = await supabaseUpsert("parcel_constructibility", batch);
    if (result.error) console.error(`  ERROR constructibility batch ${i}: ${JSON.stringify(result.error)}`);
    else process.stdout.write(`\r  Constructibility: ${Math.min(i + BATCH, constUpdates.length)}/${constUpdates.length}`);
  }
  console.log("");

  // Upsert scores
  console.log(`  Upserting ${scoreRows.length} score records...`);
  for (let i = 0; i < scoreRows.length; i += BATCH) {
    const batch = scoreRows.slice(i, i + BATCH);
    const result = await supabaseUpsert("parcel_scores", batch);
    if (result.error) console.error(`  ERROR scores batch ${i}: ${JSON.stringify(result.error)}`);
    else process.stdout.write(`\r  Scores: ${Math.min(i + BATCH, scoreRows.length)}/${scoreRows.length}`);
  }
  console.log("");

  // Stats
  const scored = scoreRows.filter(s => s.mutability_score > 0);
  const positive = scoreRows.filter(s => s.land_value_est > 0);
  const top = [...scoreRows].sort((a, b) => b.mutability_score - a.mutability_score).slice(0, 10);

  console.log(`\n=== Résultats VLG (${insee}) ===`);
  console.log(`  Parcelles scorées : ${scored.length}`);
  console.log(`  Charge foncière positive : ${positive.length}`);
  console.log(`\n  Top 10 parcelles :`);
  for (const s of top) {
    const ej = s.explanation_json;
    console.log(`    ${s.parcel_id} — Score ${s.mutability_score}/10 — CF ${ej.charge_fonciere_m2_terrain} €/m² — ${s.best_use} — PLU ${ej.plu_zone_code} (${ej.zone_vocation}) — ${ej.nb_logements_est} lgts — parking ${ej.cout_parking}€`);
  }

  console.log(`\n=== Pipeline ICH terminé ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
