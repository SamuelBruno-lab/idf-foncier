-- Rattache chaque parcelle aux stats marché DVF.
-- Stratégie : prix médian communal depuis dvf_clusters_commune.
-- (Plus tard : micro-zone HDBSCAN via intersection spatiale)
INSERT INTO public.parcel_market_stats (
  parcel_id,
  median_price_m2,
  market_tension_score,
  hdbscan_zone_id,
  analysis_year,
  updated_at
)
SELECT
  p.parcel_id,
  c.prix_m2_median,
  CASE
    WHEN c.prix_m2_median >= 6000 THEN 10
    WHEN c.prix_m2_median >= 4500 THEN 8
    WHEN c.prix_m2_median >= 3000 THEN 6
    WHEN c.prix_m2_median >= 2000 THEN 4
    ELSE 2
  END AS market_tension_score,
  NULL AS hdbscan_zone_id,
  EXTRACT(YEAR FROM now())::int AS analysis_year,
  now() AS updated_at
FROM public.parcels p
LEFT JOIN LATERAL (
  SELECT prix_m2_median
  FROM public.dvf_clusters_commune
  WHERE cluster_id LIKE p.insee_code || '_%'
  ORDER BY count DESC
  LIMIT 1
) c ON true
WHERE (%(insee_code)s IS NULL OR p.insee_code = %(insee_code)s)
ON CONFLICT (parcel_id) DO UPDATE SET
  median_price_m2 = EXCLUDED.median_price_m2,
  market_tension_score = EXCLUDED.market_tension_score,
  hdbscan_zone_id = EXCLUDED.hdbscan_zone_id,
  analysis_year = EXCLUDED.analysis_year,
  updated_at = now();
