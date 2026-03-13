-- =========================================
-- DATAMERRY — Module Foncier Mutable
-- Tables, view et fonction RPC
-- =========================================

-- Activer PostGIS si pas déjà fait
CREATE EXTENSION IF NOT EXISTS postgis;

-- =========================
-- 1) PARCELS
-- =========================
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

CREATE INDEX IF NOT EXISTS idx_parcels_insee_code
  ON public.parcels (insee_code);

CREATE INDEX IF NOT EXISTS idx_parcels_geom
  ON public.parcels
  USING GIST (geom);

-- =========================
-- 2) BUILDINGS (bâti)
-- =========================
CREATE TABLE IF NOT EXISTS public.buildings (
  building_id TEXT PRIMARY KEY,
  source TEXT,
  levels_est INTEGER DEFAULT 1,
  footprint_m2 NUMERIC,
  geom geometry(MultiPolygon, 2154),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buildings_geom
  ON public.buildings
  USING GIST (geom);

-- =========================
-- 3) PARCEL_BUILDING_STATS
-- =========================
CREATE TABLE IF NOT EXISTS public.parcel_building_stats (
  parcel_id TEXT PRIMARY KEY REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
  built_footprint_m2 NUMERIC DEFAULT 0,
  building_count INTEGER DEFAULT 0,
  existing_gfa_est NUMERIC DEFAULT 0,
  coverage_ratio NUMERIC DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcel_building_stats_coverage
  ON public.parcel_building_stats (coverage_ratio);

-- =========================
-- 4) PARCEL_MARKET_STATS
-- =========================
CREATE TABLE IF NOT EXISTS public.parcel_market_stats (
  parcel_id TEXT PRIMARY KEY REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
  median_price_m2 NUMERIC,
  market_tension_score NUMERIC,
  hdbscan_zone_id TEXT,
  analysis_year INTEGER,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcel_market_stats_price
  ON public.parcel_market_stats (median_price_m2);

-- =========================
-- 5) PARCEL_CONSTRUCTIBILITY
-- =========================
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

CREATE INDEX IF NOT EXISTS idx_parcel_constructibility_zone
  ON public.parcel_constructibility (dominant_zone_family);

CREATE INDEX IF NOT EXISTS idx_parcel_constructibility_underuse
  ON public.parcel_constructibility (underuse_ratio);

-- =========================
-- 6) PARCEL_SCORES
-- =========================
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

CREATE INDEX IF NOT EXISTS idx_parcel_scores_mutability
  ON public.parcel_scores (mutability_score DESC);

CREATE INDEX IF NOT EXISTS idx_parcel_scores_best_use
  ON public.parcel_scores (best_use);

-- =========================
-- VIEW pour le front
-- =========================
CREATE OR REPLACE VIEW public.v_parcel_foncier AS
SELECT
  p.parcel_id,
  p.insee_code,
  p.section,
  p.number,
  p.area_m2,
  p.city_name,
  pcs.mutability_score,
  pcs.best_use,
  pcs.land_value_est,
  pcs.program_value_est,
  pcs.explanation_json,
  pc.dominant_zone_family,
  pc.estimated_gfa,
  pc.residual_potential_est,
  pc.underuse_ratio,
  pms.median_price_m2,
  p.geom
FROM public.parcels p
LEFT JOIN public.parcel_scores pcs ON pcs.parcel_id = p.parcel_id
LEFT JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id = p.parcel_id;

-- =========================
-- Fonction RPC bbox
-- =========================
CREATE OR REPLACE FUNCTION public.get_foncier_bbox(
  minx DOUBLE PRECISION,
  miny DOUBLE PRECISION,
  maxx DOUBLE PRECISION,
  maxy DOUBLE PRECISION,
  min_score DOUBLE PRECISION DEFAULT 0,
  limit_count INTEGER DEFAULT 500
)
RETURNS TABLE (
  parcel_id TEXT,
  insee_code TEXT,
  area_m2 NUMERIC,
  mutability_score NUMERIC,
  best_use TEXT,
  land_value_est NUMERIC,
  estimated_gfa NUMERIC,
  geojson JSONB
)
LANGUAGE sql STABLE
AS $$
  SELECT
    v.parcel_id,
    v.insee_code,
    v.area_m2,
    v.mutability_score,
    v.best_use,
    v.land_value_est,
    v.estimated_gfa,
    ST_AsGeoJSON(ST_Transform(v.geom, 4326))::jsonb AS geojson
  FROM public.v_parcel_foncier v
  WHERE v.mutability_score IS NOT NULL
    AND v.mutability_score >= min_score
    AND v.geom && ST_MakeEnvelope(minx, miny, maxx, maxy, 2154)
  ORDER BY v.mutability_score DESC
  LIMIT limit_count;
$$;

-- =========================
-- RLS policies (lecture publique)
-- =========================
ALTER TABLE public.parcels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_building_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_market_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_constructibility ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "parcels_public_read" ON public.parcels FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "parcel_building_stats_public_read" ON public.parcel_building_stats FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "parcel_market_stats_public_read" ON public.parcel_market_stats FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "parcel_constructibility_public_read" ON public.parcel_constructibility FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "parcel_scores_public_read" ON public.parcel_scores FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "buildings_public_read" ON public.buildings FOR SELECT USING (true);
