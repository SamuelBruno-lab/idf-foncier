-- Calcule la constructibilité heuristique par parcelle.
-- MVP : hypothèses zone U par défaut (hauteur 12m, emprise 40%%).
INSERT INTO public.parcel_constructibility (
  parcel_id,
  dominant_zone_family,
  max_height_est,
  max_footprint_ratio_est,
  min_green_ratio_est,
  setback_penalty_est,
  parking_penalty_est,
  buildable_footprint_est,
  floors_est,
  estimated_gfa,
  residual_potential_est,
  underuse_ratio,
  updated_at
)
SELECT
  p.parcel_id,

  'U'::text AS dominant_zone_family,

  %(default_max_height_u)s::numeric AS max_height_est,
  %(default_max_footprint_u)s::numeric AS max_footprint_ratio_est,
  %(default_green_ratio_u)s::numeric AS min_green_ratio_est,
  %(default_setback_penalty)s::numeric AS setback_penalty_est,
  %(default_parking_penalty)s::numeric AS parking_penalty_est,

  LEAST(
    p.area_m2 * %(default_max_footprint_u)s::numeric,
    p.area_m2 * (1 - %(default_green_ratio_u)s::numeric) * %(default_setback_penalty)s::numeric
  ) AS buildable_footprint_est,

  GREATEST(
    1,
    FLOOR(%(default_max_height_u)s::numeric / 3.5)
  )::int AS floors_est,

  (
    LEAST(
      p.area_m2 * %(default_max_footprint_u)s::numeric,
      p.area_m2 * (1 - %(default_green_ratio_u)s::numeric) * %(default_setback_penalty)s::numeric
    )
    * GREATEST(1, FLOOR(%(default_max_height_u)s::numeric / 3.5))
    * %(default_parking_penalty)s::numeric
  ) AS estimated_gfa,

  GREATEST(
    0,
    (
      LEAST(
        p.area_m2 * %(default_max_footprint_u)s::numeric,
        p.area_m2 * (1 - %(default_green_ratio_u)s::numeric) * %(default_setback_penalty)s::numeric
      )
      * GREATEST(1, FLOOR(%(default_max_height_u)s::numeric / 3.5))
      * %(default_parking_penalty)s::numeric
    ) - COALESCE(bs.existing_gfa_est, 0)
  ) AS residual_potential_est,

  CASE
    WHEN (
      LEAST(
        p.area_m2 * %(default_max_footprint_u)s::numeric,
        p.area_m2 * (1 - %(default_green_ratio_u)s::numeric) * %(default_setback_penalty)s::numeric
      )
      * GREATEST(1, FLOOR(%(default_max_height_u)s::numeric / 3.5))
      * %(default_parking_penalty)s::numeric
    ) > 0
    THEN GREATEST(
      0,
      1 - (
        COALESCE(bs.existing_gfa_est, 0) / (
          LEAST(
            p.area_m2 * %(default_max_footprint_u)s::numeric,
            p.area_m2 * (1 - %(default_green_ratio_u)s::numeric) * %(default_setback_penalty)s::numeric
          )
          * GREATEST(1, FLOOR(%(default_max_height_u)s::numeric / 3.5))
          * %(default_parking_penalty)s::numeric
        )
      )
    )
    ELSE 0
  END AS underuse_ratio,

  now() AS updated_at
FROM public.parcels p
LEFT JOIN public.parcel_building_stats bs
  ON bs.parcel_id = p.parcel_id
WHERE (%(insee_code)s IS NULL OR p.insee_code = %(insee_code)s)
ON CONFLICT (parcel_id) DO UPDATE SET
  dominant_zone_family = EXCLUDED.dominant_zone_family,
  max_height_est = EXCLUDED.max_height_est,
  max_footprint_ratio_est = EXCLUDED.max_footprint_ratio_est,
  min_green_ratio_est = EXCLUDED.min_green_ratio_est,
  setback_penalty_est = EXCLUDED.setback_penalty_est,
  parking_penalty_est = EXCLUDED.parking_penalty_est,
  buildable_footprint_est = EXCLUDED.buildable_footprint_est,
  floors_est = EXCLUDED.floors_est,
  estimated_gfa = EXCLUDED.estimated_gfa,
  residual_potential_est = EXCLUDED.residual_potential_est,
  underuse_ratio = EXCLUDED.underuse_ratio,
  updated_at = now();
