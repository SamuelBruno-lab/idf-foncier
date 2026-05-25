-- DATAMERRY — Modèle CAPM-DCF pour valorisation immobilière institutionnelle
--
-- Implémente le framework de la formule classique :
--   t_a = t_sr + β × p_rm
--
-- Où :
--   t_a  : taux d'actualisation (utilisé pour discounter les cash-flows futurs)
--   t_sr : taux sans risque (OAT 10 ans France — table fact_taux_oat10y)
--   β    : beta du micro-marché (volatilité × illiquidité × rareté)
--   p_rm : prime de risque marché immobilier (rendement immo − OAT)
--
-- Approche pédagogique pour conseillers premium banque/finance qui
-- reconnaîtront immédiatement le CAPM-Markowitz-Sharpe.

-- ============================================================================
-- 1. fact_cluster_risk — β composite par cluster HDBSCAN
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.fact_cluster_risk (
  zone_id TEXT PRIMARY KEY REFERENCES public.dvf_hdbscan_zones(id) ON DELETE CASCADE,

  -- Composantes brutes (raw measures)
  sigma_qoq_pct NUMERIC(10, 4),         -- Volatilité QoQ% sur la période
  lambda_illiquidite NUMERIC(10, 4),     -- 1 / (ventes par an) — illiquidité
  rho_rarete NUMERIC(10, 4),             -- 1 / (ventes par km²) — rareté inverse densité

  -- Z-scores (standardisés vs population de tous les clusters)
  z_sigma NUMERIC(10, 4),
  z_lambda NUMERIC(10, 4),
  z_rho NUMERIC(10, 4),

  -- Beta composite (pondération 0.5/0.3/0.2 par défaut, recentré sur 1)
  beta NUMERIC(10, 4) NOT NULL,

  -- Métadonnées
  n_obs_total INT,                       -- nombre de ventes du cluster
  n_quarters INT,                        -- nombre de trimestres avec observations
  area_km2 NUMERIC(10, 6),                -- aire approximative du hull en km²
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fact_cluster_risk IS
  'Beta CAPM-style par cluster HDBSCAN. Calculé par analyses/compute_cluster_risk_beta.py.';
COMMENT ON COLUMN public.fact_cluster_risk.beta IS
  'Composite recentré : β=1 pour cluster médian France, β>1 plus risqué, β<1 plus défensif.';
COMMENT ON COLUMN public.fact_cluster_risk.sigma_qoq_pct IS
  'Volatilité trimestrielle (écart-type des YoY% glissants).';
COMMENT ON COLUMN public.fact_cluster_risk.lambda_illiquidite IS
  'Indicateur d''illiquidité = 1 / (ventes par an). Plus c''est haut, moins le marché est liquide.';
COMMENT ON COLUMN public.fact_cluster_risk.rho_rarete IS
  'Indicateur de rareté = 1 / (densité ventes par km²). Plus c''est haut, moins il y a d''offre.';

CREATE INDEX IF NOT EXISTS idx_fact_cluster_risk_beta
  ON public.fact_cluster_risk (beta);

-- RLS — service_role seulement
ALTER TABLE public.fact_cluster_risk ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_cluster_risk" ON public.fact_cluster_risk;
CREATE POLICY "service_role_full_cluster_risk"
  ON public.fact_cluster_risk FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "anon_read_cluster_risk" ON public.fact_cluster_risk;
CREATE POLICY "anon_read_cluster_risk"
  ON public.fact_cluster_risk FOR SELECT
  USING (true);

-- ============================================================================
-- 2. v_market_risk_premium — prime de risque marché immobilier France
-- ============================================================================
-- p_rm = rendement_immo_median_france − taux_sans_risque
-- Calculé sur les données les plus récentes disponibles dans fact_rendement
-- et fact_taux_oat10y.
CREATE OR REPLACE VIEW public.v_market_risk_premium AS
WITH
  rendement_median AS (
    SELECT
      AVG(rendement_brut) FILTER (
        WHERE rendement_brut IS NOT NULL
          AND rendement_brut BETWEEN 1 AND 15  -- filtre outliers
      ) AS rendement_brut_moyen_france,
      COUNT(*) AS n_zones
    FROM public.fact_rendement
  ),
  oat_actuel AS (
    SELECT taux_oat_10y AS t_sr
    FROM public.fact_taux_oat10y
    ORDER BY date_obs DESC
    LIMIT 1
  )
SELECT
  ROUND(r.rendement_brut_moyen_france::numeric, 4) AS rendement_immo_france_pct,
  ROUND(o.t_sr::numeric, 4) AS taux_sans_risque_pct,
  ROUND((r.rendement_brut_moyen_france - o.t_sr)::numeric, 4) AS prime_risque_marche_pct,
  r.n_zones AS n_zones_observees,
  now() AS computed_at
FROM rendement_median r, oat_actuel o;

COMMENT ON VIEW public.v_market_risk_premium IS
  'Prime de risque marché immobilier France = rendement immo médian − OAT 10y. Utilisée par le chatbot DATAMERRY pour calculer le taux d''actualisation CAPM.';

-- ============================================================================
-- 3. Helper : compute_discount_rate(zone_id) — taux CAPM par cluster
-- ============================================================================
CREATE OR REPLACE FUNCTION public.compute_discount_rate(p_zone_id TEXT)
RETURNS TABLE (
  zone_id TEXT,
  t_sr NUMERIC,
  beta NUMERIC,
  p_rm NUMERIC,
  t_a NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    p_zone_id,
    mrp.taux_sans_risque_pct AS t_sr,
    COALESCE(cr.beta, 1.0) AS beta,
    mrp.prime_risque_marche_pct AS p_rm,
    ROUND(
      (mrp.taux_sans_risque_pct + COALESCE(cr.beta, 1.0) * mrp.prime_risque_marche_pct)::numeric,
      4
    ) AS t_a
  FROM public.v_market_risk_premium mrp
  LEFT JOIN public.fact_cluster_risk cr ON cr.zone_id = p_zone_id;
$$;

COMMENT ON FUNCTION public.compute_discount_rate IS
  'Renvoie le taux d''actualisation CAPM pour un cluster donné : t_a = t_sr + β × p_rm. Default β=1 si le cluster n''a pas encore de risque calculé.';
