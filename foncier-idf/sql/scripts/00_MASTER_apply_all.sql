-- ================================================================
-- SCRIPT CONSOLIDE -- toutes les migrations SQL de la session
-- "prefaisabilite complete + simulation interactive" (66 -> 77),
-- + les scripts de donnees ponctuels (CES/hauteur/reculs Vitry &
-- Fontenay), dans l'ordre de dependance correct.
--
-- CE SCRIPT NE FAIT QUE DU SCHEMA + DES FONCTIONS + DE LA DONNEE PLU --
-- IL NE PEUT PAS APPELER D'API HTTP. Un appel manuel (curl/Postman) vers
-- /api/foncier/enrich-zone-urba est necessaire ENTRE la PARTIE C et la
-- PARTIE D ci-dessous -- cherchez le marqueur
--   >>> ARRET OBLIGATOIRE <<<
-- et suivez les instructions avant de continuer.
--
-- Ce fichier est 100% IDEMPOTENT (CREATE OR REPLACE / IF NOT EXISTS /
-- ON CONFLICT partout) -- vous pouvez le rejouer entierement sans risque
-- si une execution precedente a echoue en cours de route.
-- ================================================================


-- ################################################################
-- PARTIE A -- SCHEMA + FONCTIONS (migrations 66 a 77)
-- ################################################################

