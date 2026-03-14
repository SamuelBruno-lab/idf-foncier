-- Function 1: Batch ingest cadastre parcels (WGS84 → Lambert93)
CREATE OR REPLACE FUNCTION public.ingest_cadastre_batch(parcels_json TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT
      j->>'parcel_id' AS parcel_id,
      j->>'insee_code' AS insee_code,
      j->>'section' AS section,
      j->>'number' AS number,
      (j->>'area_m2')::numeric AS area_m2,
      j->>'city_name' AS city_name,
      j->>'geojson' AS geojson
    FROM jsonb_array_elements(parcels_json::jsonb) AS j
  LOOP
    INSERT INTO public.parcels (parcel_id, insee_code, section, number, area_m2, city_name, geom)
    VALUES (
      rec.parcel_id,
      rec.insee_code,
      rec.section,
      rec.number,
      rec.area_m2,
      rec.city_name,
      ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(rec.geojson), 4326), 2154))
    )
    ON CONFLICT (parcel_id) DO UPDATE SET
      area_m2 = EXCLUDED.area_m2,
      city_name = EXCLUDED.city_name,
      geom = EXCLUDED.geom;
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;

-- Function 2: Score all parcels for a commune
CREATE OR REPLACE FUNCTION public.score_commune_parcels(
  p_insee TEXT,
  p_median_price NUMERIC DEFAULT 4000
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  scored_count INTEGER;
  v_h NUMERIC := 12;        -- max height (Zone U default)
  v_fp NUMERIC := 0.40;     -- max footprint ratio
  v_gr NUMERIC := 0.20;     -- min green ratio
  v_sb NUMERIC := 0.85;     -- setback penalty
  v_pk NUMERIC := 0.90;     -- parking penalty
  v_sr NUMERIC := 0.75;     -- sellable ratio
  v_cc NUMERIC := 1300;     -- construction cost EUR/m²
  v_vrd NUMERIC := 100;     -- VRD cost EUR/m²
  v_sf NUMERIC := 0.03;     -- selling fees ratio
  v_mg NUMERIC := 0.08;     -- margin ratio
BEGIN
  -- Step 1: building stats (no buildings for real cadastre yet, just init to 0)
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
  WHERE p.insee_code = p_insee
  GROUP BY p.parcel_id, p.area_m2
  ON CONFLICT (parcel_id) DO UPDATE SET
    built_footprint_m2 = EXCLUDED.built_footprint_m2,
    building_count = EXCLUDED.building_count,
    existing_gfa_est = EXCLUDED.existing_gfa_est,
    coverage_ratio = EXCLUDED.coverage_ratio,
    updated_at = now();

  -- Step 2: market stats
  INSERT INTO public.parcel_market_stats (parcel_id, median_price_m2, market_tension_score, analysis_year, updated_at)
  SELECT
    p.parcel_id,
    p_median_price,
    CASE
      WHEN p_median_price >= 6000 THEN 10
      WHEN p_median_price >= 4500 THEN 8
      WHEN p_median_price >= 3000 THEN 6
      WHEN p_median_price >= 2000 THEN 4
      ELSE 2
    END,
    EXTRACT(YEAR FROM now())::int,
    now()
  FROM public.parcels p
  WHERE p.insee_code = p_insee
  ON CONFLICT (parcel_id) DO UPDATE SET
    median_price_m2 = EXCLUDED.median_price_m2,
    market_tension_score = EXCLUDED.market_tension_score,
    updated_at = now();

  -- Step 3: constructibility
  INSERT INTO public.parcel_constructibility (
    parcel_id, dominant_zone_family, max_height_est, max_footprint_ratio_est,
    min_green_ratio_est, setback_penalty_est, parking_penalty_est,
    buildable_footprint_est, floors_est, estimated_gfa, residual_potential_est, underuse_ratio, updated_at
  )
  SELECT
    p.parcel_id, 'U', v_h, v_fp, v_gr, v_sb, v_pk,
    LEAST(p.area_m2 * v_fp, p.area_m2 * (1 - v_gr) * v_sb),
    GREATEST(1, FLOOR(v_h / 3.5))::int,
    LEAST(p.area_m2 * v_fp, p.area_m2 * (1 - v_gr) * v_sb) * GREATEST(1, FLOOR(v_h / 3.5)) * v_pk,
    GREATEST(0,
      LEAST(p.area_m2 * v_fp, p.area_m2 * (1 - v_gr) * v_sb) * GREATEST(1, FLOOR(v_h / 3.5)) * v_pk
      - COALESCE(bs.existing_gfa_est, 0)
    ),
    CASE WHEN (LEAST(p.area_m2 * v_fp, p.area_m2 * (1 - v_gr) * v_sb) * GREATEST(1, FLOOR(v_h / 3.5)) * v_pk) > 0
      THEN GREATEST(0, 1 - COALESCE(bs.existing_gfa_est, 0) /
        (LEAST(p.area_m2 * v_fp, p.area_m2 * (1 - v_gr) * v_sb) * GREATEST(1, FLOOR(v_h / 3.5)) * v_pk))
      ELSE 0
    END,
    now()
  FROM public.parcels p
  LEFT JOIN public.parcel_building_stats bs ON bs.parcel_id = p.parcel_id
  WHERE p.insee_code = p_insee
  ON CONFLICT (parcel_id) DO UPDATE SET
    dominant_zone_family = EXCLUDED.dominant_zone_family,
    buildable_footprint_est = EXCLUDED.buildable_footprint_est,
    floors_est = EXCLUDED.floors_est,
    estimated_gfa = EXCLUDED.estimated_gfa,
    residual_potential_est = EXCLUDED.residual_potential_est,
    underuse_ratio = EXCLUDED.underuse_ratio,
    updated_at = now();

  -- Step 4: final scores
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
      WHEN pc.dominant_zone_family = 'U' AND COALESCE(bs.coverage_ratio, 0) < 0.15 THEN 'dent_creuse'
      ELSE 'analyse_complementaire'
    END,
    calc.lv, calc.pv,
    jsonb_build_object(
      'area_m2', p.area_m2, 'underuse_ratio', pc.underuse_ratio,
      'dominant_zone_family', pc.dominant_zone_family,
      'median_price_m2', p_median_price,
      'estimated_gfa', pc.estimated_gfa,
      'residual_potential_est', pc.residual_potential_est,
      'coverage_ratio', bs.coverage_ratio
    ),
    now()
  FROM public.parcels p
  JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
  LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id = p.parcel_id
  LEFT JOIN public.parcel_building_stats bs ON bs.parcel_id = p.parcel_id
  CROSS JOIN LATERAL (
    SELECT
      (pc.estimated_gfa * v_sr * p_median_price) AS pv,
      (pc.estimated_gfa * v_sr * p_median_price)
      - (pc.estimated_gfa * v_cc) - (pc.estimated_gfa * v_vrd)
      - ((pc.estimated_gfa * v_sr * p_median_price) * v_sf)
      - ((pc.estimated_gfa * v_sr * p_median_price) * v_mg)
      AS lv
  ) calc
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN pc.underuse_ratio >= 0.80 THEN 10 WHEN pc.underuse_ratio >= 0.60 THEN 8 WHEN pc.underuse_ratio >= 0.40 THEN 6 WHEN pc.underuse_ratio >= 0.20 THEN 4 ELSE 1 END AS underuse_score,
      CASE WHEN pc.dominant_zone_family = 'U' THEN 9 WHEN pc.dominant_zone_family = 'AU' THEN 7 WHEN pc.dominant_zone_family = 'A' THEN 2 WHEN pc.dominant_zone_family = 'N' THEN 1 ELSE 3 END AS zoning_score,
      CASE WHEN p_median_price >= 6000 THEN 10 WHEN p_median_price >= 4500 THEN 8 WHEN p_median_price >= 3000 THEN 6 WHEN p_median_price >= 2000 THEN 4 ELSE 2 END AS market_score,
      CASE WHEN p.area_m2 >= 1000 THEN 9 WHEN p.area_m2 >= 600 THEN 7 WHEN p.area_m2 >= 300 THEN 5 ELSE 2 END AS size_score,
      CASE WHEN calc.lv >= 1500000 THEN 10 WHEN calc.lv >= 800000 THEN 8 WHEN calc.lv >= 400000 THEN 6 WHEN calc.lv >= 150000 THEN 4 ELSE 2 END AS land_value_score
  ) sub
  WHERE p.insee_code = p_insee
  ON CONFLICT (parcel_id) DO UPDATE SET
    mutability_score = EXCLUDED.mutability_score, underuse_score = EXCLUDED.underuse_score,
    zoning_score = EXCLUDED.zoning_score, market_score = EXCLUDED.market_score,
    size_score = EXCLUDED.size_score, land_value_score = EXCLUDED.land_value_score,
    best_use = EXCLUDED.best_use, land_value_est = EXCLUDED.land_value_est,
    program_value_est = EXCLUDED.program_value_est, explanation_json = EXCLUDED.explanation_json,
    computed_at = now();

  -- Count scored
  SELECT count(*) INTO scored_count
  FROM public.parcel_scores
  WHERE parcel_id LIKE p_insee || '%';

  -- Refresh PostgREST
  NOTIFY pgrst, 'reload schema';

  RETURN scored_count;
END;
$$;
