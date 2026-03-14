import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";

const ADMIN_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getDbConfigs(overridePassword?: string) {
  const ref = "zexkxstcwkdsqjgsppvx";
  const password = overridePassword || process.env.SUPABASE_DB_PASSWORD!;
  return [
    // New-style pooler: {ref}.pooler.supabase.com
    { host: `${ref}.pooler.supabase.com`, port: 6543, database: "postgres", user: `postgres.${ref}`, password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000, label: "new-pooler:6543" },
    { host: `${ref}.pooler.supabase.com`, port: 5432, database: "postgres", user: `postgres.${ref}`, password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000, label: "new-pooler:5432" },
    // Old-style pooler
    { host: `aws-0-eu-west-3.pooler.supabase.com`, port: 6543, database: "postgres", user: `postgres.${ref}`, password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000, label: "old-pooler-eu-west-3:6543" },
    { host: `aws-0-eu-central-1.pooler.supabase.com`, port: 6543, database: "postgres", user: `postgres.${ref}`, password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000, label: "old-pooler-eu-central-1:6543" },
    // Direct connection
    { host: `db.${ref}.supabase.co`, port: 5432, database: "postgres", user: "postgres", password, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000, label: "direct" },
  ];
}

async function runSQL(client: Client, sql: string, label: string): Promise<string> {
  try {
    await client.query(sql);
    return `OK: ${label}`;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return `ERROR [${label}]: ${msg}`;
  }
}

