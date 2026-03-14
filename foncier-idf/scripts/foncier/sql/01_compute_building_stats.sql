-- Calcule l'emprise bâtie par parcelle (intersection parcelles × bâtiments)
INSERT INTO public.parcel_building_stats (
  parcel_id,
  built_footprint_m2,
  building_count,
  existing_gfa_est,
  coverage_ratio,
  updated_at
)
SELECT
  p.parcel_id,
  COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom))), 0) AS built_footprint_m2,
  COUNT(DISTINCT b.building_id) FILTER (WHERE ST_Intersects(p.geom, b.geom)) AS building_count,
  COALESCE(
    SUM(ST_Area(ST_Intersection(p.geom, b.geom)) * COALESCE(b.levels_est, 1)),
    0
  ) AS existing_gfa_est,
  CASE
    WHEN p.area_m2 > 0 THEN
      COALESCE(SUM(ST_Area(ST_Intersection(p.geom, b.geom))), 0) / p.area_m2
    ELSE 0
  END AS coverage_ratio,
  now() AS updated_at
FROM public.parcels p
LEFT JOIN public.buildings b
  ON ST_Intersects(p.geom, b.geom)
WHERE (%(insee_code)s IS NULL OR p.insee_code = %(insee_code)s)
GROUP BY p.parcel_id, p.area_m2
ON CONFLICT (parcel_id) DO UPDATE SET
  built_footprint_m2 = EXCLUDED.built_footprint_m2,
  building_count = EXCLUDED.building_count,
  existing_gfa_est = EXCLUDED.existing_gfa_est,
  coverage_ratio = EXCLUDED.coverage_ratio,
  updated_at = now();