-- ============================================================
-- Migration 66 : tables PLU reel + DPE passoire (schema additif)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.plu_zone_rules_reel (
  id BIGSERIAL PRIMARY KEY,
  insee_code TEXT NOT NULL,
  zone_libelle TEXT NOT NULL,
  zone_family TEXT,
  vocation TEXT,
  ces NUMERIC,
  hauteur_max_m NUMERIC,
  bande_constructible_m NUMERIC,
  recul_voie_m NUMERIC,
  destinations_autorisees TEXT[],
  destinations_interdites TEXT[],
  source_extrait TEXT,
  source_document TEXT,
  methode_extraction TEXT NOT NULL DEFAULT 'llm_groq'
    CHECK (methode_extraction IN ('llm_groq', 'regex_pluid', 'saisie_manuelle', 'api_gpu')),
  a_verifier BOOLEAN NOT NULL DEFAULT true,
  confidence NUMERIC,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plu_zone_rules_reel_insee_zone
  ON public.plu_zone_rules_reel (insee_code, zone_libelle);
CREATE INDEX IF NOT EXISTS idx_plu_zone_rules_reel_insee
  ON public.plu_zone_rules_reel (insee_code);

CREATE TABLE IF NOT EXISTS public.plu_zone_urba_geom (
  id BIGSERIAL PRIMARY KEY,
  insee_code TEXT NOT NULL,
  zone_libelle TEXT NOT NULL,
  gpu_partition TEXT,
  geom geometry(MultiPolygon, 2154) NOT NULL,
  source_millesime DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plu_zone_urba_geom_geom
  ON public.plu_zone_urba_geom USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_plu_zone_urba_geom_insee
  ON public.plu_zone_urba_geom (insee_code);

CREATE TABLE IF NOT EXISTS public.dpe_batiment_groupes (
  building_key TEXT NOT NULL,
  insee_code TEXT NOT NULL,
  lon DOUBLE PRECISION,
  lat DOUBLE PRECISION,
  dpe_total_count INTEGER NOT NULL DEFAULT 0,
  dpe_fg_count INTEGER NOT NULL DEFAULT 0,
  dpe_fg_ratio NUMERIC,
  copropriete_probable BOOLEAN NOT NULL DEFAULT false,
  nb_logements_estime INTEGER,
  dpe_passoire BOOLEAN NOT NULL DEFAULT false,
  dpe_passoire_copro BOOLEAN NOT NULL DEFAULT false,
  dpe_passoire_maison BOOLEAN NOT NULL DEFAULT false,
  matching_method TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (insee_code, building_key)
);

CREATE INDEX IF NOT EXISTS idx_dpe_batiment_groupes_insee ON public.dpe_batiment_groupes (insee_code);
CREATE INDEX IF NOT EXISTS idx_dpe_batiment_groupes_passoire
  ON public.dpe_batiment_groupes (dpe_passoire) WHERE dpe_passoire = true;

CREATE TABLE IF NOT EXISTS public.parcel_dpe_stats (
  parcel_id TEXT PRIMARY KEY REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
  dpe_passoire_any BOOLEAN NOT NULL DEFAULT false,
  dpe_passoire_copro BOOLEAN NOT NULL DEFAULT false,
  dpe_passoire_maison BOOLEAN NOT NULL DEFAULT false,
  nb_groupes_passoire INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.parcel_constructibility
  ADD COLUMN IF NOT EXISTS ces_source TEXT NOT NULL DEFAULT 'generique'
    CHECK (ces_source IN ('reel', 'generique'));

ALTER TABLE public.plu_zone_rules_reel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plu_zone_urba_geom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dpe_batiment_groupes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_dpe_stats ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY IF NOT EXISTS n'existe pas en PostgreSQL -- DROP POLICY IF
-- EXISTS + CREATE POLICY pour rendre ce script rejouable.
DROP POLICY IF EXISTS "plu_zone_rules_reel_public_read" ON public.plu_zone_rules_reel;
CREATE POLICY "plu_zone_rules_reel_public_read" ON public.plu_zone_rules_reel FOR SELECT USING (true);
DROP POLICY IF EXISTS "plu_zone_urba_geom_public_read" ON public.plu_zone_urba_geom;
CREATE POLICY "plu_zone_urba_geom_public_read" ON public.plu_zone_urba_geom FOR SELECT USING (true);
DROP POLICY IF EXISTS "dpe_batiment_groupes_public_read" ON public.dpe_batiment_groupes;
CREATE POLICY "dpe_batiment_groupes_public_read" ON public.dpe_batiment_groupes FOR SELECT USING (true);
DROP POLICY IF EXISTS "parcel_dpe_stats_public_read" ON public.parcel_dpe_stats;
CREATE POLICY "parcel_dpe_stats_public_read" ON public.parcel_dpe_stats FOR SELECT USING (true);


-- ============================================================
-- Migration 67 : score_commune_parcels utilise le VRAI PLU quand connu
-- CREATE OR REPLACE, meme signature -> aucun appelant a modifier.
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
  v_h NUMERIC := 12;
  v_fp NUMERIC := 0.40;
  v_gr NUMERIC := 0.20;
  v_sb NUMERIC := 0.85;
  v_pk NUMERIC := 0.90;
  v_sr NUMERIC := 0.75;
  v_cc NUMERIC := 1300;
  v_vrd NUMERIC := 100;
  v_sf NUMERIC := 0.03;
  v_mg NUMERIC := 0.08;
BEGIN
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
    ORDER BY ST_Area(z.geom) ASC
    LIMIT 1
  ) zg ON true
  LEFT JOIN public.plu_zone_rules_reel r
    ON r.insee_code = p.insee_code AND r.zone_libelle = zg.zone_libelle
  WHERE p.insee_code = p_insee;

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
      LEAST(
        p.area_m2 * base.v_fp_eff,
        p.area_m2 * (1 - v_gr) * v_sb,
        CASE WHEN tz.bande_constructible_m IS NOT NULL
          THEN SQRT(p.area_m2) * tz.bande_constructible_m
          ELSE p.area_m2 * base.v_fp_eff
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

  SELECT count(*) INTO scored_count
  FROM public.parcel_scores
  WHERE parcel_id LIKE p_insee || '%';

  NOTIFY pgrst, 'reload schema';

  RETURN scored_count;
END;
$$;


-- ============================================================
-- Fonction ingest_buildings_batch mise a jour (ajout height_m/height_source)
-- -- CREATE OR REPLACE de la fonction de base (sql/pipeline-functions.sql),
-- retro-compatible avec l'ancien JSON (cles absentes -> NULL).
-- ============================================================

CREATE OR REPLACE FUNCTION public.ingest_buildings_batch(buildings_json TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT
      j->>'building_id' AS building_id,
      j->>'source' AS source,
      (j->>'levels_est')::integer AS levels_est,
      (j->>'footprint_m2')::numeric AS footprint_m2,
      j->>'insee_code' AS insee_code,
      j->>'geojson' AS geojson,
      (j->>'height_m')::numeric AS height_m,
      j->>'height_source' AS height_source
    FROM jsonb_array_elements(buildings_json::jsonb) AS j
  LOOP
    INSERT INTO public.buildings (building_id, source, levels_est, footprint_m2, insee_code, geom, height_m, height_source)
    VALUES (
      rec.building_id,
      rec.source,
      rec.levels_est,
      rec.footprint_m2,
      rec.insee_code,
      ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(rec.geojson), 4326), 2154)),
      rec.height_m,
      rec.height_source
    )
    ON CONFLICT (building_id) DO UPDATE SET
      source = EXCLUDED.source,
      levels_est = EXCLUDED.levels_est,
      footprint_m2 = EXCLUDED.footprint_m2,
      insee_code = EXCLUDED.insee_code,
      geom = EXCLUDED.geom,
      height_m = EXCLUDED.height_m,
      height_source = EXCLUDED.height_source;
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;


-- ============================================================
-- Migration 70 : vue v_parcel_sous_densite (empilee sur v_parcel_foncier)
-- ============================================================

CREATE OR REPLACE VIEW public.v_parcel_sous_densite AS
SELECT
  v.*,
  pc.ces_source,
  COALESCE(pds.dpe_passoire_any, false) AS dpe_passoire_any,
  COALESCE(pds.dpe_passoire_copro, false) AS dpe_passoire_copro,
  COALESCE(pds.dpe_passoire_maison, false) AS dpe_passoire_maison,
  COALESCE(pds.nb_groupes_passoire, 0) AS nb_groupes_passoire,
  r.destinations_autorisees,
  r.destinations_interdites,
  r.bande_constructible_m,
  r.a_verifier AS plu_reel_a_verifier
FROM public.v_parcel_foncier v
LEFT JOIN public.parcel_constructibility pc ON pc.parcel_id = v.parcel_id
LEFT JOIN public.parcel_dpe_stats pds ON pds.parcel_id = v.parcel_id
LEFT JOIN public.plu_zone_rules_reel r
  ON r.insee_code = v.insee_code AND r.zone_libelle = v.plu_zone_code;


-- ============================================================
-- Migration 71 : hauteur reelle + classification des cotes + reculs PLU
-- ============================================================

ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS height_m NUMERIC,
  ADD COLUMN IF NOT EXISTS height_source TEXT
    CHECK (height_source IN ('bdtopo_lidar', 'estimation_niveaux') OR height_source IS NULL);

ALTER TABLE public.parcel_building_stats
  ADD COLUMN IF NOT EXISTS height_existing_m NUMERIC,
  ADD COLUMN IF NOT EXISTS height_existing_source TEXT;

CREATE OR REPLACE FUNCTION public.refresh_building_height_stats(p_insee TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE public.parcel_building_stats bs
  SET height_existing_m = h.height_max_m,
      height_existing_source = 'bdtopo_lidar',
      updated_at = now()
  FROM (
    SELECT p.parcel_id, MAX(b.height_m) AS height_max_m
    FROM public.parcels p
    JOIN public.buildings b ON ST_Intersects(p.geom, b.geom)
    WHERE p.insee_code = p_insee AND b.height_m IS NOT NULL
    GROUP BY p.parcel_id
  ) h
  WHERE bs.parcel_id = h.parcel_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

CREATE TABLE IF NOT EXISTS public.parcel_edge_classification (
  parcel_id TEXT NOT NULL REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
  edge_index INTEGER NOT NULL,
  edge_geom geometry(LineString, 2154) NOT NULL,
  edge_type TEXT NOT NULL CHECK (edge_type IN ('facade', 'lateral', 'fond')),
  length_m NUMERIC NOT NULL,
  existing_setback_m NUMERIC,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (parcel_id, edge_index)
);

CREATE INDEX IF NOT EXISTS idx_parcel_edge_classification_parcel
  ON public.parcel_edge_classification (parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_edge_classification_type
  ON public.parcel_edge_classification (edge_type);

CREATE OR REPLACE FUNCTION public.classify_commune_parcel_edges(p_insee TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  DELETE FROM public.parcel_edge_classification pec
  USING public.parcels p
  WHERE pec.parcel_id = p.parcel_id AND p.insee_code = p_insee;

  WITH largest_ring AS (
    SELECT DISTINCT ON (p.parcel_id)
      p.parcel_id,
      ST_ExteriorRing(dp.geom) AS ring
    FROM public.parcels p
    CROSS JOIN LATERAL ST_Dump(p.geom) AS dp
    WHERE p.insee_code = p_insee
    ORDER BY p.parcel_id, ST_Area(dp.geom) DESC
  ),
  pts AS (
    SELECT
      lr.parcel_id,
      (dpt).path[1] AS pt_order,
      (dpt).geom AS pt_geom
    FROM largest_ring lr
    CROSS JOIN LATERAL ST_DumpPoints(lr.ring) AS dpt
  ),
  segments AS (
    SELECT
      parcel_id,
      pt_order AS edge_index,
      ST_MakeLine(pt_geom, LEAD(pt_geom) OVER (PARTITION BY parcel_id ORDER BY pt_order)) AS edge_geom
    FROM pts
  ),
  segments_valid AS (
    SELECT * FROM segments WHERE edge_geom IS NOT NULL AND ST_Length(edge_geom) > 0
  ),
  with_adjacency AS (
    SELECT
      s.parcel_id,
      s.edge_index,
      s.edge_geom,
      ST_Length(s.edge_geom) AS length_m,
      EXISTS (
        SELECT 1
        FROM public.parcels nb
        WHERE nb.insee_code = p_insee
          AND nb.parcel_id <> s.parcel_id
          AND ST_DWithin(nb.geom, s.edge_geom, 0.5)
      ) AS has_neighbor
    FROM segments_valid s
  ),
  facade_edges AS (
    SELECT parcel_id, edge_index, edge_geom
    FROM with_adjacency
    WHERE NOT has_neighbor
  ),
  non_facade_with_dist AS (
    SELECT
      w.parcel_id,
      w.edge_index,
      w.edge_geom,
      w.length_m,
      (
        SELECT MIN(ST_Distance(w.edge_geom, f.edge_geom))
        FROM facade_edges f
        WHERE f.parcel_id = w.parcel_id
      ) AS dist_to_facade
    FROM with_adjacency w
    WHERE w.has_neighbor
  ),
  fond_flagged AS (
    SELECT
      parcel_id,
      edge_index,
      (dist_to_facade IS NOT NULL
        AND dist_to_facade = MAX(dist_to_facade) OVER (PARTITION BY parcel_id)
      ) AS is_fond
    FROM non_facade_with_dist
  ),
  classified AS (
    SELECT w.parcel_id, w.edge_index, w.edge_geom, w.length_m,
      CASE
        WHEN NOT w.has_neighbor THEN 'facade'
        WHEN ff.is_fond THEN 'fond'
        ELSE 'lateral'
      END AS edge_type
    FROM with_adjacency w
    LEFT JOIN fond_flagged ff
      ON ff.parcel_id = w.parcel_id AND ff.edge_index = w.edge_index
  )
  INSERT INTO public.parcel_edge_classification
    (parcel_id, edge_index, edge_geom, edge_type, length_m, existing_setback_m)
  SELECT
    c.parcel_id,
    c.edge_index,
    c.edge_geom,
    c.edge_type,
    c.length_m,
    (
      SELECT MIN(ST_Distance(c.edge_geom, b.geom))
      FROM public.buildings b
      JOIN public.parcels p ON p.parcel_id = c.parcel_id
      WHERE ST_Intersects(b.geom, p.geom)
    ) AS existing_setback_m
  FROM classified c;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

CREATE TABLE IF NOT EXISTS public.plu_zone_rules_reel_prospect (
  id BIGSERIAL PRIMARY KEY,
  insee_code TEXT NOT NULL,
  zone_libelle TEXT NOT NULL,
  indice_reglementaire TEXT,
  setback_side_min_m NUMERIC,
  setback_side_max_m NUMERIC,
  setback_rear_min_m NUMERIC,
  setback_rear_max_m NUMERIC,
  is_range BOOLEAN NOT NULL DEFAULT true,
  source_extrait TEXT,
  methode_extraction TEXT NOT NULL DEFAULT 'regex_pluid'
    CHECK (methode_extraction IN ('llm_groq', 'regex_pluid', 'saisie_manuelle')),
  a_verifier BOOLEAN NOT NULL DEFAULT true,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plu_zone_rules_reel_prospect_insee_zone
  ON public.plu_zone_rules_reel_prospect (insee_code, zone_libelle);

ALTER TABLE public.parcel_edge_classification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plu_zone_rules_reel_prospect ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parcel_edge_classification_public_read" ON public.parcel_edge_classification;
CREATE POLICY "parcel_edge_classification_public_read"
  ON public.parcel_edge_classification FOR SELECT USING (true);
DROP POLICY IF EXISTS "plu_zone_rules_reel_prospect_public_read" ON public.plu_zone_rules_reel_prospect;
CREATE POLICY "plu_zone_rules_reel_prospect_public_read"
  ON public.plu_zone_rules_reel_prospect FOR SELECT USING (true);


-- ============================================================
-- Migration 72 : vue v_parcel_prefaisabilite
-- ============================================================

CREATE OR REPLACE VIEW public.v_parcel_prefaisabilite AS
SELECT
  v.*,
  bs.height_existing_m,
  bs.height_existing_source,
  edges.setback_facade_existing_m,
  edges.setback_lateral_existing_m,
  edges.setback_fond_existing_m,
  edges.nb_facades,
  prospect.setback_side_min_m_worst_case,
  prospect.setback_side_min_m_range_low,
  prospect.setback_side_max_m_range_high,
  prospect.setback_rear_min_m_worst_case,
  prospect.setback_rear_min_m_range_low,
  prospect.setback_rear_max_m_range_high,
  COALESCE(prospect.setback_plu_is_range, true) AS setback_plu_is_range,
  (bs.height_existing_m IS NOT NULL AND v.max_height_est IS NOT NULL
     AND bs.height_existing_m < v.max_height_est) AS surelevation_possible_hauteur,
  (v.coverage_ratio IS NOT NULL AND v.ces_applied IS NOT NULL
     AND v.coverage_ratio < v.ces_applied) AS extension_possible_ces
FROM public.v_parcel_sous_densite v
LEFT JOIN public.parcel_building_stats bs ON bs.parcel_id = v.parcel_id
LEFT JOIN LATERAL (
  SELECT
    MIN(pec.existing_setback_m) FILTER (WHERE pec.edge_type = 'facade') AS setback_facade_existing_m,
    MIN(pec.existing_setback_m) FILTER (WHERE pec.edge_type = 'lateral') AS setback_lateral_existing_m,
    MIN(pec.existing_setback_m) FILTER (WHERE pec.edge_type = 'fond') AS setback_fond_existing_m,
    COUNT(*) FILTER (WHERE pec.edge_type = 'facade') AS nb_facades
  FROM public.parcel_edge_classification pec
  WHERE pec.parcel_id = v.parcel_id
) edges ON true
LEFT JOIN LATERAL (
  SELECT
    MAX(r.setback_side_min_m) AS setback_side_min_m_worst_case,
    MIN(r.setback_side_min_m) AS setback_side_min_m_range_low,
    MAX(r.setback_side_max_m) AS setback_side_max_m_range_high,
    MAX(r.setback_rear_min_m) AS setback_rear_min_m_worst_case,
    MIN(r.setback_rear_min_m) AS setback_rear_min_m_range_low,
    MAX(r.setback_rear_max_m) AS setback_rear_max_m_range_high,
    bool_or(r.is_range) AS setback_plu_is_range
  FROM public.plu_zone_rules_reel_prospect r
  WHERE r.insee_code = v.insee_code AND r.zone_libelle = v.plu_zone_code
) prospect ON true;


-- ============================================================
-- Migration 73 : dim_scenario_types + parcel_scenarios
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dim_scenario_types (
  scenario_type TEXT PRIMARY KEY CHECK (scenario_type IN (
    'demolition_reconstruction',
    'surelevation',
    'construction_neuve_meme_parcelle',
    'changement_usage',
    'strategie_mixte'
  )),
  label_fr TEXT NOT NULL,
  description TEXT,
  requiert_demolition BOOLEAN NOT NULL DEFAULT false,
  requiert_permis_construire BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO public.dim_scenario_types (scenario_type, label_fr, description, requiert_demolition) VALUES
  ('demolition_reconstruction', 'Demolition-reconstruction', 'Demolir l''existant, reconstruire au maximum autorise par le PLU', true),
  ('surelevation', 'Surelevation', 'Ajouter des niveaux sur le batiment existant, conserver le rez-de-chaussee et les etages actuels', false),
  ('construction_neuve_meme_parcelle', 'Construction d''un 2e batiment', 'Construire sur la partie non batie de la parcelle, conserver l''existant', false),
  ('changement_usage', 'Changement d''usage', 'Reconvertir l''existant (ex: bureau vers logement) sans construire', false),
  ('strategie_mixte', 'Strategie mixte', 'Conserver la location existante et ajouter une operation de promotion (surelevation ou construction neuve) sur la meme parcelle', false)
ON CONFLICT (scenario_type) DO NOTHING;

ALTER TABLE public.dim_scenario_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dim_scenario_types_public_read" ON public.dim_scenario_types;
CREATE POLICY "dim_scenario_types_public_read" ON public.dim_scenario_types FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.parcel_scenarios (
  id BIGSERIAL PRIMARY KEY,
  parcel_id TEXT NOT NULL REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
  scenario_type TEXT NOT NULL REFERENCES public.dim_scenario_types(scenario_type),
  cabinet_slug TEXT,
  created_by_session TEXT,
  profil TEXT NOT NULL DEFAULT 'promoteur' CHECK (profil IN ('promoteur', 'investisseur', 'mixte')),
  gating_ok BOOLEAN NOT NULL,
  gating_reasons JSONB,
  hypotheses_json JSONB NOT NULL,
  resultat_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcel_scenarios_parcel ON public.parcel_scenarios (parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_scenarios_cabinet ON public.parcel_scenarios (cabinet_slug) WHERE cabinet_slug IS NOT NULL;

ALTER TABLE public.parcel_scenarios ENABLE ROW LEVEL SECURITY;


-- ============================================================
-- Migration 74 : check_scenario_gating(parcel_id, scenario_type)
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_scenario_gating(
  p_parcel_id TEXT,
  p_scenario_type TEXT
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v RECORD;
  ok BOOLEAN := true;
  reasons JSONB := '{}'::jsonb;
BEGIN
  SELECT * INTO v FROM public.v_parcel_prefaisabilite WHERE parcel_id = p_parcel_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('gating_ok', false, 'reasons', jsonb_build_object('erreur', 'parcelle_non_scoree'));
  END IF;

  CASE p_scenario_type
    WHEN 'surelevation' THEN
      ok := COALESCE(v.surelevation_possible_hauteur, false);
      reasons := jsonb_build_object(
        'hauteur_existante_m', v.height_existing_m,
        'hauteur_existante_source', v.height_existing_source,
        'hauteur_max_plu_m', v.max_height_est,
        'note', CASE WHEN v.height_existing_m IS NULL
          THEN 'hauteur existante inconnue (re-pipeline BD TOPO requis)'
          ELSE NULL END
      );

    WHEN 'construction_neuve_meme_parcelle' THEN
      ok := COALESCE(v.extension_possible_ces, false);
      reasons := jsonb_build_object(
        'ces_existant', v.coverage_ratio,
        'ces_max_plu', v.ces_applied,
        'ces_source', v.ces_source
      );

    WHEN 'demolition_reconstruction' THEN
      ok := true;
      reasons := jsonb_build_object(
        'note', 'faisabilite reglementaire quasi-systematique ; verdict reel porte par le bilan financier'
      );

    WHEN 'changement_usage' THEN
      ok := (v.destinations_autorisees IS NOT NULL AND array_length(v.destinations_autorisees, 1) > 0);
      reasons := jsonb_build_object('destinations_autorisees', v.destinations_autorisees);

    WHEN 'strategie_mixte' THEN
      ok := COALESCE(v.surelevation_possible_hauteur, false) OR COALESCE(v.extension_possible_ces, false);
      reasons := jsonb_build_object(
        'via_surelevation', v.surelevation_possible_hauteur,
        'via_extension', v.extension_possible_ces
      );

    ELSE
      ok := false;
      reasons := jsonb_build_object('erreur', 'scenario_type_inconnu', 'valeur_recue', p_scenario_type);
  END CASE;

  RETURN jsonb_build_object('gating_ok', ok, 'reasons', reasons);
END;
$$;


-- ============================================================
-- Migration 75 : dim_bilan_promoteur_hypotheses
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dim_bilan_promoteur_hypotheses (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ratio_shab_sdp NUMERIC NOT NULL DEFAULT 0.80,
  cout_construction_eur_m2_defaut NUMERIC NOT NULL DEFAULT 2000,
  cout_vrd_eur_m2_terrain NUMERIC NOT NULL DEFAULT 100,
  cout_demolition_eur_m2_emprise NUMERIC NOT NULL DEFAULT 150,
  cout_depollution_eur_m2_defaut NUMERIC,
  taux_commercialisation_pct NUMERIC NOT NULL DEFAULT 3,
  taux_frais_financiers_taxe_pct NUMERIC NOT NULL DEFAULT 6,
  taux_marge_promoteur_bloc_pct NUMERIC NOT NULL DEFAULT 8,
  taux_marge_promoteur_decoupe_pct NUMERIC NOT NULL DEFAULT 12,
  coefficient_rendement_net_investisseur NUMERIC NOT NULL DEFAULT 0.68,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.dim_bilan_promoteur_hypotheses (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.dim_bilan_promoteur_hypotheses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dim_bilan_promoteur_hypotheses_public_read" ON public.dim_bilan_promoteur_hypotheses;
CREATE POLICY "dim_bilan_promoteur_hypotheses_public_read"
  ON public.dim_bilan_promoteur_hypotheses FOR SELECT USING (true);


-- ============================================================
-- Migration 76 : compute_buildable_envelope + wrapper GeoJSON
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_buildable_envelope(p_parcel_id TEXT)
RETURNS geometry
LANGUAGE plpgsql
AS $$
DECLARE
  v_parcel RECORD;
  v_envelope geometry;
  v_edge RECORD;
  v_setback NUMERIC;
  v_target_area NUMERIC;
  v_current_area NUMERIC;
  v_low NUMERIC;
  v_high NUMERIC;
  v_mid NUMERIC;
  i INTEGER;
BEGIN
  SELECT p.geom, p.area_m2, p.insee_code, pc.plu_zone_code, pc.ces_applied
  INTO v_parcel
  FROM public.parcels p
  LEFT JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
  WHERE p.parcel_id = p_parcel_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_envelope := v_parcel.geom;

  FOR v_edge IN
    SELECT pec.edge_geom, pec.edge_type
    FROM public.parcel_edge_classification pec
    WHERE pec.parcel_id = p_parcel_id
  LOOP
    v_setback := NULL;

    IF v_edge.edge_type = 'facade' THEN
      SELECT r.recul_voie_m INTO v_setback
      FROM public.plu_zone_rules_reel r
      WHERE r.insee_code = v_parcel.insee_code AND r.zone_libelle = v_parcel.plu_zone_code;
    ELSIF v_edge.edge_type = 'lateral' THEN
      SELECT MAX(p2.setback_side_min_m) INTO v_setback
      FROM public.plu_zone_rules_reel_prospect p2
      WHERE p2.insee_code = v_parcel.insee_code AND p2.zone_libelle = v_parcel.plu_zone_code;
    ELSIF v_edge.edge_type = 'fond' THEN
      SELECT MAX(p2.setback_rear_min_m) INTO v_setback
      FROM public.plu_zone_rules_reel_prospect p2
      WHERE p2.insee_code = v_parcel.insee_code AND p2.zone_libelle = v_parcel.plu_zone_code;
    END IF;

    IF v_setback IS NOT NULL AND v_setback > 0 THEN
      v_envelope := ST_Difference(
        v_envelope,
        ST_Buffer(v_edge.edge_geom, v_setback, 'endcap=flat join=mitre')
      );
    END IF;
  END LOOP;

  v_current_area := ST_Area(v_envelope);

  IF v_parcel.ces_applied IS NOT NULL AND v_parcel.area_m2 IS NOT NULL AND v_current_area > 0 THEN
    v_target_area := v_parcel.area_m2 * v_parcel.ces_applied;
    IF v_current_area > v_target_area AND v_target_area > 0 THEN
      v_low := 0;
      v_high := SQRT(v_current_area);
      FOR i IN 1..30 LOOP
        v_mid := (v_low + v_high) / 2;
        IF ST_Area(ST_Buffer(v_envelope, -v_mid)) > v_target_area THEN
          v_low := v_mid;
        ELSE
          v_high := v_mid;
        END IF;
      END LOOP;
      v_envelope := ST_Buffer(v_envelope, -v_high);
    END IF;
  END IF;

  RETURN ST_MakeValid(v_envelope);
END;
$$;

CREATE OR REPLACE FUNCTION public.compute_buildable_envelope_geojson(p_parcel_id TEXT)
RETURNS TABLE (geojson JSONB, area_m2 NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ST_AsGeoJSON(env)::jsonb AS geojson,
    ST_Area(env) AS area_m2
  FROM (SELECT public.compute_buildable_envelope(p_parcel_id) AS env) e
  WHERE env IS NOT NULL;
$$;


-- ============================================================
-- Migration 77 : ingest_zone_urba_batch (destinations reelles CNIG)
-- ============================================================

CREATE OR REPLACE FUNCTION public.ingest_zone_urba_batch(zones_json TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT
      j->>'insee_code' AS insee_code,
      j->>'zone_libelle' AS zone_libelle,
      j->>'zone_family' AS zone_family,
      j->>'gpu_partition' AS gpu_partition,
      j->>'geojson' AS geojson,
      ARRAY(SELECT jsonb_array_elements_text(j->'destinations_autorisees')) AS destinations_autorisees,
      ARRAY(SELECT jsonb_array_elements_text(j->'destinations_interdites')) AS destinations_interdites
    FROM jsonb_array_elements(zones_json::jsonb) AS j
  LOOP
    INSERT INTO public.plu_zone_urba_geom (insee_code, zone_libelle, gpu_partition, geom, source_millesime)
    VALUES (
      rec.insee_code,
      rec.zone_libelle,
      rec.gpu_partition,
      ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(rec.geojson), 4326), 2154)),
      CURRENT_DATE
    );

    INSERT INTO public.plu_zone_rules_reel
      (insee_code, zone_libelle, zone_family, destinations_autorisees, destinations_interdites,
       methode_extraction, source_document, a_verifier)
    VALUES
      (rec.insee_code, rec.zone_libelle, rec.zone_family,
       rec.destinations_autorisees, rec.destinations_interdites,
       'api_gpu', rec.gpu_partition, true)
    ON CONFLICT (insee_code, zone_libelle) DO UPDATE SET
      destinations_autorisees = EXCLUDED.destinations_autorisees,
      destinations_interdites = EXCLUDED.destinations_interdites,
      zone_family = COALESCE(public.plu_zone_rules_reel.zone_family, EXCLUDED.zone_family),
      updated_at = now();

    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;


-- ################################################################
-- PARTIE B -- DONNEES : CES/hauteur Phase 1 + reculs reels Vitry/Fontenay
-- ################################################################

-- ---- Import Phase 1 : CES/hauteur (Vitry 94081 + Fontenay 94033) ----
INSERT INTO public.plu_zone_rules_reel
  (insee_code, zone_libelle, zone_family, ces, hauteur_max_m, recul_voie_m,
   source_extrait, source_document, methode_extraction, a_verifier)
VALUES
  ('94081', 'UHXXXXXX', 'U', 0.40, 10.0, NULL,
   'UH indice A : emprise 40%',
   'PLUi Grand-Orly Seine Bievre (DU_200058014)', 'regex_pluid', true),
  ('94033', 'UBb', 'U', NULL, 12.0, NULL,
   'UB.10 UBb : 12 m au faitage (CES non reglemente dans ce PLUi)',
   'PLUi Paris Est Marne & Bois (DU_200057941)', 'llm_groq', true)
ON CONFLICT (insee_code, zone_libelle) DO UPDATE SET
  ces = EXCLUDED.ces,
  hauteur_max_m = EXCLUDED.hauteur_max_m,
  recul_voie_m = EXCLUDED.recul_voie_m,
  source_extrait = EXCLUDED.source_extrait,
  source_document = EXCLUDED.source_document,
  methode_extraction = EXCLUDED.methode_extraction,
  updated_at = now();

-- Geometrie de repli V1 (sera supprimee en Partie C au profit des vraies
-- zones GPU -- laissee ici pour que le scoring reste fonctionnel entre
-- cette Partie B et l'ingestion reelle de la Partie D) :
-- ST_MakeValid avant ST_Union : les geometries cadastrales Etalab contiennent
-- parfois des auto-intersections mineures -- ST_Union brut plante alors avec
-- une TopologyException GEOS ("side location conflict"). ST_CollectionExtract
-- (..., 3) + ST_Multi apres coup garantit un MultiPolygon propre (ST_MakeValid
-- peut renvoyer une GeometryCollection dans de rares cas degeneres).
INSERT INTO public.plu_zone_urba_geom (insee_code, zone_libelle, gpu_partition, geom, source_millesime)
SELECT '94081', 'UHXXXXXX', 'DU_200058014',
       ST_Multi(ST_CollectionExtract(ST_Union(ST_MakeValid(p.geom)), 3)), CURRENT_DATE
FROM public.parcels p WHERE p.insee_code = '94081'
HAVING ST_Union(ST_MakeValid(p.geom)) IS NOT NULL;

INSERT INTO public.plu_zone_urba_geom (insee_code, zone_libelle, gpu_partition, geom, source_millesime)
SELECT '94033', 'UBb', 'DU_200057941',
       ST_Multi(ST_CollectionExtract(ST_Union(ST_MakeValid(p.geom)), 3)), CURRENT_DATE
FROM public.parcels p WHERE p.insee_code = '94033'
HAVING ST_Union(ST_MakeValid(p.geom)) IS NOT NULL;

-- ---- Reculs reels Vitry (indice A, zone UHXXXXXX) ----
UPDATE public.plu_zone_rules_reel
SET recul_voie_m = 5.0,
    source_extrait = 'UH indice A (bande) : retrait de 5 metres minimum de l''alignement',
    updated_at = now()
WHERE insee_code = '94081' AND zone_libelle = 'UHXXXXXX';

DELETE FROM public.plu_zone_rules_reel_prospect
WHERE insee_code = '94081' AND zone_libelle = 'UHXXXXXX' AND indice_reglementaire = 'A';

INSERT INTO public.plu_zone_rules_reel_prospect
  (insee_code, zone_libelle, indice_reglementaire,
   setback_side_min_m, setback_side_max_m,
   setback_rear_min_m, setback_rear_max_m,
   is_range, source_extrait, methode_extraction, a_verifier)
VALUES
  ('94081', 'UHXXXXXX', 'A',
   3.0, 6.0,
   3.0, 6.0,
   true,
   'UH indice A (limites separatives) : 3m minimum sans vue / 6m minimum avec vue -- meme critere applique lateral et fond',
   'regex_pluid', true);

-- ---- Reculs reels Fontenay (regle communale UB.6/UB.7, zone UBb) ----
UPDATE public.plu_zone_rules_reel
SET recul_voie_m = 3.0,
    source_extrait = 'UB.6 Fontenay-sous-Bois : alignement OU recul 3m min / 5m max (bande 20m) -- valeur retenue = minimum de l''option retrait',
    updated_at = now()
WHERE insee_code = '94033' AND zone_libelle = 'UBb';

DELETE FROM public.plu_zone_rules_reel_prospect
WHERE insee_code = '94033' AND zone_libelle = 'UBb' AND indice_reglementaire IS NULL;

INSERT INTO public.plu_zone_rules_reel_prospect
  (insee_code, zone_libelle, indice_reglementaire,
   setback_side_min_m, setback_side_max_m,
   setback_rear_min_m, setback_rear_max_m,
   is_range, source_extrait, methode_extraction, a_verifier)
VALUES
  ('94033', 'UBb', NULL,
   3.0, 8.0,
   3.0, 8.0,
   true,
   'UB.7 Fontenay-sous-Bois : retrait minimum 3m (facade sans baie, L=H/2) ou 8m (facade avec baie, L=H) -- planchers reglementaires, formule dependante de la hauteur non modelisee',
   'regex_pluid', true);


-- ################################################################
-- PARTIE C -- NETTOYAGE DE L'ANCIEN FALLBACK ZONE (avant ingestion reelle)
-- ################################################################
-- Supprime les 2 polygones fallback (union de toutes les parcelles de la
-- commune) inseres en Partie B -- ils vont etre remplaces par les VRAIES
-- zones de l'API GPU. Les lignes plu_zone_rules_reel (ces/hauteur/recul_voie_m
-- deja extraits) sont CONSERVEES, seule la geometrie fallback disparait.

DELETE FROM public.plu_zone_urba_geom
WHERE insee_code = '94081' AND zone_libelle = 'UHXXXXXX';

DELETE FROM public.plu_zone_urba_geom
WHERE insee_code = '94033' AND zone_libelle = 'UBb';


-- ################################################################
-- >>> ARRET OBLIGATOIRE <<<
-- ################################################################
-- Ce qui precede est 100% SQL. Ce qui suit (re-scoring) a besoin que les
-- VRAIES zones PLU soient d'abord ingerees via l'API -- ceci ne peut PAS
-- se faire en SQL pur, il faut appeler la route HTTP :
--
--   curl -X POST https://<votre-domaine>/api/foncier/enrich-zone-urba \
--     -H "x-admin-key: <SUPABASE_SERVICE_ROLE_KEY>" \
--     -H "Content-Type: application/json" \
--     -d '{"insee":"94081"}'
--
--   curl -X POST https://<votre-domaine>/api/foncier/enrich-zone-urba \
--     -H "x-admin-key: <SUPABASE_SERVICE_ROLE_KEY>" \
--     -H "Content-Type: application/json" \
--     -d '{"insee":"94033"}'
--
-- Reponse attendue : {"insee":"94081","zones_found":N,"zones_ingested":N,
-- "zones_distinctes":M} avec M > 1 (plusieurs dizaines attendues).
--
-- Optionnel mais recommande a ce stade egalement : re-pipeliner les
-- batiments BD TOPO pour peupler height_m (jamais stocke avant le fix de
-- cette session) :
--   POST /api/foncier/pipeline {"insee":"94081","step":"ingest"}
--   POST /api/foncier/pipeline {"insee":"94033","step":"ingest"}
--
-- NE CONTINUEZ CI-DESSOUS (Partie D) QU'APRES CES APPELS.
-- ################################################################


-- ################################################################
-- PARTIE D -- RE-SCORING + BACKFILL (a executer APRES les appels API ci-dessus)
-- ################################################################

-- Re-rattache chaque parcelle a sa VRAIE zone (au lieu du fallback unique)
-- et recalcule CES/hauteur/potentiel en consequence.
SELECT public.score_commune_parcels('94081', 4000);
SELECT public.score_commune_parcels('94033', 4000);

-- Classification des cotes de parcelle (facade/lateral/fond)
SELECT public.classify_commune_parcel_edges('94081');
SELECT public.classify_commune_parcel_edges('94033');

-- Hauteur reelle existante -- ne remontera des valeurs que si le
-- re-pipeline BD TOPO (step=ingest) a ete fait (cf. note >>> ARRET <<<).
SELECT public.refresh_building_height_stats('94081');
SELECT public.refresh_building_height_stats('94033');


-- ################################################################
-- VERIFICATION FINALE (a executer manuellement)
-- ################################################################

-- 1) Plusieurs zones distinctes desormais rattachees aux parcelles
--    (avant cette correction : toujours 1 seule, 'UHXXXXXX' partout) :
-- SELECT plu_zone_code, count(*) FROM public.parcel_constructibility
-- WHERE parcel_id LIKE '94081%' GROUP BY plu_zone_code ORDER BY count(*) DESC;

-- 2) Les destinations different reellement d'une zone a l'autre :
-- SELECT zone_libelle, destinations_autorisees FROM public.plu_zone_rules_reel
-- WHERE insee_code = '94081' ORDER BY zone_libelle LIMIT 20;

-- 3) Non-regression : sur une commune SANS PLU reel extrait (temoin, hors
--    94081/94033), mutability_score doit rester identique a avant toute
--    cette session.

-- 4) Cote produit : comparer
--      GET /api/cabinets/<slug>/foncier/sous-densite?insee=94081&persona=logement
--    vs  ...&persona=industrie
--    -- les listes ne doivent plus etre identiques.
