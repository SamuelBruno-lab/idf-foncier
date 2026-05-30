-- ============================================================================
-- 39_eurealimmo_applications.sql
--
-- Candidatures mandataires reçues via reseau.eurealimmo.com
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.eurealimmo_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identité
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,

  -- Profil professionnel
  current_status TEXT NOT NULL
    CHECK (current_status IN (
      'mandataire_actif', 'agent_commercial', 'ex_banque_privee',
      'reconversion', 'independant_carte_t', 'autre'
    )),
  current_network TEXT,
  years_experience TEXT NOT NULL
    CHECK (years_experience IN ('0-1', '1-3', '3-7', '7-15', '15+')),
  has_carte_t TEXT NOT NULL
    CHECK (has_carte_t IN ('non', 'oui', 'transition')),
  specialty TEXT NOT NULL
    CHECK (specialty IN (
      'hnwi', 'ancien_standing', 'standard', 'commercial', 'location', 'mixte'
    )),

  -- Motivation
  motivation TEXT NOT NULL,

  -- Process review
  status TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN (
      'new', 'reviewing', 'call_scheduled', 'call_done',
      'accepted', 'rejected', 'withdrawn'
    )),
  reviewer_notes TEXT,
  call_scheduled_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewer_email TEXT,

  -- Source tracking
  source TEXT DEFAULT 'website',  -- website / referral_diara / linkedin / autre
  referred_by_email TEXT,         -- email de qui a recommandé le candidat

  -- Traçabilité
  ip_hash TEXT,
  user_agent TEXT,
  consent_given BOOLEAN NOT NULL DEFAULT false,
  consent_given_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applications_status
  ON public.eurealimmo_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_email
  ON public.eurealimmo_applications (lower(email));
CREATE INDEX IF NOT EXISTS idx_applications_referred
  ON public.eurealimmo_applications (referred_by_email)
  WHERE referred_by_email IS NOT NULL;

-- RLS : seul le service_role (côté API serveur) accède
ALTER TABLE public.eurealimmo_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_applications" ON public.eurealimmo_applications;
CREATE POLICY "service_role_full_applications"
  ON public.eurealimmo_applications FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_touch_applications ON public.eurealimmo_applications;
CREATE TRIGGER trg_touch_applications BEFORE UPDATE ON public.eurealimmo_applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_eurealimmo_updated_at();

COMMENT ON TABLE public.eurealimmo_applications IS
  'Candidatures mandataires reçues via reseau.eurealimmo.com. Pipeline : new → reviewing → call_scheduled → call_done → accepted/rejected.';

-- Vérification
SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'eurealimmo_applications') AS table_created;
