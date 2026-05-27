-- DATAMERRY — Fix types de la fonction find_nearby_poi
--
-- Bug : Postgres parse `SELECT * FROM find_nearby_poi(48.8693, 2.3299, 1500, 5);`
-- avec les littéraux numériques comme `numeric` (decimal arbitraire) au lieu
-- de `double precision`. Du coup pas de match avec la signature initiale.
--
-- Fix : on accepte `numeric` qui est plus permissif et cast en double dans
-- le corps. Compatible avec Supabase RPC qui envoie souvent du numeric.

-- Drop l'ancienne signature
DROP FUNCTION IF EXISTS public.find_nearby_poi(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER);

-- Re-crée avec numeric pour lat/lon (Postgres caste auto vers double)
CREATE OR REPLACE FUNCTION public.find_nearby_poi(
  p_lat NUMERIC,
  p_lon NUMERIC,
  p_max_distance_m INTEGER DEFAULT 2000,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  nom TEXT,
  type TEXT,
  categorie TEXT,
  wikipedia_url TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  distance_m INTEGER,
  notabilite_score INTEGER
)
LANGUAGE plpgsql
STABLE AS $$
DECLARE
  v_lat DOUBLE PRECISION := p_lat::DOUBLE PRECISION;
  v_lon DOUBLE PRECISION := p_lon::DOUBLE PRECISION;
  v_max_km NUMERIC := p_max_distance_m / 1000.0;
  v_lat_delta NUMERIC := v_max_km / 110.0;
  v_lon_delta NUMERIC := v_max_km / (111.0 * cos(radians(v_lat)));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT
      p.id, p.nom, p.type, p.categorie, p.wikipedia_url,
      p.lat, p.lon, p.notabilite_score,
      ( 6371000 * 2 * asin( sqrt(
          power(sin(radians(p.lat - v_lat) / 2), 2) +
          cos(radians(v_lat)) * cos(radians(p.lat)) *
          power(sin(radians(p.lon - v_lon) / 2), 2)
        ))
      )::INTEGER AS dist_m
    FROM public.dim_poi p
    WHERE p.active = true
      AND p.lat BETWEEN (v_lat - v_lat_delta) AND (v_lat + v_lat_delta)
      AND p.lon BETWEEN (v_lon - v_lon_delta) AND (v_lon + v_lon_delta)
  )
  SELECT
    c.id, c.nom, c.type, c.categorie, c.wikipedia_url,
    c.lat, c.lon, c.dist_m AS distance_m, c.notabilite_score
  FROM candidates c
  WHERE c.dist_m <= p_max_distance_m
  ORDER BY (c.dist_m::NUMERIC - c.notabilite_score * 5) ASC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.find_nearby_poi IS
  'Trouve les POI notables proches d''un point en combinant distance + score de notabilité (Wikipedia, Mérimée). Accepte numeric (auto-cast vers double).';

-- Test rapide (devrait NE PAS planter même si la table est vide)
SELECT count(*) AS nb_poi_total FROM public.dim_poi;
SELECT * FROM public.find_nearby_poi(48.8693, 2.3299, 2000, 5);
