-- ============================================================================
-- 49_mandataire_sepa.sql
--
-- Prélèvement SEPA de l'abonnement réseau mandataire via Stripe Billing
-- (Stripe = créancier SEPA → pas besoin d'ICS propre).
--
-- Founder : 59 €/mo, essai 6 mois (1er prélèvement au mois 7).
-- Standard : 79 €/mo, sans essai.
--
-- Sécurise l'engagement : abonnement auto-prélevé + relances (dunning) Stripe ;
-- suspension de l'accès sur impayé ; contract_lock_until borne les 36 mois.
-- ============================================================================

ALTER TABLE public.eurealimmo_mandataires
  ADD COLUMN IF NOT EXISTS stripe_customer_id      TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  TEXT,
  ADD COLUMN IF NOT EXISTS sepa_status             TEXT,
  ADD COLUMN IF NOT EXISTS sepa_authorized_at      TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mandataires_sepa_status_ck'
  ) THEN
    ALTER TABLE public.eurealimmo_mandataires
      ADD CONSTRAINT mandataires_sepa_status_ck
      CHECK (sepa_status IS NULL OR sepa_status IN
        ('pending', 'authorized', 'active', 'trialing', 'past_due', 'canceled'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mandataires_stripe_subscription
  ON public.eurealimmo_mandataires (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

COMMENT ON COLUMN public.eurealimmo_mandataires.sepa_status IS
  'Statut du mandat/abonnement SEPA Stripe : pending|authorized|active|trialing|past_due|canceled.';
COMMENT ON COLUMN public.eurealimmo_mandataires.sepa_authorized_at IS
  'Date d''autorisation effective du prélèvement SEPA (mandat signé via Stripe Checkout).';
