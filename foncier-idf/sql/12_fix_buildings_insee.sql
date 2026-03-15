-- =========================================
-- Fix: Add insee_code to buildings table
-- Enables commune-specific delete during import
-- (prevents deleting ALL buildings when importing one commune)
-- =========================================

-- 1) Add insee_code column to buildings
ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS insee_code TEXT;

-- 2) Index for fast commune-specific queries
CREATE INDEX IF NOT EXISTS idx_buildings_insee_code
  ON public.buildings (insee_code);

-- 3) Backfill insee_code from spatial join with parcels
-- (assigns each building to the commune whose parcels it most overlaps)
UPDATE public.buildings b
SET insee_code = sub.insee_code
FROM (
  SELECT DISTINCT ON (b2.building_id)
    b2.building_id,
    p.insee_code
  FROM public.buildings b2
  JOIN public.parcels p ON ST_Intersects(b2.geom, p.geom)
  WHERE b2.insee_code IS NULL
  ORDER BY b2.building_id, ST_Area(ST_Intersection(b2.geom, p.geom)) DESC
) sub
WHERE b.building_id = sub.building_id;
