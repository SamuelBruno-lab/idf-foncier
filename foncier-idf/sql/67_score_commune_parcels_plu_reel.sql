-- ============================================================
-- Migration 67 : score_commune_parcels utilise le VRAI PLU quand connu
-- Base : sql/11_fix_pipeline_hdbscan.sql (version active verifiee).
-- CREATE OR REPLACE, MEME SIGNATURE (p_insee, p_median_price) -> aucun
-- appelant a modifier (route /api/foncier/pipeline inchangee).
--
-- Steps 1 (building stats) et 2 (market stats HDBSCAN) : INCHANGES,
-- copies a l'identique de la migration 11.
-- Step 3 (constructibility) : MODIFIE -- rattachement spatial parcelle ->
-- zone PLU reelle (plu_zone_urba_geom + plu_zone_rules_reel), puis COALESCE
-- de repli vers les memes constantes generiques qu'avant si la commune/zone
-- n'a pas encore ete extraite. Ajoute le plafond de bande constructible
-- (au-dela, seules des annexes sont autorisees -- decouverte du prototype).
-- Step 4 (final scores) : INCHANGE dans sa logique (le bonus de confiance
-- sur ces_source='reel' est repousse en V1.1, hors scope pour limiter le
-- risque de regression sur le tri des scores existants).
--
-- NON-REGRESSION OBLIGATOIRE avant de considerer cette migration sure :
-- ré-executer score_commune_parcels() sur une commune DEJA scoree et SANS
-- PLU reel extrait, verifier que mutability_score et residual_potential_est
-- sont IDENTIQUES a avant (le repli doit etre invisible). Cf. section
-- "Verification" du plan.
-- ============================================================

