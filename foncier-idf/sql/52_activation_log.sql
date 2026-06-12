-- ============================================================
-- Migration 52 — Log des activations mandataires
-- ============================================================
-- Trace chaque appel à POST /admin/mandataires/[id]/activate
-- pour audit (qui a activé qui, quand, état email Resend).
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.eurealimmo_activation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mandataire_id UUID NOT NULL,
  activated_by_admin TEXT NOT NULL,
  activated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  email_status TEXT
    CHECK (email_status IN ('sent', 'skipped', 'failed')),
  email_error TEXT,

  note TEXT
);

CREATE INDEX IF NOT EXISTS eurealimmo_activation_log_mandataire_idx
  ON public.eurealimmo_activation_log (mandataire_id, activated_at DESC);

COMMENT ON TABLE public.eurealimmo_activation_log IS
  'Trace les activations mandataires (signature contrat + envoi email workspace).';

-- RLS activée, aucune policy : seule la service_role key (côté serveur)
-- peut lire/écrire. Les clés anon et authenticated sont bloquées.
ALTER TABLE public.eurealimmo_activation_log ENABLE ROW LEVEL SECURITY;

COMMIT;
