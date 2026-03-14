-- Rattache chaque parcelle aux stats marché DVF.
-- Stratégie : micro-zone HDBSCAN (Appartement) par intersection spatiale,
-- fallback sur prix communal dvf_clusters_commune (type Appartement).
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
  COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median) AS median_price_m2,
  CASE
    WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median) >= 6000 THEN 10
    WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median) >= 4500 THEN 8
    WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median) >= 3000 THEN 6
    WHEN COALESCE(hz.prix_m2_median, commune_appt.prix_m2_median) >= 2000 THEN 4
    ELSE 2
  END AS market_tension_score,
  hz.zone_id AS hdbscan_zone_id,
  EXTRACT(YEAR FROM now())::int AS analysis_year,
  now() AS updated_at
FROM public.parcels p
-- 1) Micro-zone HDBSCAN : intersection spatiale centroïde parcelle × polygone zone
--    On prend les zones "Appartement" (le marché résidentiel de référence)
--    et on choisit celle avec le plus de transactions
LEFT JOIN LATERAL (
  SELECT z.id AS zone_id, z.prix_m2_median
  FROM public.dvf_hdbscan_zones z
  WHERE z.code_commune = p.insee_code
    AND z.type_local = 'Appartement'
    AND z.prix_m2_median IS NOT NULL
    AND z.hull_coords IS NOT NULL
    AND z.geom IS NOT NULL
    AND ST_Contains(z.geom, ST_Centroid(p.geom))
  ORDER BY z.count DESC
  LIMIT 1
) hz ON true
-- 2) Fallback : prix communal Appartement
LEFT JOIN LATERAL (
  SELECT prix_m2_median
  FROM public.dvf_clusters_commune
  WHERE cluster_id = p.insee_code || '_Appartement'
    AND prix_m2_median IS NOT NULL
  LIMIT 1
) commune_appt ON true
WHERE (%(insee_code)s IS NULL OR p.insee_code = %(insee_code)s)
ON CONFLICT (parcel_id) DO UPDATE SET
  median_price_m2 = EXCLUDED.median_price_m2,
  market_tension_score = EXCLUDED.market_tension_score,
  hdbscan_zone_id = EXCLUDED.hdbscan_zone_id,
  analysis_year = EXCLUDED.analysis_year,
  updated_at = now();
