import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";

const ADMIN_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY;

function getDbConfig() {
  const ref = "zexkxstcwkdsqjgsppvx";
  const password = process.env.SUPABASE_DB_PASSWORD || ADMIN_SECRET;
  return {
    host: `aws-0-eu-west-3.pooler.supabase.com`,
    port: 5432,
    database: "postgres",
    user: `postgres.${ref}`,
    password: password!,
    ssl: { rejectUnauthorized: false },
  };
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

  const client = new Client(getDbConfig());
  const logs: string[] = [];

  try {
    await client.connect();
    logs.push("Connected to database");

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
          pms.median_price_m2,
          p.geom
        FROM public.parcels p
        LEFT JOIN public.parcel_scores pcs ON pcs.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
        LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id = p.parcel_id;
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

    return NextResponse.json({ success: true, logs });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logs.push(`FATAL: ${msg}`);
    return NextResponse.json({ success: false, logs }, { status: 500 });
  } finally {
    await client.end().catch(() => {});
  }
}
