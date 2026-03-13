-- Calcule le score final de mutabilité par parcelle.
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
  explanation_json,
  computed_at
)
SELECT
  p.parcel_id,

  -- Score final pondéré
  ROUND(
    (
      0.30 * sub.underuse_score +
      0.25 * sub.zoning_score +
      0.20 * sub.market_score +
      0.15 * sub.size_score +
      0.10 * sub.land_value_score
    )
  , 2) AS mutability_score,

  sub.underuse_score,
  sub.zoning_score,
  sub.market_score,
  sub.size_score,
  sub.land_value_score,

  -- Best use heuristique
  CASE
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
    ELSE 'analyse_complementaire'
  END AS best_use,

  calc.land_value_est_calc AS land_value_est,
  calc.program_value_est_calc AS program_value_est,

  jsonb_build_object(
    'area_m2', p.area_m2,
    'underuse_ratio', pc.underuse_ratio,
    'dominant_zone_family', pc.dominant_zone_family,
    'median_price_m2', pms.median_price_m2,
    'estimated_gfa', pc.estimated_gfa,
    'residual_potential_est', pc.residual_potential_est,
    'coverage_ratio', bs.coverage_ratio
  ) AS explanation_json,

  now() AS computed_at

FROM public.parcels p
JOIN public.parcel_constructibility pc
  ON pc.parcel_id = p.parcel_id
LEFT JOIN public.parcel_market_stats pms
  ON pms.parcel_id = p.parcel_id
LEFT JOIN public.parcel_building_stats bs
  ON bs.parcel_id = p.parcel_id
-- Bilan promoteur simplifié
CROSS JOIN LATERAL (
  SELECT
    (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
      AS program_value_est_calc,
    (
      (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
      - (pc.estimated_gfa * %(construction_cost_m2)s::numeric)
      - (pc.estimated_gfa * %(vrd_cost_m2)s::numeric)
      - ((pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0)) * %(sales_fee_ratio)s::numeric)
      - ((pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0)) * %(margin_ratio)s::numeric)
    ) AS land_value_est_calc
) calc
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
    END AS size_score,
    CASE
      WHEN calc.land_value_est_calc >= 1500000 THEN 10
      WHEN calc.land_value_est_calc >= 800000 THEN 8
      WHEN calc.land_value_est_calc >= 400000 THEN 6
      WHEN calc.land_value_est_calc >= 150000 THEN 4
      ELSE 2
    END AS land_value_score
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
  explanation_json = EXCLUDED.explanation_json,
  computed_at = now();
