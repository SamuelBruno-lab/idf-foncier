/**
 * Pipeline foncier ICH via Supabase REST API (curl-based, proxy-compatible).
 * Uses real PLUi BNS zones from GPU (assign-plui-zones.py output).
 * Usage: node scripts/run-pipeline-rest.mjs [--insee 92078]
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
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

// PLUi BNS parking norms – Secteur 2 (VLG, Gennevilliers, Colombes, Asnières, Bois-Colombes)
// Simplified: 1 place/logement (0.75 T1-T2, 1 à partir du T3), logement social 0.5
const PARKING_PER_LOGEMENT = 1.0;

// ─── Setback rules by forme index (Article 3) ──────────────────
const FORME_SETBACKS = {
  1: { front: 0, side: 0 },       // central, alignement obligatoire
  2: { front: 0, side: 3 },       // alignement ou recul, retrait h/2 min 3m
  3: { front: 3, side: 3 },       // recul possible, retrait h/2 min 3m
  4: { front: 5, side: 4 },       // recul ≥5m, retrait h/2 min 4m
  5: { front: 5, side: 4 },       // recul, retrait h/2 min 4m
  6: { front: 3, side: 4 },       // alignement ou recul, retrait h/2 min 4m
  7: { front: 5, side: 5 },       // recul ≥h/2 min 5m
  8: { front: 0, side: 5 },       // alignement ou recul, retrait ≥5m
};

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

  console.log(`=== Pipeline ICH via REST + PLUi BNS — insee=${insee} ===`);

  // 0. Load PLUi zone assignments
  const pluiFile = resolve(__dirname, "../../data/vlg_parcel_plui_zones.json");
  if (!existsSync(pluiFile)) {
    console.error("ERROR: Run assign-plui-zones.py first to generate PLUi zone assignments");
    process.exit(1);
  }
  const pluiMap = JSON.parse(readFileSync(pluiFile, "utf8"));
  console.log(`[0/5] PLUi zones loaded: ${Object.keys(pluiMap).length} parcels`);

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
  const bsMap = {};
  const BS_BATCH = 200;
  for (let i = 0; i < parcelIds.length; i += BS_BATCH) {
    const batch = parcelIds.slice(i, i + BS_BATCH);
    const inFilter = `parcel_id=in.(${batch.map(id => `"${id}"`).join(",")})`;
    const data = supabaseGet("parcel_building_stats",
      `select=${encodeURIComponent("parcel_id,built_footprint_m2,existing_gfa_est,coverage_ratio,building_count")}&${inFilter}`
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

  // 4. Skip old constructibility fetch — we compute from PLUi now
  console.log("[4/5] Computing from PLUi zones...");

  // 5. Compute ICH bilan scores
  console.log("[5/5] Computing ICH bilan + scores...");
  const scoreRows = [];
  const constUpdates = [];
  let noPluiCount = 0;

  for (const p of parcels) {
    const bs = bsMap[p.parcel_id] || {};
    const ms = msMap[p.parcel_id] || {};
    const plui = pluiMap[p.parcel_id];

    if (!plui) {
      noPluiCount++;
      continue;
    }

    const area = p.area_m2 || 0;
    const coverageRatio = bs.coverage_ratio ?? 0;

    // PLUi rules
    const cesApplied = plui.ces;
    const maxHeight = plui.max_height_m;
    const greenRatio = plui.green_ratio;
    const vocation = plui.zone_vocation;
    const pluZoneCode = plui.plu_zone_code;
    const forme = plui.forme || 4;

    const setback = FORME_SETBACKS[forme] || FORME_SETBACKS[4];
    const setbackPenalty = computeSetbackPenalty(area, setback.front, setback.side);
    const buildableFootprint = area * cesApplied * (1 - greenRatio) * setbackPenalty;
    const floors = Math.max(1, Math.floor(maxHeight / 3));
    const estimatedGfa = buildableFootprint * floors;

    const existingArea = bs.existing_gfa_est || 0;
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

    // Parking: vocation-dependent
    const nbLogements = (vocation === "activite" || vocation === "equipement")
      ? 0
      : Math.max(1, Math.round(estimatedGfa / 60));
    const nbParking = Math.round(nbLogements * PARKING_PER_LOGEMENT);
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

    const zoneFamily = pluZoneCode.startsWith("U") ? "U" : pluZoneCode.startsWith("A") ? "A" : "N";
    const zoningScore = zoneFamily === "U" ? 8 : zoneFamily === "A" ? 2 : 1;

    const landValueScore = chargeFonciere > 0
      ? (chargeFonciereM2 <= 100 ? 3 : chargeFonciereM2 <= 300 ? 5 : chargeFonciereM2 <= 600 ? 7 : 9)
      : 0;

    const mutabilityScore = Math.min(10, Math.max(0,
      0.25 * sizeScore + 0.30 * underuseScore + 0.15 * marketScore + 0.10 * zoningScore + 0.20 * landValueScore
    ));

    // best_use: based on PLUi vocation + underuse
    let bestUse;
    if (vocation === "naturel" || vocation === "agricole") {
      bestUse = "non_constructible";
    } else if (vocation === "equipement") {
      bestUse = "equipement_public";
    } else if (vocation === "activite") {
      bestUse = estimatedGfa > 1000 ? "activite_economique" : "bureaux_commerces";
    } else if (vocation === "projet") {
      bestUse = "zone_de_projet";
    } else if (area < 300) {
      bestUse = "division_parcellaire";
    } else if (coverageRatio < 0.05 && area > 500) {
      bestUse = "dent_creuse";
    } else if (underuseRatio > 0.4) {
      bestUse = vocation === "mixte" ? "densification_mixte" : "densification_residentielle";
    } else {
      bestUse = "analyse_complementaire";
    }

    const explanationJson = {
      plu_zone_code: pluZoneCode, zone_vocation: vocation,
      destination: plui.destination, forme: forme,
      densite_idx: plui.densite_idx, hauteur_idx: plui.hauteur_idx,
      ces_applied: cesApplied, max_height_est: maxHeight,
      setback_front_m: setback.front, setback_side_m: setback.side,
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
      method: "ICH_bilan_promoteur_v3_PLUi_BNS",
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

  if (noPluiCount > 0) console.log(`  ⚠ ${noPluiCount} parcels without PLUi zone (skipped)`);

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

  // Vocation distribution
  const vocCounts = {};
  scoreRows.forEach(s => {
    const v = s.explanation_json.zone_vocation;
    vocCounts[v] = (vocCounts[v] || 0) + 1;
  });

  console.log(`\n=== Résultats VLG (${insee}) — PLUi BNS ===`);
  console.log(`  Parcelles scorées : ${scored.length}`);
  console.log(`  Charge foncière positive : ${positive.length}`);
  console.log(`  Vocations : ${JSON.stringify(vocCounts)}`);
  console.log(`\n  Top 10 parcelles :`);
  for (const s of top) {
    const ej = s.explanation_json;
    console.log(`    ${s.parcel_id} — Score ${s.mutability_score}/10 — CF ${ej.charge_fonciere_m2_terrain} €/m² — ${s.best_use} — PLUi ${ej.plu_zone_code} (${ej.zone_vocation}) — ${ej.nb_logements_est} lgts`);
  }

  console.log(`\n=== Pipeline ICH terminé ===`);
}

main().catch(e => { console.error(e); process.exit(1); });
