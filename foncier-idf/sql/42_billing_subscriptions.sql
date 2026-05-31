-- ============================================================================
-- 42_billing_subscriptions.sql
--
-- Stripe billing pour les cabinets DATAMERRY abonnés (39 €/mo).
--
-- Architecture :
--   - 1 cabinet (dim_cabinets_white_label) → 0..N subscriptions Stripe
--   - On track : status, current_period_end, stripe_subscription_id
--   - Le webhook /api/webhooks/stripe maintient l'état à jour
--   - La page admin du cabinet affiche le statut + lien portail Stripe
--
-- Plan unique pour MVP : DATAMERRY Pro 39 €/mo HT (468 €/an HT).
-- Plans futurs (Y2) : Enterprise, Réseau, etc.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dim_cabinet_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lien vers le cabinet
  cabinet_slug TEXT NOT NULL,
  -- (Pas de FK contrainte pour pouvoir gérer des abonnements indépendants)

  -- Stripe references
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,
  stripe_product_id TEXT,

  -- Plan info (snapshot, pour audit historique)
  plan_name TEXT NOT NULL DEFAULT 'DATAMERRY Pro',
  plan_amount_eur INT NOT NULL,    -- en centimes (3900 = 39 €)
  plan_interval TEXT NOT NULL DEFAULT 'month'
    CHECK (plan_interval IN ('month', 'year')),
  plan_currency TEXT NOT NULL DEFAULT 'eur',

  -- État
  status TEXT NOT NULL DEFAULT 'incomplete'
    CHECK (status IN (
      'incomplete', 'incomplete_expired', 'trialing', 'active',
      'past_due', 'canceled', 'unpaid', 'paused'
    )),

  -- Périodes
  trial_end TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,

  -- Cancel at period end
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,

  -- Métadonnées
  customer_email TEXT,
  customer_name TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_cabinet
  ON public.dim_cabinet_subscriptions (cabinet_slug, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON public.dim_cabinet_subscriptions (stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end
  ON public.dim_cabinet_subscriptions (current_period_end);

-- ─────────────────────────────────────────────────────────────────────────────
-- Log des events Stripe (audit + replay si besoin)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dim_stripe_webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT UNIQUE NOT NULL,
  event_type TEXT NOT NULL,
  api_version TEXT,
  cabinet_slug TEXT,
  subscription_id TEXT,
  customer_id TEXT,
  raw_payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  processing_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_type
  ON public.dim_stripe_webhook_events (event_type, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_stripe_events_unprocessed
  ON public.dim_stripe_webhook_events (received_at)
  WHERE processed_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- Vue : statut billing par cabinet (1 row par cabinet, dernière subscription)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_cabinet_billing_status AS
SELECT DISTINCT ON (cabinet_slug)
  cabinet_slug,
  status,
  plan_name,
  plan_amount_eur,
  plan_interval,
  current_period_end,
  cancel_at_period_end,
  trial_end,
  stripe_subscription_id,
  stripe_customer_id,
  customer_email,
  updated_at
FROM public.dim_cabinet_subscriptions
ORDER BY cabinet_slug, created_at DESC;

GRANT SELECT ON public.v_cabinet_billing_status TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.dim_cabinet_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dim_stripe_webhook_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_subscriptions" ON public.dim_cabinet_subscriptions;
CREATE POLICY "service_role_full_subscriptions"
  ON public.dim_cabinet_subscriptions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "service_role_full_stripe_events" ON public.dim_stripe_webhook_events;
CREATE POLICY "service_role_full_stripe_events"
  ON public.dim_stripe_webhook_events FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger updated_at
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_subscription_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_touch_subscription ON public.dim_cabinet_subscriptions;
CREATE TRIGGER trg_touch_subscription BEFORE UPDATE ON public.dim_cabinet_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.touch_subscription_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Vérification finale
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'dim_cabinet_subscriptions') AS subscriptions_table,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'dim_stripe_webhook_events') AS events_table,
  (SELECT COUNT(*) FROM information_schema.views
   WHERE table_schema = 'public' AND table_name = 'v_cabinet_billing_status') AS view_created;

COMMENT ON TABLE public.dim_cabinet_subscriptions IS
  'Abonnements Stripe des cabinets DATAMERRY (39 €/mo HT). Mis à jour par /api/webhooks/stripe.';
COMMENT ON TABLE public.dim_stripe_webhook_events IS
  'Log brut des webhooks Stripe reçus (audit + idempotence + replay si besoin).';
