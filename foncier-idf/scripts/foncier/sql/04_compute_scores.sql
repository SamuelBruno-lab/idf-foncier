-- Calcule le score final de mutabilité par parcelle.
-- Simple : sous-exploitation + zonage + marché + taille.

INSERT INTO public.parcel_scores (
  parcel_id,
  mutability_score,
  underuse_score,
  zoning_score,
  market_score,
  size_score,
  land_value_score,
  best_use,
  land_value_est,
  program_value_est,
  zone_vocation,
  plu_zone_code,
  explanation_json,
  computed_at
)
SELECT
  p.parcel_id,

  -- Score final pondéré (4 axes, pas de bilan promoteur)
  ROUND(
    (
      0.35 * sub.underuse_score +
      0.25 * sub.zoning_score +
      0.22 * sub.market_score +
      0.18 * sub.size_score
    )
  , 2) AS mutability_score,

  sub.underuse_score,
  sub.zoning_score,
  sub.market_score,
  sub.size_score,
  0 AS land_value_score,

  -- Best use selon vocation PLU
  CASE
    WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'economique'
      THEN CASE
        WHEN p.area_m2 >= 2000 AND pc.underuse_ratio >= 0.70
          THEN 'activite_economique'
        WHEN p.area_m2 >= 500 AND pc.underuse_ratio >= 0.50
          THEN 'bureaux_commerces'
        ELSE 'analyse_complementaire'
      END
    WHEN COALESCE(pc.zone_vocation, 'residentiel') IN ('residentiel', 'mixte')
      THEN CASE
        WHEN pc.dominant_zone_family IN ('U', 'AU')
             AND p.area_m2 >= 600
             AND pc.underuse_ratio >= 0.70
          THEN 'densification_residentielle'
        WHEN pc.dominant_zone_family = 'U'
             AND p.area_m2 BETWEEN 300 AND 700
             AND pc.underuse_ratio >= 0.60
          THEN 'division_parcellaire'
        WHEN pc.dominant_zone_family = 'U'
             AND COALESCE(bs.coverage_ratio, 0) < 0.15
          THEN 'dent_creuse'
        WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'mixte'
             AND p.area_m2 >= 2000
             AND pc.underuse_ratio >= 0.60
          THEN 'mixte_logements_activite'
        ELSE 'analyse_complementaire'
      END
    ELSE 'analyse_complementaire'
  END AS best_use,

  0 AS land_value_est,
  0 AS program_value_est,
  COALESCE(pc.zone_vocation, 'residentiel') AS zone_vocation,
  pc.plu_zone_code,

  jsonb_build_object(
    -- Parcelle
    'area_m2', p.area_m2,
    'underuse_ratio', pc.underuse_ratio,
    'dominant_zone_family', pc.dominant_zone_family,
    'plu_zone_code', pc.plu_zone_code,
    'zone_vocation', COALESCE(pc.zone_vocation, 'residentiel'),
    'ces_applied', pc.ces_applied,
    'max_height_est', pc.max_height_est,
    'setback_front_m', pc.setback_front_m,
    'setback_side_m', pc.setback_side_m,
    'median_price_m2', pms.median_price_m2,
    'estimated_gfa', pc.estimated_gfa,
    'residual_potential_est', pc.residual_potential_est,
    'coverage_ratio', bs.coverage_ratio,
    'existing_gfa_est', COALESCE(bs.existing_gfa_est, 0),
    'built_footprint_m2', COALESCE(bs.built_footprint_m2, 0),
    'building_count', COALESCE(bs.building_count, 0)
  ) AS explanation_json,

  now() AS computed_at

FROM public.parcels p
JOIN public.parcel_constructibility pc
  ON pc.parcel_id = p.parcel_id
LEFT JOIN public.parcel_market_stats pms
  ON pms.parcel_id = p.parcel_id
LEFT JOIN public.parcel_building_stats bs
  ON bs.parcel_id = p.parcel_id
-- Sous-scores
CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN pc.underuse_ratio >= 0.80 THEN 10
      WHEN pc.underuse_ratio >= 0.60 THEN 8
      WHEN pc.underuse_ratio >= 0.40 THEN 6
      WHEN pc.underuse_ratio >= 0.20 THEN 4
      ELSE 1
    END AS underuse_score,
    CASE
      WHEN pc.dominant_zone_family = 'U' THEN 9
      WHEN pc.dominant_zone_family = 'AU' THEN 7
      WHEN pc.dominant_zone_family = 'A' THEN 2
      WHEN pc.dominant_zone_family = 'N' THEN 1
      ELSE 3
    END AS zoning_score,
    CASE
      WHEN pms.median_price_m2 >= 6000 THEN 10
      WHEN pms.median_price_m2 >= 4500 THEN 8
      WHEN pms.median_price_m2 >= 3000 THEN 6
      WHEN pms.median_price_m2 >= 2000 THEN 4
      ELSE 2
    END AS market_score,
    CASE
      WHEN p.area_m2 >= 1000 THEN 9
      WHEN p.area_m2 >= 600 THEN 7
      WHEN p.area_m2 >= 300 THEN 5
      ELSE 2
    END AS size_score
) sub
WHERE (%(insee_code)s IS NULL OR p.insee_code = %(insee_code)s)
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
  zone_vocation = EXCLUDED.zone_vocation,
  plu_zone_code = EXCLUDED.plu_zone_code,
  explanation_json = EXCLUDED.explanation_json,
  computed_at = now();
