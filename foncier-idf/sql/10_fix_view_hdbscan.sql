-- ============================================================
-- Fix: ajouter coverage_ratio et hdbscan_zone_id à la vue
-- + recréer la géométrie HDBSCAN si absente
-- ============================================================

-- 1. S'assurer que la colonne geom existe sur dvf_hdbscan_zones
ALTER TABLE dvf_hdbscan_zones
  ADD COLUMN IF NOT EXISTS geom GEOMETRY(Polygon, 4326);

-- 2. Construire la géométrie depuis hull_coords pour les zones sans geom
UPDATE dvf_hdbscan_zones
SET geom = ST_SetSRID(
  ST_MakePolygon(
    ST_MakeLine(
      ARRAY(
        SELECT ST_MakePoint(
          (coord->1)::float,  -- lon
          (coord->0)::float   -- lat
        )
        FROM jsonb_array_elements(hull_coords) AS coord
      )
      || ARRAY[
        ST_MakePoint(
          (hull_coords->0->1)::float,
          (hull_coords->0->0)::float
        )
      ]
    )
  ),
  4326
)
WHERE hull_coords IS NOT NULL
  AND jsonb_array_length(hull_coords) >= 3
  AND geom IS NULL;

-- 3. Index spatial
CREATE INDEX IF NOT EXISTS idx_hdbscan_geom
  ON dvf_hdbscan_zones USING GIST (geom);

-- 4. Recréer la vue avec coverage_ratio, hdbscan_zone_id et bâti existant
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
  pms.hdbscan_zone_id,
  COALESCE(pbs.coverage_ratio, 0) AS coverage_ratio,
  -- Bâti existant
  COALESCE(pbs.existing_gfa_est, 0) AS existing_gfa_est,
  COALESCE(pbs.built_footprint_m2, 0) AS built_footprint_m2,
  COALESCE(pbs.building_count, 0) AS building_count,
  -- PLU (from constructibility)
  pc.plu_zone_code,
  pc.ces_applied,
  pc.max_height_est,
  pc.setback_front_m,
  pc.setback_side_m,
  -- Vocation & parking (from scores)
  pcs.zone_vocation,
  pcs.nb_logements_est,
  pcs.nb_parking_places,
  pcs.parking_cost,
  pcs.parking_surface_m2,
  pcs.taxe_amenagement,
  pcs.taxe_amenagement_taux,
  p.geom
FROM public.parcels p
LEFT JOIN public.parcel_scores pcs ON pcs.parcel_id = p.parcel_id
LEFT JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id = p.parcel_id
LEFT JOIN public.parcel_building_stats pbs ON pbs.parcel_id = p.parcel_id;
