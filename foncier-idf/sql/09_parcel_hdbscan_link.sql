-- ============================================================
-- Lien parcelles ↔ micro-zones HDBSCAN
-- Met à jour parcel_market_stats.hdbscan_zone_id et median_price_m2
-- avec la micro-zone HDBSCAN la plus pertinente (par intersection spatiale)
-- ============================================================

-- 1. Ajouter une colonne géométrie aux zones HDBSCAN si pas encore fait
ALTER TABLE dvf_hdbscan_zones
  ADD COLUMN IF NOT EXISTS geom GEOMETRY(Polygon, 4326);

-- 2. Construire la géométrie depuis hull_coords (JSONB [[lat,lon],...])
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

-- 3. Index spatial sur les zones
CREATE INDEX IF NOT EXISTS idx_hdbscan_geom
  ON dvf_hdbscan_zones USING GIST (geom);

-- 4. Mettre à jour parcel_market_stats avec la zone HDBSCAN
--    On prend la zone "Appartement" (le type le plus courant) avec le plus de transactions
UPDATE parcel_market_stats pms
SET
  hdbscan_zone_id = best.zone_id,
  median_price_m2 = COALESCE(best.zone_prix, pms.median_price_m2)
FROM (
  SELECT DISTINCT ON (p.parcel_id)
    p.parcel_id,
    z.id AS zone_id,
    z.prix_m2_median AS zone_prix
  FROM parcels p
  JOIN dvf_hdbscan_zones z
    ON z.geom IS NOT NULL
    AND z.code_commune = p.insee_code
    AND ST_Intersects(p.geom, z.geom)
  WHERE z.type_local = 'Appartement'
  ORDER BY p.parcel_id, z.count DESC
) best
WHERE pms.parcel_id = best.parcel_id;

-- 5. Rafraîchir la vue matérialisée pour propager les nouveaux prix
REFRESH MATERIALIZED VIEW CONCURRENTLY v_parcel_foncier;
