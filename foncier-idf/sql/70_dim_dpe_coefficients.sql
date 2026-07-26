-- ============================================================
-- Migration 70 — Table dim_dpe_coefficients
-- ============================================================
-- Stocke les coefficients hédoniques de la classe DPE sur le prix
-- de vente, calculés trimestriellement par le pipeline
-- `dpe/regression_dpe.py` (racine repo idf-foncier).
--
-- Une ligne = 1 (période × région × type_bien × classe DPE)
-- avec le %-effet du DPE vs classe D (référence).
--
-- Consommée par :
--   - Site public : /observatoire-dpe (dataviz + API REST)
--   - Estimateur : applyDpeAdjustmentDynamic (lib/datasets/dpe-adjustment.ts)
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.dim_dpe_coefficients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Métadonnées de la période
  period_label TEXT NOT NULL,             -- ex : '2026-07', '2026-Q3'
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Segmentation
  region TEXT NOT NULL,                   -- code département (75, 94, ...) ou 'FR' pour agrégat national
  type_bien TEXT NOT NULL                 -- 'maison', 'appartement', 'tous'
    CHECK (type_bien IN ('maison', 'appartement', 'tous')),
  classe_dpe TEXT NOT NULL                -- 'A' à 'G'
    CHECK (classe_dpe IN ('A', 'B', 'C', 'D', 'E', 'F', 'G')),

  -- Résultats de la régression
  coefficient_log DOUBLE PRECISION,       -- β brut de la régression OLS
  pct_effect DOUBLE PRECISION NOT NULL,   -- (exp(β)-1)*100 : %-effet vs D
  ic_lower_pct DOUBLE PRECISION,          -- borne inf IC 95 %
  ic_upper_pct DOUBLE PRECISION,          -- borne sup IC 95 %
  p_value DOUBLE PRECISION,

  -- Qualité statistique
  n_obs_region INT NOT NULL,              -- taille échantillon dans la région
  n_obs_classe INT NOT NULL,              -- taille échantillon pour cette classe
  r2 DOUBLE PRECISION,

  -- Traçabilité méthodo
  methodology_version TEXT NOT NULL,      -- ex : 'v1_bdnb_maisons'

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une seule ligne par (période × région × type × classe)
CREATE UNIQUE INDEX IF NOT EXISTS idx_dim_dpe_coefficients_uniq
  ON public.dim_dpe_coefficients (period_label, region, type_bien, classe_dpe);

-- Index de lecture publique (site + API)
CREATE INDEX IF NOT EXISTS idx_dim_dpe_coefficients_lookup
  ON public.dim_dpe_coefficients (region, type_bien, classe_dpe, period_label DESC);

-- Index par période (dashboard historique)
CREATE INDEX IF NOT EXISTS idx_dim_dpe_coefficients_period
  ON public.dim_dpe_coefficients (period_label DESC, region, type_bien);

COMMENT ON TABLE public.dim_dpe_coefficients IS
  'Coefficients hédoniques DPE sur le prix de vente. Actualisé trimestriellement par pipeline dpe/regression_dpe.py.';

COMMENT ON COLUMN public.dim_dpe_coefficients.pct_effect IS
  'Effet en % de la classe vs D (référence). Ex: -18.5 pour G = maison G vaut -18.5% vs maison D toutes choses égales par ailleurs.';

COMMENT ON COLUMN public.dim_dpe_coefficients.methodology_version IS
  'Version méthodologique. v1 = BDNB CSTB stats DVF agrégées 2014-2021 sur maisons individuelles.';

-- RLS : lecture publique (données agrégées, non nominatives)
ALTER TABLE public.dim_dpe_coefficients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_dpe_coefficients" ON public.dim_dpe_coefficients;
CREATE POLICY "public_read_dpe_coefficients"
  ON public.dim_dpe_coefficients FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "service_role_write_dpe_coefficients" ON public.dim_dpe_coefficients;
CREATE POLICY "service_role_write_dpe_coefficients"
  ON public.dim_dpe_coefficients FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Vue de la dernière période disponible par région/type/classe
CREATE OR REPLACE VIEW public.v_dpe_coefficients_latest AS
SELECT DISTINCT ON (region, type_bien, classe_dpe)
  region,
  type_bien,
  classe_dpe,
  period_label,
  pct_effect,
  ic_lower_pct,
  ic_upper_pct,
  n_obs_classe,
  r2,
  methodology_version,
  run_at
FROM public.dim_dpe_coefficients
ORDER BY region, type_bien, classe_dpe, period_label DESC;

COMMIT;
