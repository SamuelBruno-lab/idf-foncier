-- DATAMERRY API — Authentification par clé API
-- Pricing: 39€ TTC/mo flat + 50k req inclus + 1€ TTC / 1000 req overage
--
-- Architecture:
--   dim_api_keys  : 1 ligne par clé (un cabinet peut avoir plusieurs clés actives)
--   api_usage_log : 1 ligne par requête (pour metered billing Stripe + analytics)
--
-- La clé en clair (dmk_xxx...) n'est JAMAIS stockée. On stocke key_hash (SHA-256)
-- et key_prefix (8 premiers chars) pour identification rapide dans les logs.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. dim_api_keys
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.dim_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identité du cabinet
  cabinet_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  siren TEXT,                       -- optionnel (Collabimmo, etc.)

  -- Clé (le clair n'est jamais stocké)
  key_prefix TEXT NOT NULL,         -- ex: 'dmk_live'  (les 8 premiers chars, pour debug)
  key_hash TEXT NOT NULL UNIQUE,    -- SHA-256 hex de la clé complète

  -- Plan & quotas
  plan TEXT NOT NULL DEFAULT 'pro' CHECK (plan IN ('pilot', 'pro', 'enterprise', 'internal')),
  monthly_quota INT NOT NULL DEFAULT 50000,   -- requêtes incluses dans le forfait
  overage_per_1k_eur_ttc NUMERIC(10,4) NOT NULL DEFAULT 1.0,

  -- Stripe (Phase 9, nullable pour les clés issued à la main)
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  stripe_subscription_item_id TEXT, -- pour metered billing usage records

  -- Cycle de vie
  active BOOLEAN NOT NULL DEFAULT true,
  first_month_free BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,            -- null = no expiry
  revoked_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,

  -- Notes internes
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_dim_api_keys_hash ON public.dim_api_keys (key_hash);
CREATE INDEX IF NOT EXISTS idx_dim_api_keys_active ON public.dim_api_keys (active) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_dim_api_keys_stripe_sub ON public.dim_api_keys (stripe_subscription_id);

COMMENT ON TABLE public.dim_api_keys IS 'Clés API DATAMERRY — 1 ligne = 1 clé. La clé en clair (dmk_...) n''est pas stockée.';
COMMENT ON COLUMN public.dim_api_keys.key_hash IS 'SHA-256 hex (lowercase) de la clé complète en clair.';
COMMENT ON COLUMN public.dim_api_keys.key_prefix IS '8 premiers caractères de la clé, pour identification en logs/UI.';

-- ============================================================================
-- 2. api_usage_log
-- ============================================================================
-- Partitionnable par mois plus tard si volume > 10M lignes/an.
CREATE TABLE IF NOT EXISTS public.api_usage_log (
  id BIGSERIAL PRIMARY KEY,
  api_key_id UUID NOT NULL REFERENCES public.dim_api_keys(id) ON DELETE CASCADE,

  -- Requête
  endpoint TEXT NOT NULL,            -- ex: '/api/estimate'
  method TEXT NOT NULL DEFAULT 'GET',
  status INT NOT NULL,               -- HTTP status retourné
  latency_ms INT,                    -- temps de réponse côté serveur
  ip TEXT,                           -- pour rate-limiting / audit (peut être null si Vercel masque)
  user_agent TEXT,

  -- Contexte fonctionnel (optionnel, pour analytics produit)
  address_searched TEXT,             -- adresse complète si endpoint = /api/estimate ou similaire
  insee_commune TEXT,
  surface NUMERIC,

  -- Billing
  billable BOOLEAN NOT NULL DEFAULT true,   -- false = retry, erreur 5xx côté nous, etc.
  billed_to_stripe BOOLEAN NOT NULL DEFAULT false,
  billed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_log_key_date
  ON public.api_usage_log (api_key_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_billing
  ON public.api_usage_log (billed_to_stripe, billable, created_at)
  WHERE billable = true AND billed_to_stripe = false;
CREATE INDEX IF NOT EXISTS idx_api_usage_log_endpoint
  ON public.api_usage_log (endpoint, created_at DESC);

COMMENT ON TABLE public.api_usage_log IS 'Log des requêtes API — utilisé pour metered billing Stripe (Phase 9) et analytics.';

-- ============================================================================
-- 3. Vue d'agrégation mensuelle (utilisée par le cron Stripe usage_records)
-- ============================================================================
CREATE OR REPLACE VIEW public.v_api_usage_monthly AS
SELECT
  k.id                                     AS api_key_id,
  k.cabinet_name,
  k.stripe_subscription_item_id,
  k.monthly_quota,
  date_trunc('month', l.created_at)        AS month_start,
  COUNT(*) FILTER (WHERE l.billable)       AS billable_requests,
  COUNT(*)                                 AS total_requests,
  GREATEST(
    0,
    COUNT(*) FILTER (WHERE l.billable) - k.monthly_quota
  )                                        AS overage_requests,
  CEIL(
    GREATEST(
      0,
      COUNT(*) FILTER (WHERE l.billable) - k.monthly_quota
    )::NUMERIC / 1000.0
  ) * k.overage_per_1k_eur_ttc             AS overage_eur_ttc
FROM public.dim_api_keys k
LEFT JOIN public.api_usage_log l
  ON l.api_key_id = k.id
WHERE k.active = true
GROUP BY k.id, date_trunc('month', l.created_at);

COMMENT ON VIEW public.v_api_usage_monthly IS 'Agrégat mensuel par clé API — input du cron Stripe metered billing.';

-- ============================================================================
-- 4. RLS — Service role only (les clés n'ont aucune raison d'être lues par anon)
-- ============================================================================
ALTER TABLE public.dim_api_keys   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage_log  ENABLE ROW LEVEL SECURITY;

-- Service role bypass RLS de toute façon, mais on est explicite pour CI.
DROP POLICY IF EXISTS "service_role_full_access_keys" ON public.dim_api_keys;
CREATE POLICY "service_role_full_access_keys"
  ON public.dim_api_keys FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_full_access_usage" ON public.api_usage_log;
CREATE POLICY "service_role_full_access_usage"
  ON public.api_usage_log FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