export async function POST(req: NextRequest) {
  // Auth check
  const auth = req.headers.get("x-admin-key");
  if (auth !== ADMIN_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const step = (body as Record<string, string>).step ?? "all";
  const dbPassword = (body as Record<string, string>).db_password;

  const configs = getDbConfigs(dbPassword);
  const logs: string[] = [];
  let client: Client | null = null;

  // Try each config until one works
  for (const cfg of configs) {
    const { label, ...pgConfig } = cfg;
    const c = new Client(pgConfig);
    try {
      await c.connect();
      await c.query("SELECT 1");
      client = c;
      logs.push(`Connected via ${label} (${cfg.host}:${cfg.port})`);
      break;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logs.push(`SKIP ${label}: ${msg}`);
      await c.end().catch(() => {});
    }
  }

  if (!client) {
    return NextResponse.json({ success: false, logs, error: "Could not connect to any database endpoint" }, { status: 500 });
  }

  try {

    // ===== STEP 1: Schema =====
    if (step === "all" || step === "schema") {
      logs.push(await runSQL(client, `CREATE EXTENSION IF NOT EXISTS postgis;`, "postgis"));

      logs.push(await runSQL(client, `
        CREATE TABLE IF NOT EXISTS public.parcels (
          parcel_id TEXT PRIMARY KEY,
          insee_code TEXT NOT NULL,
          section TEXT,
          number TEXT,
          area_m2 NUMERIC,
          city_name TEXT,
          geom geometry(MultiPolygon, 2154) NOT NULL,
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_parcels_insee_code ON public.parcels (insee_code);
        CREATE INDEX IF NOT EXISTS idx_parcels_geom ON public.parcels USING GIST (geom);
      `, "parcels table"));

      logs.push(await runSQL(client, `
        CREATE TABLE IF NOT EXISTS public.buildings (
          building_id TEXT PRIMARY KEY,
          source TEXT,
          levels_est INTEGER DEFAULT 1,
          footprint_m2 NUMERIC,
          geom geometry(MultiPolygon, 2154),
          created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_buildings_geom ON public.buildings USING GIST (geom);
      `, "buildings table"));

      logs.push(await runSQL(client, `
        CREATE TABLE IF NOT EXISTS public.parcel_building_stats (
          parcel_id TEXT PRIMARY KEY REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
          built_footprint_m2 NUMERIC DEFAULT 0,
          building_count INTEGER DEFAULT 0,
          existing_gfa_est NUMERIC DEFAULT 0,
          coverage_ratio NUMERIC DEFAULT 0,
          updated_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_parcel_building_stats_coverage ON public.parcel_building_stats (coverage_ratio);
      `, "parcel_building_stats table"));

      logs.push(await runSQL(client, `
        CREATE TABLE IF NOT EXISTS public.parcel_market_stats (
          parcel_id TEXT PRIMARY KEY REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
          median_price_m2 NUMERIC,
          market_tension_score NUMERIC,
          hdbscan_zone_id TEXT,
          analysis_year INTEGER,
          updated_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_parcel_market_stats_price ON public.parcel_market_stats (median_price_m2);
      `, "parcel_market_stats table"));

      logs.push(await runSQL(client, `
        CREATE TABLE IF NOT EXISTS public.parcel_constructibility (
          parcel_id TEXT PRIMARY KEY REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
          dominant_zone_family TEXT,
          max_height_est NUMERIC,
          max_footprint_ratio_est NUMERIC,
          min_green_ratio_est NUMERIC,
          setback_penalty_est NUMERIC,
          parking_penalty_est NUMERIC,
          buildable_footprint_est NUMERIC,
          floors_est INTEGER,
          estimated_gfa NUMERIC,
          residual_potential_est NUMERIC,
          underuse_ratio NUMERIC,
          updated_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_parcel_constructibility_zone ON public.parcel_constructibility (dominant_zone_family);
        CREATE INDEX IF NOT EXISTS idx_parcel_constructibility_underuse ON public.parcel_constructibility (underuse_ratio);
      `, "parcel_constructibility table"));

      logs.push(await runSQL(client, `
        CREATE TABLE IF NOT EXISTS public.parcel_scores (
          parcel_id TEXT PRIMARY KEY REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
          mutability_score NUMERIC,
          underuse_score NUMERIC,
          zoning_score NUMERIC,
          market_score NUMERIC,
          size_score NUMERIC,
          land_value_score NUMERIC,
          best_use TEXT,
          land_value_est NUMERIC,
          program_value_est NUMERIC,
          explanation_json JSONB,
          computed_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_parcel_scores_mutability ON public.parcel_scores (mutability_score DESC);
        CREATE INDEX IF NOT EXISTS idx_parcel_scores_best_use ON public.parcel_scores (best_use);
      `, "parcel_scores table"));

      logs.push(await runSQL(client, `
        CREATE OR REPLACE VIEW public.v_parcel_foncier AS
        SELECT
          p.parcel_id, p.insee_code, p.section, p.number, p.area_m2, p.city_name,
          pcs.mutability_score, pcs.best_use, pcs.land_value_est, pcs.program_value_est,
          pcs.explanation_json,
          pc.dominant_zone_family, pc.estimated_gfa, pc.residual_potential_est, pc.underuse_ratio,
          pc.plu_zone_code, pc.zone_vocation, pc.ces_applied, pc.max_height_est,
          pc.setback_front_m, pc.setback_side_m,
          pms.median_price_m2, pms.hdbscan_zone_id,
          COALESCE(pbs.coverage_ratio, 0) AS coverage_ratio,
          COALESCE(pbs.existing_gfa_est, 0) AS existing_gfa_est,
          COALESCE(pbs.built_footprint_m2, 0) AS built_footprint_m2,
          COALESCE(pbs.building_count, 0) AS building_count,
          pcs.nb_logements_est, pcs.nb_parking_places,
          pcs.parking_cost, pcs.parking_surface_m2,
          pcs.taxe_amenagement, pcs.taxe_amenagement_taux,
          p.geom
        FROM public.parcels p
        LEFT JOIN public.parcel_scores pcs ON pcs.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_building_stats pbs ON pbs.parcel_id = p.parcel_id;
      `, "v_parcel_foncier view"));

      logs.push(await runSQL(client, `
        CREATE OR REPLACE FUNCTION public.get_foncier_bbox(
          minx DOUBLE PRECISION, miny DOUBLE PRECISION,
          maxx DOUBLE PRECISION, maxy DOUBLE PRECISION,
          min_score DOUBLE PRECISION DEFAULT 0,
          limit_count INTEGER DEFAULT 500
        )
        RETURNS TABLE (
          parcel_id TEXT, insee_code TEXT, area_m2 NUMERIC,
          mutability_score NUMERIC, best_use TEXT,
          land_value_est NUMERIC, estimated_gfa NUMERIC, geojson JSONB
        )
        LANGUAGE sql STABLE
        AS $fn$
          SELECT v.parcel_id, v.insee_code, v.area_m2, v.mutability_score,
            v.best_use, v.land_value_est, v.estimated_gfa,
            ST_AsGeoJSON(ST_Transform(v.geom, 4326))::jsonb AS geojson
          FROM public.v_parcel_foncier v
          WHERE v.mutability_score IS NOT NULL
            AND v.mutability_score >= min_score
            AND v.geom && ST_MakeEnvelope(minx, miny, maxx, maxy, 2154)
          ORDER BY v.mutability_score DESC
          LIMIT limit_count;
        $fn$;
      `, "get_foncier_bbox function"));

      // RLS
      const rlsTables = ["parcels", "parcel_building_stats", "parcel_market_stats", "parcel_constructibility", "parcel_scores", "buildings"];
      for (const t of rlsTables) {
        logs.push(await runSQL(client, `
          ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;
          DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='${t}' AND policyname='${t}_public_read') THEN
              CREATE POLICY "${t}_public_read" ON public.${t} FOR SELECT USING (true);
            END IF;
          END $$;
        `, `RLS ${t}`));
      }

      // Notify PostgREST to refresh its schema cache
      logs.push(await runSQL(client, `NOTIFY pgrst, 'reload schema';`, "schema cache reload"));
    }

    // ===== STEP 2: Seed demo data for 92078 (VLG) =====
    if (step === "all" || step === "seed") {
      // Check if parcels already exist
      const existing = await client.query(`SELECT count(*)::int AS n FROM public.parcels WHERE insee_code = '92078'`);
      const count = existing.rows[0]?.n ?? 0;

      if (count > 0) {
        logs.push(`Skipping seed: ${count} parcels already exist for 92078`);
      } else {
        // Generate realistic parcels for Villeneuve-la-Garenne
        // Center: lat 48.9383, lon 2.3269 → EPSG:2154 approx X=651500 Y=6869000
        const baseX = 651500;
        const baseY = 6869000;
        const parcels: string[] = [];
        const buildings: string[] = [];

        // VLG has about 2000 parcels, let's generate 200 representative ones
        for (let i = 0; i < 200; i++) {
          const pid = `92078${String(i).padStart(6, '0')}`;
          const section = String.fromCharCode(65 + (i % 26));
          const num = String(i + 1);
          const area = 150 + Math.floor(Math.random() * 2500); // 150-2650 m²
          const ox = baseX + (Math.random() - 0.5) * 2000;
          const oy = baseY + (Math.random() - 0.5) * 1500;
          const w = Math.sqrt(area) * (0.8 + Math.random() * 0.4);
          const h = area / w;

          parcels.push(`('${pid}','92078','${section}','${num}',${area},'Villeneuve-la-Garenne',
            ST_Multi(ST_MakeEnvelope(${ox},${oy},${ox + w},${oy + h},2154)))`);

          // ~60% of parcels have a building
          if (Math.random() < 0.6) {
            const bid = `BATIMENT${pid}`;
            const bfrac = 0.1 + Math.random() * 0.5; // 10-60% coverage
            const bw = w * Math.sqrt(bfrac);
            const bh = h * Math.sqrt(bfrac);
            const levels = 1 + Math.floor(Math.random() * 6);
            buildings.push(`('${bid}','seed',${levels},${Math.round(bw * bh)},
              ST_Multi(ST_MakeEnvelope(${ox + 2},${oy + 2},${ox + 2 + bw},${oy + 2 + bh},2154)))`);
          }
        }

        // Insert in batches
        const batchSize = 50;
        for (let i = 0; i < parcels.length; i += batchSize) {
          const batch = parcels.slice(i, i + batchSize);
          logs.push(await runSQL(client, `
            INSERT INTO public.parcels (parcel_id, insee_code, section, number, area_m2, city_name, geom)
            VALUES ${batch.join(",")}
            ON CONFLICT (parcel_id) DO NOTHING;
          `, `seed parcels batch ${i / batchSize + 1}`));
        }

        for (let i = 0; i < buildings.length; i += batchSize) {
          const batch = buildings.slice(i, i + batchSize);
          logs.push(await runSQL(client, `
            INSERT INTO public.buildings (building_id, source, levels_est, footprint_m2, geom)
            VALUES ${batch.join(",")}
            ON CONFLICT (building_id) DO NOTHING;
          `, `seed buildings batch ${i / batchSize + 1}`));
        }

        logs.push(`Seeded ${parcels.length} parcels and ${buildings.length} buildings for 92078`);
      }
    }

    // ===== STEP 3: Run scoring pipeline =====
    if (step === "all" || step === "score") {
      const insee = "92078";

      // Step 1: building stats
      logs.push(await runSQL(client, `
        INSERT INTO public.parcel_building_stats (parcel_id, built_footprint_m2, building_count, existing_gfa_est, coverage_ratio, updated_at)
        SELECT
          p.parcel_id,
          COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom))), 0),
          COUNT(DISTINCT b.building_id) FILTER (WHERE ST_Intersects(p.geom, b.geom)),
          COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom)) * COALESCE(b.levels_est, 1)), 0),
          CASE WHEN p.area_m2 > 0 THEN COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom))), 0) / p.area_m2 ELSE 0 END,
          now()
        FROM public.parcels p
        LEFT JOIN public.buildings b ON ST_Intersects(p.geom, b.geom)
        WHERE p.insee_code = '${insee}'
        GROUP BY p.parcel_id, p.area_m2
        ON CONFLICT (parcel_id) DO UPDATE SET
          built_footprint_m2 = EXCLUDED.built_footprint_m2,
          building_count = EXCLUDED.building_count,
          existing_gfa_est = EXCLUDED.existing_gfa_est,
          coverage_ratio = EXCLUDED.coverage_ratio,
          updated_at = now();
      `, "01_building_stats"));

      // Step 2: market stats (use DVF data if available, fallback to fixed VLG median)
      logs.push(await runSQL(client, `
        INSERT INTO public.parcel_market_stats (parcel_id, median_price_m2, market_tension_score, hdbscan_zone_id, analysis_year, updated_at)
        SELECT
          p.parcel_id,
          COALESCE(c.prix_m2_median, 4200),
          CASE
            WHEN COALESCE(c.prix_m2_median, 4200) >= 6000 THEN 10
            WHEN COALESCE(c.prix_m2_median, 4200) >= 4500 THEN 8
            WHEN COALESCE(c.prix_m2_median, 4200) >= 3000 THEN 6
            WHEN COALESCE(c.prix_m2_median, 4200) >= 2000 THEN 4
            ELSE 2
          END,
          NULL,
          EXTRACT(YEAR FROM now())::int,
          now()
        FROM public.parcels p
        LEFT JOIN LATERAL (
          SELECT prix_m2_median FROM public.dvf_clusters_commune
          WHERE cluster_id LIKE p.insee_code || '_%'
          ORDER BY count DESC LIMIT 1
        ) c ON true
        WHERE p.insee_code = '${insee}'
        ON CONFLICT (parcel_id) DO UPDATE SET
          median_price_m2 = EXCLUDED.median_price_m2,
          market_tension_score = EXCLUDED.market_tension_score,
          updated_at = now();
      `, "02_market_stats"));

      // Step 3: constructibility (zone U defaults)
      const H = 12, FP = 0.40, GR = 0.20, SB = 0.85, PK = 0.90;
      logs.push(await runSQL(client, `
        INSERT INTO public.parcel_constructibility (
          parcel_id, dominant_zone_family, max_height_est, max_footprint_ratio_est,
          min_green_ratio_est, setback_penalty_est, parking_penalty_est,
          buildable_footprint_est, floors_est, estimated_gfa, residual_potential_est, underuse_ratio, updated_at
        )
        SELECT
          p.parcel_id, 'U', ${H}, ${FP}, ${GR}, ${SB}, ${PK},
          LEAST(p.area_m2 * ${FP}, p.area_m2 * (1 - ${GR}) * ${SB}),
          GREATEST(1, FLOOR(${H} / 3.5))::int,
          LEAST(p.area_m2 * ${FP}, p.area_m2 * (1 - ${GR}) * ${SB}) * GREATEST(1, FLOOR(${H} / 3.5)) * ${PK},
          GREATEST(0,
            LEAST(p.area_m2 * ${FP}, p.area_m2 * (1 - ${GR}) * ${SB}) * GREATEST(1, FLOOR(${H} / 3.5)) * ${PK}
            - COALESCE(bs.existing_gfa_est, 0)
          ),
          CASE WHEN (LEAST(p.area_m2*${FP}, p.area_m2*(1-${GR})*${SB}) * GREATEST(1,FLOOR(${H}/3.5)) * ${PK}) > 0
            THEN GREATEST(0, 1 - COALESCE(bs.existing_gfa_est,0) / (LEAST(p.area_m2*${FP}, p.area_m2*(1-${GR})*${SB}) * GREATEST(1,FLOOR(${H}/3.5)) * ${PK}))
            ELSE 0
          END,
          now()
        FROM public.parcels p
        LEFT JOIN public.parcel_building_stats bs ON bs.parcel_id = p.parcel_id
        WHERE p.insee_code = '${insee}'
        ON CONFLICT (parcel_id) DO UPDATE SET
          dominant_zone_family = EXCLUDED.dominant_zone_family,
          max_height_est = EXCLUDED.max_height_est,
          buildable_footprint_est = EXCLUDED.buildable_footprint_est,
          floors_est = EXCLUDED.floors_est,
          estimated_gfa = EXCLUDED.estimated_gfa,
          residual_potential_est = EXCLUDED.residual_potential_est,
          underuse_ratio = EXCLUDED.underuse_ratio,
          updated_at = now();
      `, "03_constructibility"));

      // Step 4: scores
      const SR = 0.75, CC = 1300, VRD = 100, SF = 0.03, MG = 0.08;
      logs.push(await runSQL(client, `
        INSERT INTO public.parcel_scores (
          parcel_id, mutability_score, underuse_score, zoning_score, market_score,
          size_score, land_value_score, best_use, land_value_est, program_value_est,
          explanation_json, computed_at
        )
        SELECT
          p.parcel_id,
          ROUND((0.30*sub.underuse_score + 0.25*sub.zoning_score + 0.20*sub.market_score + 0.15*sub.size_score + 0.10*sub.land_value_score), 2),
          sub.underuse_score, sub.zoning_score, sub.market_score, sub.size_score, sub.land_value_score,
          CASE
            WHEN pc.dominant_zone_family IN ('U','AU') AND p.area_m2 >= 600 AND pc.underuse_ratio >= 0.70 THEN 'densification_residentielle'
            WHEN pc.dominant_zone_family = 'U' AND p.area_m2 BETWEEN 300 AND 700 AND pc.underuse_ratio >= 0.60 THEN 'division_parcellaire'
            WHEN pc.dominant_zone_family = 'U' AND COALESCE(bs.coverage_ratio,0) < 0.15 THEN 'dent_creuse'
            ELSE 'analyse_complementaire'
          END,
          calc.land_value_est_calc, calc.program_value_est_calc,
          jsonb_build_object('area_m2',p.area_m2,'underuse_ratio',pc.underuse_ratio,'dominant_zone_family',pc.dominant_zone_family,'median_price_m2',pms.median_price_m2,'estimated_gfa',pc.estimated_gfa,'residual_potential_est',pc.residual_potential_est,'coverage_ratio',bs.coverage_ratio),
          now()
        FROM public.parcels p
        JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_building_stats bs ON bs.parcel_id = p.parcel_id
        CROSS JOIN LATERAL (
          SELECT
            (pc.estimated_gfa * ${SR} * COALESCE(pms.median_price_m2,0)) AS program_value_est_calc,
            (pc.estimated_gfa * ${SR} * COALESCE(pms.median_price_m2,0))
            - (pc.estimated_gfa * ${CC}) - (pc.estimated_gfa * ${VRD})
            - ((pc.estimated_gfa * ${SR} * COALESCE(pms.median_price_m2,0)) * ${SF})
            - ((pc.estimated_gfa * ${SR} * COALESCE(pms.median_price_m2,0)) * ${MG})
            AS land_value_est_calc
        ) calc
        CROSS JOIN LATERAL (
          SELECT
            CASE WHEN pc.underuse_ratio>=0.80 THEN 10 WHEN pc.underuse_ratio>=0.60 THEN 8 WHEN pc.underuse_ratio>=0.40 THEN 6 WHEN pc.underuse_ratio>=0.20 THEN 4 ELSE 1 END AS underuse_score,
            CASE WHEN pc.dominant_zone_family='U' THEN 9 WHEN pc.dominant_zone_family='AU' THEN 7 WHEN pc.dominant_zone_family='A' THEN 2 WHEN pc.dominant_zone_family='N' THEN 1 ELSE 3 END AS zoning_score,
            CASE WHEN pms.median_price_m2>=6000 THEN 10 WHEN pms.median_price_m2>=4500 THEN 8 WHEN pms.median_price_m2>=3000 THEN 6 WHEN pms.median_price_m2>=2000 THEN 4 ELSE 2 END AS market_score,
            CASE WHEN p.area_m2>=1000 THEN 9 WHEN p.area_m2>=600 THEN 7 WHEN p.area_m2>=300 THEN 5 ELSE 2 END AS size_score,
            CASE WHEN calc.land_value_est_calc>=1500000 THEN 10 WHEN calc.land_value_est_calc>=800000 THEN 8 WHEN calc.land_value_est_calc>=400000 THEN 6 WHEN calc.land_value_est_calc>=150000 THEN 4 ELSE 2 END AS land_value_score
        ) sub
        WHERE p.insee_code = '${insee}'
        ON CONFLICT (parcel_id) DO UPDATE SET
          mutability_score=EXCLUDED.mutability_score, underuse_score=EXCLUDED.underuse_score,
          zoning_score=EXCLUDED.zoning_score, market_score=EXCLUDED.market_score,
          size_score=EXCLUDED.size_score, land_value_score=EXCLUDED.land_value_score,
          best_use=EXCLUDED.best_use, land_value_est=EXCLUDED.land_value_est,
          program_value_est=EXCLUDED.program_value_est, explanation_json=EXCLUDED.explanation_json,
          computed_at=now();
      `, "04_scores"));

      // Refresh PostgREST schema cache
      logs.push(await runSQL(client, `NOTIFY pgrst, 'reload schema';`, "final schema reload"));

      // Count results
      const result = await client.query(`SELECT count(*)::int AS n FROM public.parcel_scores WHERE parcel_id LIKE '92078%'`);
      logs.push(`Scored parcels for 92078: ${result.rows[0]?.n ?? 0}`);
    }

    // ===== STEP: migrate — run HDBSCAN view + pipeline fixes =====
    if (step === "migrate" || step === "all-migrate") {
      // Migration 10: add geom to HDBSCAN zones + update view
      logs.push(await runSQL(client, `
        ALTER TABLE dvf_hdbscan_zones ADD COLUMN IF NOT EXISTS geom GEOMETRY(Polygon, 4326);
      `, "add geom column to hdbscan_zones"));

      logs.push(await runSQL(client, `
        UPDATE dvf_hdbscan_zones
        SET geom = ST_SetSRID(
          ST_MakePolygon(
            ST_MakeLine(
              ARRAY(
                SELECT ST_MakePoint((coord->1)::float, (coord->0)::float)
                FROM jsonb_array_elements(hull_coords) AS coord
              )
              || ARRAY[ST_MakePoint((hull_coords->0->1)::float, (hull_coords->0->0)::float)]
            )
          ), 4326)
        WHERE hull_coords IS NOT NULL
          AND jsonb_array_length(hull_coords) >= 3
          AND geom IS NULL;
      `, "build hdbscan zone geometries"));

      logs.push(await runSQL(client, `
        CREATE INDEX IF NOT EXISTS idx_hdbscan_geom ON dvf_hdbscan_zones USING GIST (geom);
      `, "hdbscan geom index"));

      // Update view with hdbscan_zone_id, coverage_ratio, and bâti existant
      logs.push(await runSQL(client, `
        CREATE OR REPLACE VIEW public.v_parcel_foncier AS
        SELECT
          p.parcel_id, p.insee_code, p.section, p.number, p.area_m2, p.city_name,
          pcs.mutability_score, pcs.best_use, pcs.land_value_est, pcs.program_value_est,
          pcs.explanation_json,
          pc.dominant_zone_family, pc.estimated_gfa, pc.residual_potential_est, pc.underuse_ratio,
          pc.plu_zone_code, pc.zone_vocation, pc.ces_applied, pc.max_height_est,
          pc.setback_front_m, pc.setback_side_m,
          pms.median_price_m2,
          pms.hdbscan_zone_id,
          COALESCE(pbs.coverage_ratio, 0) AS coverage_ratio,
          COALESCE(pbs.existing_gfa_est, 0) AS existing_gfa_est,
          COALESCE(pbs.built_footprint_m2, 0) AS built_footprint_m2,
          COALESCE(pbs.building_count, 0) AS building_count,
          pcs.nb_logements_est, pcs.nb_parking_places,
          pcs.parking_cost, pcs.parking_surface_m2,
          pcs.taxe_amenagement, pcs.taxe_amenagement_taux,
          p.geom
        FROM public.parcels p
        LEFT JOIN public.parcel_scores pcs ON pcs.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_building_stats pbs ON pbs.parcel_id = p.parcel_id;
      `, "updated v_parcel_foncier view"));

      // Migration 11: RPC get_parcel_centroids
      logs.push(await runSQL(client, `
        CREATE OR REPLACE FUNCTION public.get_parcel_centroids(
          p_insee TEXT, p_limit INT DEFAULT 1000, p_offset INT DEFAULT 0
        )
        RETURNS TABLE(parcel_id TEXT, centroid_lon FLOAT, centroid_lat FLOAT)
        LANGUAGE sql STABLE
        AS $fn$
          SELECT p.parcel_id,
            ST_X(ST_Centroid(ST_Transform(p.geom, 4326)))::float,
            ST_Y(ST_Centroid(ST_Transform(p.geom, 4326)))::float
          FROM public.parcels p
          WHERE p.insee_code = p_insee
          ORDER BY p.parcel_id LIMIT p_limit OFFSET p_offset;
        $fn$;
      `, "get_parcel_centroids RPC"));

      // Migration 11: updated score_commune_parcels with HDBSCAN
      logs.push(await runSQL(client, `
        CREATE OR REPLACE FUNCTION public.score_commune_parcels(
          p_insee TEXT, p_median_price NUMERIC DEFAULT 4000
        ) RETURNS INTEGER LANGUAGE plpgsql AS $fn$
        DECLARE
          scored_count INTEGER;
          v_h NUMERIC := 12; v_fp NUMERIC := 0.40; v_gr NUMERIC := 0.20;
          v_sb NUMERIC := 0.85; v_pk NUMERIC := 0.90; v_sr NUMERIC := 0.75;
          v_cc NUMERIC := 1300; v_vrd NUMERIC := 100; v_sf NUMERIC := 0.03; v_mg NUMERIC := 0.08;
        BEGIN
          -- Step 1: building stats
          INSERT INTO public.parcel_building_stats (parcel_id, built_footprint_m2, building_count, existing_gfa_est, coverage_ratio, updated_at)
          SELECT p.parcel_id,
            COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom))), 0),
            COUNT(DISTINCT b.building_id) FILTER (WHERE ST_Intersects(p.geom, b.geom)),
            COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom)) * COALESCE(b.levels_est, 1)), 0),
            CASE WHEN p.area_m2 > 0 THEN COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom))), 0) / p.area_m2 ELSE 0 END,
            now()
          FROM public.parcels p LEFT JOIN public.buildings b ON ST_Intersects(p.geom, b.geom)
          WHERE p.insee_code = p_insee GROUP BY p.parcel_id, p.area_m2
          ON CONFLICT (parcel_id) DO UPDATE SET
            built_footprint_m2=EXCLUDED.built_footprint_m2, building_count=EXCLUDED.building_count,
            existing_gfa_est=EXCLUDED.existing_gfa_est, coverage_ratio=EXCLUDED.coverage_ratio, updated_at=now();

          -- Step 2: market stats with HDBSCAN spatial matching
          INSERT INTO public.parcel_market_stats (parcel_id, median_price_m2, market_tension_score, hdbscan_zone_id, analysis_year, updated_at)
          SELECT p.parcel_id,
            COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price),
            CASE
              WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) >= 6000 THEN 10
              WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) >= 4500 THEN 8
              WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) >= 3000 THEN 6
              WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) >= 2000 THEN 4
              ELSE 2
            END,
            hz.zone_id,
            EXTRACT(YEAR FROM now())::int,
            now()
          FROM public.parcels p
          LEFT JOIN LATERAL (
            SELECT z.id AS zone_id, z.prix_m2_median FROM public.dvf_hdbscan_zones z
            WHERE z.code_commune = p.insee_code AND z.type_local = 'Appartement'
              AND z.prix_m2_median IS NOT NULL AND z.geom IS NOT NULL
              AND ST_Contains(z.geom, ST_Centroid(ST_Transform(p.geom, 4326)))
            ORDER BY z.count DESC LIMIT 1
          ) hz ON true
          LEFT JOIN LATERAL (
            SELECT prix_m2_median FROM public.dvf_clusters_commune
            WHERE cluster_id = p.insee_code || '_Appartement' AND prix_m2_median IS NOT NULL LIMIT 1
          ) commune_appt ON true
          WHERE p.insee_code = p_insee
          ON CONFLICT (parcel_id) DO UPDATE SET
            median_price_m2=EXCLUDED.median_price_m2, market_tension_score=EXCLUDED.market_tension_score,
            hdbscan_zone_id=EXCLUDED.hdbscan_zone_id, analysis_year=EXCLUDED.analysis_year, updated_at=now();

          -- Step 3: constructibility
          INSERT INTO public.parcel_constructibility (
            parcel_id, dominant_zone_family, max_height_est, max_footprint_ratio_est,
            min_green_ratio_est, setback_penalty_est, parking_penalty_est,
            buildable_footprint_est, floors_est, estimated_gfa, residual_potential_est, underuse_ratio, updated_at)
          SELECT p.parcel_id, 'U', v_h, v_fp, v_gr, v_sb, v_pk,
            LEAST(p.area_m2*v_fp, p.area_m2*(1-v_gr)*v_sb),
            GREATEST(1, FLOOR(v_h/3.5))::int,
            LEAST(p.area_m2*v_fp, p.area_m2*(1-v_gr)*v_sb) * GREATEST(1,FLOOR(v_h/3.5)) * v_pk,
            GREATEST(0, LEAST(p.area_m2*v_fp, p.area_m2*(1-v_gr)*v_sb)*GREATEST(1,FLOOR(v_h/3.5))*v_pk - COALESCE(bs.existing_gfa_est,0)),
            CASE WHEN (LEAST(p.area_m2*v_fp,p.area_m2*(1-v_gr)*v_sb)*GREATEST(1,FLOOR(v_h/3.5))*v_pk) > 0
              THEN GREATEST(0, 1 - COALESCE(bs.existing_gfa_est,0)/(LEAST(p.area_m2*v_fp,p.area_m2*(1-v_gr)*v_sb)*GREATEST(1,FLOOR(v_h/3.5))*v_pk))
              ELSE 0 END,
            now()
          FROM public.parcels p LEFT JOIN public.parcel_building_stats bs ON bs.parcel_id = p.parcel_id
          WHERE p.insee_code = p_insee
          ON CONFLICT (parcel_id) DO UPDATE SET
            dominant_zone_family=EXCLUDED.dominant_zone_family, buildable_footprint_est=EXCLUDED.buildable_footprint_est,
            floors_est=EXCLUDED.floors_est, estimated_gfa=EXCLUDED.estimated_gfa,
            residual_potential_est=EXCLUDED.residual_potential_est, underuse_ratio=EXCLUDED.underuse_ratio, updated_at=now();

          -- Step 4: scores (uses per-parcel HDBSCAN prices)
          INSERT INTO public.parcel_scores (
            parcel_id, mutability_score, underuse_score, zoning_score, market_score,
            size_score, land_value_score, best_use, land_value_est, program_value_est, explanation_json, computed_at)
          SELECT p.parcel_id,
            ROUND((0.30*sub.us + 0.25*sub.zs + 0.20*sub.ms + 0.15*sub.ss + 0.10*sub.ls), 2),
            sub.us, sub.zs, sub.ms, sub.ss, sub.ls,
            CASE
              WHEN pc.dominant_zone_family IN ('U','AU') AND p.area_m2>=600 AND pc.underuse_ratio>=0.70 THEN 'densification_residentielle'
              WHEN pc.dominant_zone_family='U' AND p.area_m2 BETWEEN 300 AND 700 AND pc.underuse_ratio>=0.60 THEN 'division_parcellaire'
              WHEN pc.dominant_zone_family='U' AND COALESCE(bs.coverage_ratio,0)<0.15 THEN 'dent_creuse'
              ELSE 'analyse_complementaire'
            END,
            calc.lv, calc.pv,
            jsonb_build_object('area_m2',p.area_m2,'underuse_ratio',pc.underuse_ratio,'dominant_zone_family',pc.dominant_zone_family,
              'median_price_m2',COALESCE(pms.median_price_m2,p_median_price),'estimated_gfa',pc.estimated_gfa,
              'residual_potential_est',pc.residual_potential_est,'coverage_ratio',bs.coverage_ratio,'hdbscan_zone_id',pms.hdbscan_zone_id),
            now()
          FROM public.parcels p
          JOIN public.parcel_constructibility pc ON pc.parcel_id=p.parcel_id
          LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id=p.parcel_id
          LEFT JOIN public.parcel_building_stats bs ON bs.parcel_id=p.parcel_id
          CROSS JOIN LATERAL (
            SELECT (pc.estimated_gfa*v_sr*COALESCE(pms.median_price_m2,p_median_price)) AS pv,
              (pc.estimated_gfa*v_sr*COALESCE(pms.median_price_m2,p_median_price))-(pc.estimated_gfa*v_cc)-(pc.estimated_gfa*v_vrd)
              -((pc.estimated_gfa*v_sr*COALESCE(pms.median_price_m2,p_median_price))*v_sf)
              -((pc.estimated_gfa*v_sr*COALESCE(pms.median_price_m2,p_median_price))*v_mg) AS lv
          ) calc
          CROSS JOIN LATERAL (
            SELECT
              CASE WHEN pc.underuse_ratio>=0.80 THEN 10 WHEN pc.underuse_ratio>=0.60 THEN 8 WHEN pc.underuse_ratio>=0.40 THEN 6 WHEN pc.underuse_ratio>=0.20 THEN 4 ELSE 1 END AS us,
              CASE WHEN pc.dominant_zone_family='U' THEN 9 WHEN pc.dominant_zone_family='AU' THEN 7 WHEN pc.dominant_zone_family='A' THEN 2 WHEN pc.dominant_zone_family='N' THEN 1 ELSE 3 END AS zs,
              CASE WHEN COALESCE(pms.median_price_m2,p_median_price)>=6000 THEN 10 WHEN COALESCE(pms.median_price_m2,p_median_price)>=4500 THEN 8 WHEN COALESCE(pms.median_price_m2,p_median_price)>=3000 THEN 6 WHEN COALESCE(pms.median_price_m2,p_median_price)>=2000 THEN 4 ELSE 2 END AS ms,
              CASE WHEN p.area_m2>=1000 THEN 9 WHEN p.area_m2>=600 THEN 7 WHEN p.area_m2>=300 THEN 5 ELSE 2 END AS ss,
              CASE WHEN calc.lv>=1500000 THEN 10 WHEN calc.lv>=800000 THEN 8 WHEN calc.lv>=400000 THEN 6 WHEN calc.lv>=150000 THEN 4 ELSE 2 END AS ls
          ) sub
          WHERE p.insee_code = p_insee
          ON CONFLICT (parcel_id) DO UPDATE SET
            mutability_score=EXCLUDED.mutability_score, underuse_score=EXCLUDED.underuse_score,
            zoning_score=EXCLUDED.zoning_score, market_score=EXCLUDED.market_score,
            size_score=EXCLUDED.size_score, land_value_score=EXCLUDED.land_value_score,
            best_use=EXCLUDED.best_use, land_value_est=EXCLUDED.land_value_est,
            program_value_est=EXCLUDED.program_value_est, explanation_json=EXCLUDED.explanation_json, computed_at=now();

          SELECT count(*) INTO scored_count FROM public.parcel_scores WHERE parcel_id LIKE p_insee || '%';
          NOTIFY pgrst, 'reload schema';
          RETURN scored_count;
        END;
        $fn$;
      `, "updated score_commune_parcels with HDBSCAN"));

      logs.push(await runSQL(client, `NOTIFY pgrst, 'reload schema';`, "final schema reload after migrate"));
    }

    // ===== STEP: migrate-plu — PLU rules table + ICH bilan promoteur =====
    if (step === "migrate-plu" || step === "all-migrate") {
      // 1. Create PLU zone rules table
      logs.push(await runSQL(client, `
        CREATE TABLE IF NOT EXISTS public.plu_zone_rules (
          zone_code TEXT NOT NULL,
          epci_code TEXT NOT NULL DEFAULT 'BNS',
          zone_family TEXT NOT NULL,
          vocation TEXT NOT NULL DEFAULT 'mixte',
          max_height NUMERIC NOT NULL,
          ces NUMERIC NOT NULL,
          cos NUMERIC,
          green_ratio NUMERIC NOT NULL DEFAULT 0.20,
          setback_front NUMERIC NOT NULL DEFAULT 5.0,
          setback_side NUMERIC NOT NULL DEFAULT 3.0,
          parking_logement_t1 NUMERIC DEFAULT 1,
          parking_logement_t2 NUMERIC DEFAULT 1.5,
          parking_logement_t3 NUMERIC DEFAULT 1.5,
          parking_logement_t4 NUMERIC DEFAULT 1.5,
          parking_logement_t5 NUMERIC DEFAULT 2,
          parking_per_100m2_eco NUMERIC DEFAULT 1.0,
          description TEXT,
          PRIMARY KEY (zone_code, epci_code)
        );
      `, "plu_zone_rules table"));

      // Insert PLU-i BNS rules
      logs.push(await runSQL(client, `
        INSERT INTO public.plu_zone_rules (zone_code, epci_code, zone_family, vocation, max_height, ces, green_ratio, setback_front, setback_side, parking_per_100m2_eco, description)
        VALUES
          ('UA','BNS','U','mixte',25.0,0.80,0.10,0.0,0.0,1.0,'Centre-ville dense'),
          ('UB','BNS','U','residentiel',18.0,0.60,0.20,3.0,3.0,1.0,'Résidentiel collectif'),
          ('UC','BNS','U','residentiel',12.0,0.40,0.30,5.0,3.0,1.0,'Pavillonnaire / petit collectif'),
          ('UD','BNS','U','residentiel',9.0,0.30,0.40,5.0,4.0,1.0,'Individuel faible densité'),
          ('UE','BNS','U','economique',15.0,0.60,0.15,5.0,5.0,2.0,'Activités économiques'),
          ('UX','BNS','U','economique',20.0,0.65,0.15,5.0,5.0,2.5,'Industriel / logistique'),
          ('UP','BNS','U','mixte',50.0,0.70,0.15,0.0,0.0,1.5,'Zone de projet / OAP'),
          ('AU','BNS','AU','mixte',15.0,0.50,0.25,5.0,4.0,1.0,'Zone à urbaniser'),
          ('A','BNS','A','residentiel',7.0,0.10,0.70,10.0,5.0,0.5,'Zone agricole'),
          ('N','BNS','N','residentiel',7.0,0.05,0.80,10.0,10.0,0.0,'Zone naturelle')
        ON CONFLICT (zone_code, epci_code) DO NOTHING;
      `, "seed PLU rules BNS"));

      // 2. Add columns to parcel_constructibility
      logs.push(await runSQL(client, `
        ALTER TABLE public.parcel_constructibility
          ADD COLUMN IF NOT EXISTS plu_zone_code TEXT,
          ADD COLUMN IF NOT EXISTS zone_vocation TEXT DEFAULT 'residentiel',
          ADD COLUMN IF NOT EXISTS ces_applied NUMERIC,
          ADD COLUMN IF NOT EXISTS setback_front_m NUMERIC,
          ADD COLUMN IF NOT EXISTS setback_side_m NUMERIC;
      `, "add PLU columns to constructibility"));

      // 3. Add columns to parcel_scores
      logs.push(await runSQL(client, `
        ALTER TABLE public.parcel_scores
          ADD COLUMN IF NOT EXISTS nb_logements_est INTEGER,
          ADD COLUMN IF NOT EXISTS nb_parking_places INTEGER,
          ADD COLUMN IF NOT EXISTS parking_cost NUMERIC DEFAULT 0,
          ADD COLUMN IF NOT EXISTS parking_surface_m2 NUMERIC DEFAULT 0,
          ADD COLUMN IF NOT EXISTS taxe_amenagement NUMERIC DEFAULT 0,
          ADD COLUMN IF NOT EXISTS taxe_amenagement_taux NUMERIC DEFAULT 0.05,
          ADD COLUMN IF NOT EXISTS zone_vocation TEXT DEFAULT 'residentiel',
          ADD COLUMN IF NOT EXISTS plu_zone_code TEXT;
      `, "add bilan columns to scores"));

      // 4. Update view with all new columns (incl. bâti existant)
      logs.push(await runSQL(client, `
        CREATE OR REPLACE VIEW public.v_parcel_foncier AS
        SELECT
          p.parcel_id, p.insee_code, p.section, p.number, p.area_m2, p.city_name,
          pcs.mutability_score, pcs.best_use, pcs.land_value_est, pcs.program_value_est,
          pcs.explanation_json,
          pc.dominant_zone_family, pc.estimated_gfa, pc.residual_potential_est, pc.underuse_ratio,
          pc.plu_zone_code, pc.zone_vocation, pc.ces_applied, pc.max_height_est,
          pc.setback_front_m, pc.setback_side_m,
          pms.median_price_m2, pms.hdbscan_zone_id,
          COALESCE(pbs.coverage_ratio, 0) AS coverage_ratio,
          COALESCE(pbs.existing_gfa_est, 0) AS existing_gfa_est,
          COALESCE(pbs.built_footprint_m2, 0) AS built_footprint_m2,
          COALESCE(pbs.building_count, 0) AS building_count,
          pcs.nb_logements_est, pcs.nb_parking_places,
          pcs.parking_cost, pcs.parking_surface_m2,
          pcs.taxe_amenagement, pcs.taxe_amenagement_taux,
          p.geom
        FROM public.parcels p
        LEFT JOIN public.parcel_scores pcs ON pcs.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_building_stats pbs ON pbs.parcel_id = p.parcel_id;
      `, "updated v_parcel_foncier with PLU+bilan+bati columns"));

      // 5. RLS for plu_zone_rules
      logs.push(await runSQL(client, `
        ALTER TABLE public.plu_zone_rules ENABLE ROW LEVEL SECURITY;
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plu_zone_rules' AND policyname='plu_zone_rules_public_read') THEN
            CREATE POLICY "plu_zone_rules_public_read" ON public.plu_zone_rules FOR SELECT USING (true);
          END IF;
        END $$;
      `, "RLS plu_zone_rules"));

      // 6. Update score_commune_parcels with ICH bilan + PLU
      logs.push(await runSQL(client, `
        CREATE OR REPLACE FUNCTION public.score_commune_parcels(
          p_insee TEXT, p_median_price NUMERIC DEFAULT 4000
        ) RETURNS INTEGER LANGUAGE plpgsql AS $fn$
        DECLARE
          scored_count INTEGER;
          -- PLU defaults
          v_h NUMERIC := 12; v_fp NUMERIC := 0.40; v_gr NUMERIC := 0.20;
          v_sb NUMERIC := 0.85;
          -- Bilan ICH
          v_sr NUMERIC := 0.75;     -- rendement (SDP → habitable)
          v_cc NUMERIC := 1800;     -- construction €/m² SDP (IDF)
          v_vrd NUMERIC := 100;     -- VRD €/m² terrain
          v_pub NUMERIC := 0.025;   -- publicité 2.5% CA
          v_dette NUMERIC := 0.06;  -- dette 6% × (constr+pub+VRD)
          v_mg NUMERIC := 0.08;     -- marge 8% CA (= dépense)
          v_pk_cost NUMERIC := 13500; -- parking €/place
          v_pk_surf NUMERIC := 27;    -- parking m²/place
          v_ta_val NUMERIC := 854;    -- taxe aménagement IDF €/m²
          v_ta_taux NUMERIC := 0.05;  -- taux communal 5%
        BEGIN
          -- Step 1: building stats
          INSERT INTO public.parcel_building_stats (parcel_id, built_footprint_m2, building_count, existing_gfa_est, coverage_ratio, updated_at)
          SELECT p.parcel_id,
            COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom))), 0),
            COUNT(DISTINCT b.building_id) FILTER (WHERE ST_Intersects(p.geom, b.geom)),
            COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom)) * COALESCE(b.levels_est, 1)), 0),
            CASE WHEN p.area_m2 > 0 THEN COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom))), 0) / p.area_m2 ELSE 0 END,
            now()
          FROM public.parcels p LEFT JOIN public.buildings b ON ST_Intersects(p.geom, b.geom)
          WHERE p.insee_code = p_insee GROUP BY p.parcel_id, p.area_m2
          ON CONFLICT (parcel_id) DO UPDATE SET
            built_footprint_m2=EXCLUDED.built_footprint_m2, building_count=EXCLUDED.building_count,
            existing_gfa_est=EXCLUDED.existing_gfa_est, coverage_ratio=EXCLUDED.coverage_ratio, updated_at=now();

          -- Step 2: market stats with HDBSCAN
          INSERT INTO public.parcel_market_stats (parcel_id, median_price_m2, market_tension_score, hdbscan_zone_id, analysis_year, updated_at)
          SELECT p.parcel_id,
            COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price),
            CASE
              WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) >= 6000 THEN 10
              WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) >= 4500 THEN 8
              WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) >= 3000 THEN 6
              WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) >= 2000 THEN 4
              ELSE 2
            END,
            hz.zone_id,
            EXTRACT(YEAR FROM now())::int,
            now()
          FROM public.parcels p
          LEFT JOIN LATERAL (
            SELECT z.id AS zone_id, z.prix_m2_median FROM public.dvf_hdbscan_zones z
            WHERE z.code_commune = p.insee_code AND z.type_local = 'Appartement'
              AND z.prix_m2_median IS NOT NULL AND z.geom IS NOT NULL
              AND ST_Contains(z.geom, ST_Centroid(ST_Transform(p.geom, 4326)))
            ORDER BY z.count DESC LIMIT 1
          ) hz ON true
          LEFT JOIN LATERAL (
            SELECT prix_m2_median FROM public.dvf_clusters_commune
            WHERE cluster_id = p.insee_code || '_Appartement' AND prix_m2_median IS NOT NULL LIMIT 1
          ) commune_appt ON true
          WHERE p.insee_code = p_insee
          ON CONFLICT (parcel_id) DO UPDATE SET
            median_price_m2=EXCLUDED.median_price_m2, market_tension_score=EXCLUDED.market_tension_score,
            hdbscan_zone_id=EXCLUDED.hdbscan_zone_id, analysis_year=EXCLUDED.analysis_year, updated_at=now();

          -- Step 3: constructibility with PLU sub-zones
          INSERT INTO public.parcel_constructibility (
            parcel_id, dominant_zone_family, plu_zone_code, zone_vocation,
            max_height_est, max_footprint_ratio_est, ces_applied,
            min_green_ratio_est, setback_penalty_est, setback_front_m, setback_side_m,
            parking_penalty_est,
            buildable_footprint_est, floors_est, estimated_gfa, residual_potential_est, underuse_ratio, updated_at)
          SELECT p.parcel_id,
            COALESCE(plu.zone_family, 'U'),
            plu.zone_code,
            COALESCE(plu.vocation, 'residentiel'),
            COALESCE(plu.max_height, v_h),
            COALESCE(plu.ces, v_fp),
            COALESCE(plu.ces, v_fp),
            COALESCE(plu.green_ratio, v_gr),
            CASE
              WHEN COALESCE(plu.setback_front, 0) + COALESCE(plu.setback_side, 0) = 0 THEN 1.0
              ELSE GREATEST(0.5,
                (GREATEST(0, SQRT(p.area_m2) - COALESCE(plu.setback_front,0) - COALESCE(plu.setback_side,0))
                 * GREATEST(0, SQRT(p.area_m2) - 2*COALESCE(plu.setback_side,0)))
                / NULLIF(p.area_m2, 0))
            END,
            COALESCE(plu.setback_front, 0),
            COALESCE(plu.setback_side, 0),
            1.0,
            bld.footprint, bld.floors, bld.gfa,
            GREATEST(0, bld.gfa - COALESCE(bs.existing_gfa_est, 0)),
            CASE WHEN bld.gfa > 0 THEN GREATEST(0, 1 - COALESCE(bs.existing_gfa_est,0) / bld.gfa) ELSE 0 END,
            now()
          FROM public.parcels p
          LEFT JOIN public.parcel_building_stats bs ON bs.parcel_id = p.parcel_id
          LEFT JOIN public.plu_zone_rules plu
            ON plu.zone_code = COALESCE(
              CASE
                WHEN COALESCE(bs.coverage_ratio,0) > 0.60 THEN 'UA'
                WHEN COALESCE(bs.coverage_ratio,0) > 0.35 THEN 'UB'
                WHEN p.area_m2 < 500 AND COALESCE(bs.coverage_ratio,0) > 0.15 THEN 'UC'
                WHEN p.area_m2 >= 2000 AND COALESCE(bs.coverage_ratio,0) < 0.10 THEN 'UE'
                ELSE 'UC'
              END, 'UC')
            AND plu.epci_code = 'BNS'
          CROSS JOIN LATERAL (
            SELECT
              LEAST(p.area_m2 * COALESCE(plu.ces,v_fp), p.area_m2 * (1 - COALESCE(plu.green_ratio,v_gr)))
              * CASE
                  WHEN COALESCE(plu.setback_front,0)+COALESCE(plu.setback_side,0)=0 THEN 1.0
                  ELSE GREATEST(0.5,
                    (GREATEST(0, SQRT(p.area_m2)-COALESCE(plu.setback_front,0)-COALESCE(plu.setback_side,0))
                     * GREATEST(0, SQRT(p.area_m2)-2*COALESCE(plu.setback_side,0)))
                    / NULLIF(p.area_m2,0))
                END AS footprint,
              GREATEST(1, FLOOR(COALESCE(plu.max_height,v_h) / 3.0))::int AS floors,
              LEAST(p.area_m2 * COALESCE(plu.ces,v_fp), p.area_m2 * (1 - COALESCE(plu.green_ratio,v_gr)))
              * CASE
                  WHEN COALESCE(plu.setback_front,0)+COALESCE(plu.setback_side,0)=0 THEN 1.0
                  ELSE GREATEST(0.5,
                    (GREATEST(0, SQRT(p.area_m2)-COALESCE(plu.setback_front,0)-COALESCE(plu.setback_side,0))
                     * GREATEST(0, SQRT(p.area_m2)-2*COALESCE(plu.setback_side,0)))
                    / NULLIF(p.area_m2,0))
                END
              * GREATEST(1, FLOOR(COALESCE(plu.max_height,v_h) / 3.0)) AS gfa
          ) bld
          WHERE p.insee_code = p_insee
          ON CONFLICT (parcel_id) DO UPDATE SET
            dominant_zone_family=EXCLUDED.dominant_zone_family, plu_zone_code=EXCLUDED.plu_zone_code,
            zone_vocation=EXCLUDED.zone_vocation, max_height_est=EXCLUDED.max_height_est,
            max_footprint_ratio_est=EXCLUDED.max_footprint_ratio_est, ces_applied=EXCLUDED.ces_applied,
            min_green_ratio_est=EXCLUDED.min_green_ratio_est, setback_penalty_est=EXCLUDED.setback_penalty_est,
            setback_front_m=EXCLUDED.setback_front_m, setback_side_m=EXCLUDED.setback_side_m,
            buildable_footprint_est=EXCLUDED.buildable_footprint_est, floors_est=EXCLUDED.floors_est,
            estimated_gfa=EXCLUDED.estimated_gfa, residual_potential_est=EXCLUDED.residual_potential_est,
            underuse_ratio=EXCLUDED.underuse_ratio, updated_at=now();

          -- Step 4: scores with ICH bilan promoteur
          INSERT INTO public.parcel_scores (
            parcel_id, mutability_score, underuse_score, zoning_score, market_score,
            size_score, land_value_score, best_use, land_value_est, program_value_est,
            nb_logements_est, nb_parking_places, parking_cost, parking_surface_m2,
            taxe_amenagement, taxe_amenagement_taux, zone_vocation, plu_zone_code,
            explanation_json, computed_at)
          SELECT p.parcel_id,
            ROUND((0.30*sub.us + 0.25*sub.zs + 0.20*sub.ms + 0.15*sub.ss + 0.10*sub.ls), 2),
            sub.us, sub.zs, sub.ms, sub.ss, sub.ls,
            CASE
              WHEN COALESCE(pc.zone_vocation,'residentiel')='economique' THEN
                CASE WHEN p.area_m2>=2000 AND pc.underuse_ratio>=0.70 THEN 'activite_economique'
                     WHEN p.area_m2>=500 AND pc.underuse_ratio>=0.50 THEN 'bureaux_commerces'
                     ELSE 'analyse_complementaire' END
              WHEN pc.dominant_zone_family IN ('U','AU') AND p.area_m2>=600 AND pc.underuse_ratio>=0.70 THEN 'densification_residentielle'
              WHEN pc.dominant_zone_family='U' AND p.area_m2 BETWEEN 300 AND 700 AND pc.underuse_ratio>=0.60 THEN 'division_parcellaire'
              WHEN pc.dominant_zone_family='U' AND COALESCE(bs.coverage_ratio,0)<0.15 THEN 'dent_creuse'
              WHEN COALESCE(pc.zone_vocation,'residentiel')='mixte' AND p.area_m2>=2000 AND pc.underuse_ratio>=0.60 THEN 'mixte_logements_activite'
              ELSE 'analyse_complementaire'
            END,
            bil.charge_fonciere, bil.ca,
            bil.nb_log, bil.nb_pk, bil.pk_cost, bil.pk_surf,
            bil.ta, v_ta_taux,
            COALESCE(pc.zone_vocation,'residentiel'), pc.plu_zone_code,
            jsonb_build_object(
              'area_m2',p.area_m2,'underuse_ratio',pc.underuse_ratio,
              'dominant_zone_family',pc.dominant_zone_family,'plu_zone_code',pc.plu_zone_code,
              'zone_vocation',COALESCE(pc.zone_vocation,'residentiel'),
              'ces_applied',pc.ces_applied,'max_height_est',pc.max_height_est,
              'setback_front_m',pc.setback_front_m,'setback_side_m',pc.setback_side_m,
              'median_price_m2',COALESCE(pms.median_price_m2,p_median_price),
              'estimated_gfa',pc.estimated_gfa,'residual_potential_est',pc.residual_potential_est,
              'coverage_ratio',bs.coverage_ratio,'hdbscan_zone_id',pms.hdbscan_zone_id,
              'surface_habitable',bil.surf_hab,'ca_total',bil.ca,
              'nb_logements_est',bil.nb_log,'prix_par_logement',CASE WHEN bil.nb_log>0 THEN bil.ca/bil.nb_log ELSE 0 END,
              'nb_parking_places',bil.nb_pk,
              'marge_promoteur',bil.marge,'cout_construction',bil.constr,
              'cout_vrd',bil.vrd,'cout_publicite',bil.pub,'cout_dette',bil.dette,
              'cout_parking',bil.pk_cost,'surface_parking',bil.pk_surf,
              'taxe_amenagement',bil.ta,'taxe_amenagement_taux',v_ta_taux,
              'total_depenses',bil.total_dep,'charge_fonciere',bil.charge_fonciere,
              'charge_fonciere_m2_terrain',CASE WHEN p.area_m2>0 THEN bil.charge_fonciere/p.area_m2 ELSE 0 END
            ),
            now()
          FROM public.parcels p
          JOIN public.parcel_constructibility pc ON pc.parcel_id=p.parcel_id
          LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id=p.parcel_id
          LEFT JOIN public.parcel_building_stats bs ON bs.parcel_id=p.parcel_id
          LEFT JOIN public.plu_zone_rules plu_r ON plu_r.zone_code=pc.plu_zone_code AND plu_r.epci_code='BNS'
          CROSS JOIN LATERAL (
            SELECT
              GREATEST(1, FLOOR(pc.estimated_gfa/60.0))::int AS nb_log,
              (pc.estimated_gfa * v_sr) AS surf_hab,
              (pc.estimated_gfa * v_sr * COALESCE(pms.median_price_m2,p_median_price)) AS ca,
              -- Parking places
              CASE WHEN COALESCE(pc.zone_vocation,'residentiel')='economique'
                THEN GREATEST(1, CEIL(pc.estimated_gfa/100.0*COALESCE(plu_r.parking_per_100m2_eco,1.0)))::int
                ELSE GREATEST(1, CEIL(GREATEST(1,FLOOR(pc.estimated_gfa/60.0))
                  *(0.10*COALESCE(plu_r.parking_logement_t1,1.0)+0.25*COALESCE(plu_r.parking_logement_t2,1.5)
                   +0.35*COALESCE(plu_r.parking_logement_t3,1.5)+0.20*COALESCE(plu_r.parking_logement_t4,1.5)
                   +0.10*COALESCE(plu_r.parking_logement_t5,2.0))))::int
              END AS nb_pk,
              -- Bilan ICH
              (pc.estimated_gfa * v_sr * COALESCE(pms.median_price_m2,p_median_price)) * v_mg AS marge,
              (pc.estimated_gfa * v_cc) AS constr,
              (p.area_m2 * v_vrd) AS vrd,
              (pc.estimated_gfa * v_sr * COALESCE(pms.median_price_m2,p_median_price)) * v_pub AS pub,
              ((pc.estimated_gfa*v_cc) + (pc.estimated_gfa*v_sr*COALESCE(pms.median_price_m2,p_median_price))*v_pub + (p.area_m2*v_vrd)) * v_dette AS dette,
              -- Parking cost
              CASE WHEN COALESCE(pc.zone_vocation,'residentiel')='economique'
                THEN GREATEST(1, CEIL(pc.estimated_gfa/100.0*COALESCE(plu_r.parking_per_100m2_eco,1.0))) * v_pk_cost
                ELSE GREATEST(1, CEIL(GREATEST(1,FLOOR(pc.estimated_gfa/60.0))
                  *(0.10*COALESCE(plu_r.parking_logement_t1,1.0)+0.25*COALESCE(plu_r.parking_logement_t2,1.5)
                   +0.35*COALESCE(plu_r.parking_logement_t3,1.5)+0.20*COALESCE(plu_r.parking_logement_t4,1.5)
                   +0.10*COALESCE(plu_r.parking_logement_t5,2.0)))) * v_pk_cost
              END AS pk_cost,
              CASE WHEN COALESCE(pc.zone_vocation,'residentiel')='economique'
                THEN GREATEST(1, CEIL(pc.estimated_gfa/100.0*COALESCE(plu_r.parking_per_100m2_eco,1.0))) * v_pk_surf
                ELSE GREATEST(1, CEIL(GREATEST(1,FLOOR(pc.estimated_gfa/60.0))
                  *(0.10*COALESCE(plu_r.parking_logement_t1,1.0)+0.25*COALESCE(plu_r.parking_logement_t2,1.5)
                   +0.35*COALESCE(plu_r.parking_logement_t3,1.5)+0.20*COALESCE(plu_r.parking_logement_t4,1.5)
                   +0.10*COALESCE(plu_r.parking_logement_t5,2.0)))) * v_pk_surf
              END AS pk_surf,
              (pc.estimated_gfa * v_ta_val * v_ta_taux) AS ta,
              -- Total dépenses
              (pc.estimated_gfa*v_sr*COALESCE(pms.median_price_m2,p_median_price))*v_mg
              + (pc.estimated_gfa*v_cc) + (p.area_m2*v_vrd)
              + (pc.estimated_gfa*v_sr*COALESCE(pms.median_price_m2,p_median_price))*v_pub
              + ((pc.estimated_gfa*v_cc)+(pc.estimated_gfa*v_sr*COALESCE(pms.median_price_m2,p_median_price))*v_pub+(p.area_m2*v_vrd))*v_dette
              + CASE WHEN COALESCE(pc.zone_vocation,'residentiel')='economique'
                  THEN GREATEST(1,CEIL(pc.estimated_gfa/100.0*COALESCE(plu_r.parking_per_100m2_eco,1.0)))*v_pk_cost
                  ELSE GREATEST(1,CEIL(GREATEST(1,FLOOR(pc.estimated_gfa/60.0))
                    *(0.10*COALESCE(plu_r.parking_logement_t1,1.0)+0.25*COALESCE(plu_r.parking_logement_t2,1.5)
                     +0.35*COALESCE(plu_r.parking_logement_t3,1.5)+0.20*COALESCE(plu_r.parking_logement_t4,1.5)
                     +0.10*COALESCE(plu_r.parking_logement_t5,2.0))))*v_pk_cost
                END
              + (pc.estimated_gfa*v_ta_val*v_ta_taux)
              AS total_dep,
              -- Charge foncière = CA - total dépenses
              (pc.estimated_gfa*v_sr*COALESCE(pms.median_price_m2,p_median_price))
              - (pc.estimated_gfa*v_sr*COALESCE(pms.median_price_m2,p_median_price))*v_mg
              - (pc.estimated_gfa*v_cc) - (p.area_m2*v_vrd)
              - (pc.estimated_gfa*v_sr*COALESCE(pms.median_price_m2,p_median_price))*v_pub
              - ((pc.estimated_gfa*v_cc)+(pc.estimated_gfa*v_sr*COALESCE(pms.median_price_m2,p_median_price))*v_pub+(p.area_m2*v_vrd))*v_dette
              - CASE WHEN COALESCE(pc.zone_vocation,'residentiel')='economique'
                  THEN GREATEST(1,CEIL(pc.estimated_gfa/100.0*COALESCE(plu_r.parking_per_100m2_eco,1.0)))*v_pk_cost
                  ELSE GREATEST(1,CEIL(GREATEST(1,FLOOR(pc.estimated_gfa/60.0))
                    *(0.10*COALESCE(plu_r.parking_logement_t1,1.0)+0.25*COALESCE(plu_r.parking_logement_t2,1.5)
                     +0.35*COALESCE(plu_r.parking_logement_t3,1.5)+0.20*COALESCE(plu_r.parking_logement_t4,1.5)
                     +0.10*COALESCE(plu_r.parking_logement_t5,2.0))))*v_pk_cost
                END
              - (pc.estimated_gfa*v_ta_val*v_ta_taux)
              AS charge_fonciere
          ) bil
          CROSS JOIN LATERAL (
            SELECT
              CASE WHEN pc.underuse_ratio>=0.80 THEN 10 WHEN pc.underuse_ratio>=0.60 THEN 8 WHEN pc.underuse_ratio>=0.40 THEN 6 WHEN pc.underuse_ratio>=0.20 THEN 4 ELSE 1 END AS us,
              CASE WHEN pc.dominant_zone_family='U' THEN 9 WHEN pc.dominant_zone_family='AU' THEN 7 WHEN pc.dominant_zone_family='A' THEN 2 WHEN pc.dominant_zone_family='N' THEN 1 ELSE 3 END AS zs,
              CASE WHEN COALESCE(pms.median_price_m2,p_median_price)>=6000 THEN 10 WHEN COALESCE(pms.median_price_m2,p_median_price)>=4500 THEN 8 WHEN COALESCE(pms.median_price_m2,p_median_price)>=3000 THEN 6 WHEN COALESCE(pms.median_price_m2,p_median_price)>=2000 THEN 4 ELSE 2 END AS ms,
              CASE WHEN p.area_m2>=1000 THEN 9 WHEN p.area_m2>=600 THEN 7 WHEN p.area_m2>=300 THEN 5 ELSE 2 END AS ss,
              CASE WHEN bil.charge_fonciere>=1500000 THEN 10 WHEN bil.charge_fonciere>=800000 THEN 8 WHEN bil.charge_fonciere>=400000 THEN 6 WHEN bil.charge_fonciere>=150000 THEN 4 ELSE 2 END AS ls
          ) sub
          WHERE p.insee_code = p_insee
          ON CONFLICT (parcel_id) DO UPDATE SET
            mutability_score=EXCLUDED.mutability_score, underuse_score=EXCLUDED.underuse_score,
            zoning_score=EXCLUDED.zoning_score, market_score=EXCLUDED.market_score,
            size_score=EXCLUDED.size_score, land_value_score=EXCLUDED.land_value_score,
            best_use=EXCLUDED.best_use, land_value_est=EXCLUDED.land_value_est,
            program_value_est=EXCLUDED.program_value_est,
            nb_logements_est=EXCLUDED.nb_logements_est, nb_parking_places=EXCLUDED.nb_parking_places,
            parking_cost=EXCLUDED.parking_cost, parking_surface_m2=EXCLUDED.parking_surface_m2,
            taxe_amenagement=EXCLUDED.taxe_amenagement, taxe_amenagement_taux=EXCLUDED.taxe_amenagement_taux,
            zone_vocation=EXCLUDED.zone_vocation, plu_zone_code=EXCLUDED.plu_zone_code,
            explanation_json=EXCLUDED.explanation_json, computed_at=now();

          SELECT count(*) INTO scored_count FROM public.parcel_scores WHERE parcel_id LIKE p_insee || '%';
          NOTIFY pgrst, 'reload schema';
          RETURN scored_count;
        END;
        $fn$;
      `, "updated score_commune_parcels with ICH bilan + PLU"));

      logs.push(await runSQL(client, `NOTIFY pgrst, 'reload schema';`, "final reload after migrate-plu"));
    }

    return NextResponse.json({ success: true, logs });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logs.push(`FATAL: ${msg}`);
    return NextResponse.json({ success: false, logs }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}