CREATE OR REPLACE FUNCTION public.score_commune_parcels(
  p_insee TEXT,
  p_median_price NUMERIC DEFAULT 4000
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  scored_count INTEGER;
  v_h NUMERIC := 12;        -- max height (Zone U default) -- repli si pas de PLU reel
  v_fp NUMERIC := 0.40;     -- max footprint ratio (CES)     -- repli si pas de PLU reel
  v_gr NUMERIC := 0.20;     -- min green ratio
  v_sb NUMERIC := 0.85;     -- setback penalty
  v_pk NUMERIC := 0.90;     -- parking penalty
  v_sr NUMERIC := 0.75;     -- sellable ratio
  v_cc NUMERIC := 1300;     -- construction cost EUR/m²
  v_vrd NUMERIC := 100;     -- VRD cost EUR/m²
  v_sf NUMERIC := 0.03;     -- selling fees ratio
  v_mg NUMERIC := 0.08;     -- margin ratio
BEGIN
  -- Step 1: building stats (spatial intersection parcels × buildings) -- INCHANGE
  INSERT INTO public.parcel_building_stats (
    parcel_id, built_footprint_m2, building_count, existing_gfa_est, coverage_ratio, updated_at
  )
  SELECT
    p.parcel_id,
    COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom))), 0),
    COUNT(DISTINCT b.building_id) FILTER (WHERE ST_Intersects(p.geom, b.geom)),
    COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom)) * COALESCE(b.levels_est, 1)), 0),
    CASE WHEN p.area_m2 > 0
      THEN COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom))), 0) / p.area_m2
      ELSE 0
    END,
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

  -- Step 2: market stats — HDBSCAN micro-zone spatial match + commune fallback -- INCHANGE
  INSERT INTO public.parcel_market_stats (
    parcel_id, median_price_m2, market_tension_score, hdbscan_zone_id, analysis_year, updated_at
  )
  SELECT
    p.parcel_id,
    COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) AS median_price_m2,
    CASE
      WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) >= 6000 THEN 10
      WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) >= 4500 THEN 8
      WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) >= 3000 THEN 6
      WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median, p_median_price) >= 2000 THEN 4
      ELSE 2
    END AS market_tension_score,
    hz.zone_id AS hdbscan_zone_id,
    EXTRACT(YEAR FROM now())::int AS analysis_year,
    now() AS updated_at
  FROM public.parcels p
  LEFT JOIN LATERAL (
    SELECT z.id AS zone_id, z.prix_m2_median
    FROM public.dvf_hdbscan_zones z
    WHERE z.code_commune = p.insee_code
      AND z.type_local = 'Appartement'
      AND z.prix_m2_median IS NOT NULL
      AND z.geom IS NOT NULL
      AND ST_Contains(z.geom, ST_Centroid(ST_Transform(p.geom, 4326)))
    ORDER BY z.count DESC
    LIMIT 1
  ) hz ON true
  LEFT JOIN LATERAL (
    SELECT prix_m2_median
    FROM public.dvf_clusters_commune
    WHERE cluster_id = p.insee_code || '_Appartement'
      AND prix_m2_median IS NOT NULL
    LIMIT 1
  ) commune_appt ON true
  WHERE p.insee_code = p_insee
  ON CONFLICT (parcel_id) DO UPDATE SET
    median_price_m2 = EXCLUDED.median_price_m2,
    market_tension_score = EXCLUDED.market_tension_score,
    hdbscan_zone_id = EXCLUDED.hdbscan_zone_id,
    analysis_year = EXCLUDED.analysis_year,
    updated_at = now();

  -- Step 2.5 (NOUVEAU) : rattachement parcelle -> zone PLU REELLE, par
  -- intersection spatiale du centroide parcelle dans le zonage GPU importe.
  -- Table temporaire : evite de refaire le ST_Contains 2x (calcul + traçabilite).
  DROP TABLE IF EXISTS tmp_parcel_zone_reel;
  CREATE TEMP TABLE tmp_parcel_zone_reel ON COMMIT DROP AS
  SELECT
    p.parcel_id,
    zg.zone_libelle,
    r.zone_family,
    r.vocation,
    r.ces,
    r.hauteur_max_m,
    r.bande_constructible_m,
    r.recul_voie_m
  FROM public.parcels p
  LEFT JOIN LATERAL (
    SELECT z.zone_libelle, z.geom
    FROM public.plu_zone_urba_geom z
    WHERE z.insee_code = p.insee_code
      AND ST_Contains(z.geom, ST_Centroid(p.geom))
    ORDER BY ST_Area(z.geom) ASC  -- zone la plus petite en cas de chevauchement
    LIMIT 1
  ) zg ON true
  LEFT JOIN public.plu_zone_rules_reel r
    ON r.insee_code = p.insee_code AND r.zone_libelle = zg.zone_libelle
  WHERE p.insee_code = p_insee;

  -- Step 3: constructibility -- MODIFIE : COALESCE de repli vers les
  -- constantes generiques (v_h/v_fp) si aucune regle reelle trouvee pour
  -- cette parcelle -> comportement IDENTIQUE a avant pour les communes non
  -- encore extraites (ces_source = 'generique').
  INSERT INTO public.parcel_constructibility (
    parcel_id, dominant_zone_family, max_height_est, max_footprint_ratio_est,
    min_green_ratio_est, setback_penalty_est, parking_penalty_est,
    buildable_footprint_est, floors_est, estimated_gfa,
    residual_potential_est, underuse_ratio,
    plu_zone_code, zone_vocation, ces_applied, setback_front_m, ces_source,
    updated_at
  )
  SELECT
    p.parcel_id,
    COALESCE(tz.zone_family, 'U') AS dominant_zone_family,
    eff.v_h_eff,
    eff.v_fp_eff,
    v_gr, v_sb, v_pk,
    eff.buildable_footprint,
    eff.floors,
    eff.buildable_footprint * eff.floors * v_pk AS estimated_gfa,
    GREATEST(0, eff.buildable_footprint * eff.floors * v_pk - COALESCE(bs.existing_gfa_est, 0)),
    CASE WHEN (eff.buildable_footprint * eff.floors * v_pk) > 0
      THEN GREATEST(0, 1 - COALESCE(bs.existing_gfa_est, 0) / (eff.buildable_footprint * eff.floors * v_pk))
      ELSE 0
    END,
    tz.zone_libelle AS plu_zone_code,
    COALESCE(tz.vocation, 'residentiel') AS zone_vocation,
    eff.v_fp_eff AS ces_applied,
    tz.recul_voie_m AS setback_front_m,
    CASE WHEN tz.ces IS NOT NULL OR tz.hauteur_max_m IS NOT NULL THEN 'reel' ELSE 'generique' END AS ces_source,
    now()
  FROM public.parcels p
  LEFT JOIN public.parcel_building_stats bs ON bs.parcel_id = p.parcel_id
  LEFT JOIN tmp_parcel_zone_reel tz ON tz.parcel_id = p.parcel_id
  CROSS JOIN LATERAL (
    SELECT
      COALESCE(tz.ces, v_fp) AS v_fp_eff,
      COALESCE(tz.hauteur_max_m, v_h) AS v_h_eff
  ) base
  CROSS JOIN LATERAL (
    SELECT
      base.v_fp_eff,
      base.v_h_eff,
      -- Emprise constructible : CES x surface, plafonnee par le ratio vert/
      -- setback (comme avant), ET par la bande constructible si connue
      -- (au-dela, seuls des annexes sont autorisees -- LEAST ajoute donc un
      -- 3e plafond, jamais moins restrictif que l'ancien calcul).
      -- SQRT(area) comme proxy de facade en l'absence de geometrie de
      -- facade reelle : approximation documentee, a affiner en V2.
      LEAST(
        p.area_m2 * base.v_fp_eff,
        p.area_m2 * (1 - v_gr) * v_sb,
        CASE WHEN tz.bande_constructible_m IS NOT NULL
          THEN SQRT(p.area_m2) * tz.bande_constructible_m
          ELSE p.area_m2 * base.v_fp_eff  -- bande inconnue -> pas de plafond supplementaire
        END
      ) AS buildable_footprint,
      GREATEST(1, FLOOR(base.v_h_eff / 3.5))::int AS floors
  ) eff
  WHERE p.insee_code = p_insee
  ON CONFLICT (parcel_id) DO UPDATE SET
    dominant_zone_family = EXCLUDED.dominant_zone_family,
    max_height_est = EXCLUDED.max_height_est,
    max_footprint_ratio_est = EXCLUDED.max_footprint_ratio_est,
    buildable_footprint_est = EXCLUDED.buildable_footprint_est,
    floors_est = EXCLUDED.floors_est,
    estimated_gfa = EXCLUDED.estimated_gfa,
    residual_potential_est = EXCLUDED.residual_potential_est,
    underuse_ratio = EXCLUDED.underuse_ratio,
    plu_zone_code = EXCLUDED.plu_zone_code,
    zone_vocation = EXCLUDED.zone_vocation,
    ces_applied = EXCLUDED.ces_applied,
    setback_front_m = EXCLUDED.setback_front_m,
    ces_source = EXCLUDED.ces_source,
    updated_at = now();

  -- Step 4: final scores -- INCHANGE (logique identique a la migration 11).
  INSERT INTO public.parcel_scores (
    parcel_id, mutability_score, underuse_score, zoning_score, market_score,
    size_score, land_value_score, best_use, land_value_est, program_value_est,
    explanation_json, computed_at
  )
  SELECT
    p.parcel_id,
    ROUND((0.30*sub.underuse_score + 0.25*sub.zoning_score
           + 0.20*sub.market_score + 0.15*sub.size_score
           + 0.10*sub.land_value_score), 2),
    sub.underuse_score, sub.zoning_score, sub.market_score,
    sub.size_score, sub.land_value_score,
    CASE
      WHEN pc.dominant_zone_family IN ('U','AU')
           AND p.area_m2 >= 600 AND pc.underuse_ratio >= 0.70
        THEN 'densification_residentielle'
      WHEN pc.dominant_zone_family = 'U'
           AND p.area_m2 BETWEEN 300 AND 700 AND pc.underuse_ratio >= 0.60
        THEN 'division_parcellaire'
      WHEN pc.dominant_zone_family = 'U'
           AND COALESCE(bs.coverage_ratio, 0) < 0.15
        THEN 'dent_creuse'
      ELSE 'analyse_complementaire'
    END,
    calc.lv, calc.pv,
    jsonb_build_object(
      'area_m2', p.area_m2,
      'underuse_ratio', pc.underuse_ratio,
      'dominant_zone_family', pc.dominant_zone_family,
      'median_price_m2', pms.median_price_m2,
      'estimated_gfa', pc.estimated_gfa,
      'residual_potential_est', pc.residual_potential_est,
      'coverage_ratio', bs.coverage_ratio,
      'hdbscan_zone_id', pms.hdbscan_zone_id,
      'ces_source', pc.ces_source,
      'plu_zone_code', pc.plu_zone_code
    ),
    now()
  FROM public.parcels p
  JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
  LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id = p.parcel_id
  LEFT JOIN public.parcel_building_stats bs ON bs.parcel_id = p.parcel_id
  CROSS JOIN LATERAL (
    SELECT
      (pc.estimated_gfa * v_sr * COALESCE(pms.median_price_m2, p_median_price)) AS pv,
      (pc.estimated_gfa * v_sr * COALESCE(pms.median_price_m2, p_median_price))
      - (pc.estimated_gfa * v_cc) - (pc.estimated_gfa * v_vrd)
      - ((pc.estimated_gfa * v_sr * COALESCE(pms.median_price_m2, p_median_price)) * v_sf)
      - ((pc.estimated_gfa * v_sr * COALESCE(pms.median_price_m2, p_median_price)) * v_mg)
      AS lv
  ) calc
  CROSS JOIN LATERAL (
    SELECT
      CASE WHEN pc.underuse_ratio >= 0.80 THEN 10
           WHEN pc.underuse_ratio >= 0.60 THEN 8
           WHEN pc.underuse_ratio >= 0.40 THEN 6
           WHEN pc.underuse_ratio >= 0.20 THEN 4
           ELSE 1 END AS underuse_score,
      CASE WHEN pc.dominant_zone_family = 'U' THEN 9
           WHEN pc.dominant_zone_family = 'AU' THEN 7
           WHEN pc.dominant_zone_family = 'A' THEN 2
           WHEN pc.dominant_zone_family = 'N' THEN 1
           ELSE 3 END AS zoning_score,
      CASE WHEN COALESCE(pms.median_price_m2, p_median_price) >= 6000 THEN 10
           WHEN COALESCE(pms.median_price_m2, p_median_price) >= 4500 THEN 8
           WHEN COALESCE(pms.median_price_m2, p_median_price) >= 3000 THEN 6
           WHEN COALESCE(pms.median_price_m2, p_median_price) >= 2000 THEN 4
           ELSE 2 END AS market_score,
      CASE WHEN p.area_m2 >= 1000 THEN 9
           WHEN p.area_m2 >= 600 THEN 7
           WHEN p.area_m2 >= 300 THEN 5
           ELSE 2 END AS size_score,
      CASE WHEN calc.lv >= 1500000 THEN 10
           WHEN calc.lv >= 800000 THEN 8
           WHEN calc.lv >= 400000 THEN 6
           WHEN calc.lv >= 150000 THEN 4
           ELSE 2 END AS land_value_score
  ) sub
  WHERE p.insee_code = p_insee
  ON CONFLICT (parcel_id) DO UPDATE SET
    mutability_score = EXCLUDED.mutability_score,
    underuse_score = EXCLUDED.underuse_score,
    zoning_score = EXCLUDED.zoning_score,
    market_score = EXCLUDED.market_score,
    size_score = EXCLUDED.size_score,
    land_value_score = EXCLUDED.land_value_score,
    best_use = EXCLUDED.best_use,
    land_value_est = EXCLUDED.land_value_est,
    program_value_est = EXCLUDED.program_value_est,
    explanation_json = EXCLUDED.explanation_json,
    computed_at = now();

  -- Count scored -- INCHANGE
  SELECT count(*) INTO scored_count
  FROM public.parcel_scores
  WHERE parcel_id LIKE p_insee || '%';

  -- Refresh PostgREST schema cache -- INCHANGE
  NOTIFY pgrst, 'reload schema';

  RETURN scored_count;
END;
$$;

-- ============================================================
-- Verification de non-regression (a executer manuellement) :
--
--   -- 1. Choisir une commune DEJA scoree, SANS PLU reel extrait (ex. une
--      commune hors 94081/94033) :
--   SELECT parcel_id, mutability_score, residual_potential_est, ces_source
--   FROM public.v_parcel_foncier  -- ou parcel_scores + parcel_constructibility
--   WHERE insee_code = '<commune_temoin>'
--   ORDER BY parcel_id LIMIT 20;
--   -- (noter les valeurs AVANT d'appliquer cette migration)
--
--   -- 2. Appliquer la migration, puis ré-executer le scoring :
--   SELECT public.score_commune_parcels('<commune_temoin>', 4000);
--
--   -- 3. Reverifier les memes lignes : mutability_score et
--      residual_potential_est DOIVENT etre identiques, ces_source DOIT
--      valoir 'generique' pour toutes les parcelles de cette commune.
-- ============================================================
