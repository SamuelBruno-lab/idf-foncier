-- DATAMERRY — Fonction d'agrégation DVF par année pour évolution prix.
--
-- Renvoie la médiane prix m² + percentiles + nb ventes par année, sur
-- les N dernières années pour un couple (commune, type_local).
--
-- Usage côté API :
--   SELECT * FROM public.get_price_evolution('93055', 'Appartement', 8);
--
-- Affichée dans le PDF lead page 2 sous forme de bar chart sparkline :
-- année par année + variation cumulée 5/10 ans (« +18 % sur 5 ans »).
-- C'est l'élément temporel que Immo Data fait payer en abonnement Pro.

CREATE OR REPLACE FUNCTION public.get_price_evolution(
  p_code_commune TEXT,
  p_type_local TEXT,
  p_years_back INTEGER DEFAULT 8
)
RETURNS TABLE (
  annee SMALLINT,
  prix_m2_median NUMERIC,
  prix_m2_p25 NUMERIC,
  prix_m2_p75 NUMERIC,
  nb_ventes INTEGER
)
LANGUAGE sql
STABLE
AS $$
  WITH bounded AS (
    SELECT
      annee,
      prix_m2
    FROM public.dvf_points
    WHERE code_commune = p_code_commune
      AND type_local = p_type_local
      AND prix_m2 IS NOT NULL
      -- Filtre outliers usuels (cf. /api/estimate)
      AND prix_m2 BETWEEN 500 AND 50000
      AND annee >= (EXTRACT(YEAR FROM NOW())::SMALLINT - p_years_back::SMALLINT)
  )
  SELECT
    annee,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY prix_m2)::NUMERIC AS prix_m2_median,
    percentile_cont(0.25) WITHIN GROUP (ORDER BY prix_m2)::NUMERIC AS prix_m2_p25,
    percentile_cont(0.75) WITHIN GROUP (ORDER BY prix_m2)::NUMERIC AS prix_m2_p75,
    COUNT(*)::INTEGER AS nb_ventes
  FROM bounded
  GROUP BY annee
  -- On ne renvoie pas les années avec trop peu d'observations (bruit statistique)
  HAVING COUNT(*) >= 5
  ORDER BY annee;
$$;

COMMENT ON FUNCTION public.get_price_evolution(TEXT, TEXT, INTEGER) IS
  'Évolution prix m² DVF par année pour (commune, type_local) sur N années. Filtre outliers + années peu fournies (< 5 ventes).';

-- Vue helper : variation 5 ans pour toutes les communes IDF (utile pour
-- dashboards futurs, pas utilisée par le PDF lead pour l'instant)
CREATE OR REPLACE VIEW public.v_commune_evolution_5y AS
WITH base AS (
  SELECT
    code_commune,
    type_local,
    annee,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY prix_m2) AS med
  FROM public.dvf_points
  WHERE prix_m2 BETWEEN 500 AND 50000
    AND annee >= EXTRACT(YEAR FROM NOW())::SMALLINT - 6
    AND type_local IN ('Appartement', 'Maison')
  GROUP BY code_commune, type_local, annee
  HAVING COUNT(*) >= 5
)
SELECT
  code_commune,
  type_local,
  MIN(annee) FILTER (WHERE annee = (EXTRACT(YEAR FROM NOW())::SMALLINT - 5)) AS annee_base,
  MAX(annee) AS annee_last,
  MIN(med) FILTER (WHERE annee = (EXTRACT(YEAR FROM NOW())::SMALLINT - 5)) AS prix_base,
  MAX(med) FILTER (WHERE annee = MAX(annee) OVER (PARTITION BY code_commune, type_local)) AS prix_last
FROM base
GROUP BY code_commune, type_local;

COMMENT ON VIEW public.v_commune_evolution_5y IS
  'Snapshot évolution prix médian par commune sur 5 ans (Appartement + Maison séparés). Base de comparaison pour analyse macro.';
