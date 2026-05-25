-- DATAMERRY — Série historique du taux OAT 10 ans
--
-- Source : ECB Statistical Data Warehouse (autorité européenne, journalier)
-- Fallback : Banque de France Webstat
--
-- L'OAT 10 ans (Obligation Assimilable du Trésor) est le coût d'emprunt
-- long terme de l'État français. C'est le meilleur proxy public du contexte
-- macro pour le marché immobilier (les taux clients = OAT + spread bancaire
-- 150-250 bp + frais).
--
-- Usage prévu :
--   1. Analyse statistique DVF × OAT (corrélation, élasticité prix/taux)
--   2. Tool chatbot `compute_market_adjusted_price` : ajustement du prix
--      cluster DVF en fonction du delta entre taux historique et taux actuel
--
-- Volume : ~6 500 lignes pour 1990-2025 (jours ouvrés uniquement).

CREATE TABLE IF NOT EXISTS public.fact_taux_oat10y (
  date_obs DATE PRIMARY KEY,
  taux_oat_10y NUMERIC(8, 4) NOT NULL,       -- en pourcentage (ex: 3.1500)
  source TEXT NOT NULL DEFAULT 'ECB_SDW',     -- 'ECB_SDW' | 'BDF_WEBSTAT' | 'FRED'
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fact_taux_oat10y IS
  'Série historique journalière OAT 10 ans France. Source autorité : ECB SDW.';
COMMENT ON COLUMN public.fact_taux_oat10y.taux_oat_10y IS
  'Taux en % (ex: 3.1500 = 3,15%). Cohérent avec format ECB SDW.';

CREATE INDEX IF NOT EXISTS idx_fact_taux_oat10y_year
  ON public.fact_taux_oat10y (extract(year from date_obs));

-- RLS — anon peut lire (donnée publique, utile pour analytics datamerry.com)
ALTER TABLE public.fact_taux_oat10y ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_oat" ON public.fact_taux_oat10y;
CREATE POLICY "anon_read_oat"
  ON public.fact_taux_oat10y FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "service_role_full_oat" ON public.fact_taux_oat10y;
CREATE POLICY "service_role_full_oat"
  ON public.fact_taux_oat10y FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ============================================================================
-- Vue d'agrégation : moyenne annuelle (utilisée par le modèle d'ajustement)
-- ============================================================================
CREATE OR REPLACE VIEW public.v_taux_oat10y_annual AS
SELECT
  extract(year from date_obs)::INT AS annee,
  ROUND(AVG(taux_oat_10y), 4)      AS taux_moyen,
  ROUND(MIN(taux_oat_10y), 4)      AS taux_min,
  ROUND(MAX(taux_oat_10y), 4)      AS taux_max,
  ROUND(STDDEV(taux_oat_10y), 4)   AS taux_stddev,
  COUNT(*)                          AS nb_obs
FROM public.fact_taux_oat10y
GROUP BY 1
ORDER BY 1;

COMMENT ON VIEW public.v_taux_oat10y_annual IS
  'Statistiques annuelles OAT 10 ans — utilisée par le modèle d''ajustement de prix.';

-- ============================================================================
-- Helper : récupère le taux le plus récent (ou null si table vide)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_latest_oat10y()
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT taux_oat_10y
  FROM public.fact_taux_oat10y
  ORDER BY date_obs DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_latest_oat10y IS
  'Renvoie la dernière valeur OAT 10 ans connue (pour le contexte marché chatbot).';
