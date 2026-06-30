-- ============================================================================
-- 41_eurealimmo_onboarding.sql
--
-- Pipeline d'onboarding mandataire avec checklist 10 étapes + tracking
-- d'avancement par mandataire + relances automatiques J+3/J+7/J+14.
--
-- Le mandataire suit visuellement sa checklist sur /mandataire/[id]/onboarding
-- Samuel surveille tout depuis /cabinets/eurealimmo/admin/onboarding
--
-- Prérequis : SQL 38 (eurealimmo_mandataires + touch_eurealimmo_updated_at)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Référentiel des étapes d'onboarding (10 étapes seed)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eurealimmo_onboarding_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_order INT NOT NULL UNIQUE,
  step_key TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  resource_url TEXT,
  estimated_days INT NOT NULL DEFAULT 2,
  is_required BOOLEAN NOT NULL DEFAULT true,
  validation_type TEXT NOT NULL DEFAULT 'self_declare'
    CHECK (validation_type IN ('auto', 'self_declare', 'admin_validation', 'document_upload')),
  category TEXT NOT NULL DEFAULT 'standard'
    CHECK (category IN ('intake', 'legal', 'training', 'cci', 'tools', 'milestone')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_steps_order
  ON public.eurealimmo_onboarding_steps (step_order);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Progression par mandataire (un row par mandataire × étape)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eurealimmo_onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  mandataire_id UUID NOT NULL REFERENCES public.eurealimmo_mandataires(id) ON DELETE CASCADE,
  step_id UUID NOT NULL REFERENCES public.eurealimmo_onboarding_steps(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped', 'blocked')),

  completed_at TIMESTAMPTZ,
  evidence_url TEXT,
  notes TEXT,
  blocker_reason TEXT,

  -- Validation admin (qui a validé + quand)
  admin_validated_at TIMESTAMPTZ,
  admin_validated_by TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (mandataire_id, step_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_progress_mandataire
  ON public.eurealimmo_onboarding_progress (mandataire_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_progress_status
  ON public.eurealimmo_onboarding_progress (status, updated_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Log des relances envoyées (Resend)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eurealimmo_onboarding_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mandataire_id UUID NOT NULL REFERENCES public.eurealimmo_mandataires(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL
    CHECK (reminder_type IN ('j3', 'j7', 'j14', 'admin_manual')),
  trigger_step_key TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resend_message_id TEXT,
  email_sent_to TEXT NOT NULL,
  email_subject TEXT,
  succeeded BOOLEAN NOT NULL DEFAULT true,
  error_detail TEXT
);

CREATE INDEX IF NOT EXISTS idx_onboarding_reminders_mandataire
  ON public.eurealimmo_onboarding_reminders (mandataire_id, sent_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Vue agrégée — pour le dashboard admin
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_eurealimmo_onboarding_summary AS
SELECT
  m.id AS mandataire_id,
  m.first_name,
  m.last_name,
  m.email,
  m.phone,
  m.specialty,
  -- Tier dérivé depuis commission_eurealimmo_pct (5%=founder, 8%=standard, 0=non défini)
  CASE
    WHEN m.commission_eurealimmo_pct = 5 THEN 'founder'
    WHEN m.commission_eurealimmo_pct = 8 THEN 'standard'
    WHEN m.commission_eurealimmo_pct IS NULL THEN 'pending'
    ELSE 'custom'
  END AS tier,
  m.is_active,
  m.is_blocked,
  m.created_at AS mandataire_created_at,

  -- Counts steps
  (SELECT COUNT(*) FROM public.eurealimmo_onboarding_steps WHERE is_required) AS total_required_steps,
  COUNT(p.id) FILTER (WHERE p.status = 'completed' AND s.is_required) AS completed_required_steps,
  COUNT(p.id) FILTER (WHERE p.status = 'in_progress') AS in_progress_steps,
  COUNT(p.id) FILTER (WHERE p.status = 'blocked') AS blocked_steps,

  -- % de complétion
  ROUND(
    100.0 * COUNT(p.id) FILTER (WHERE p.status = 'completed' AND s.is_required)
      / NULLIF((SELECT COUNT(*) FROM public.eurealimmo_onboarding_steps WHERE is_required), 0),
    0
  ) AS pct_completion,

  -- Dernière activité
  MAX(p.updated_at) AS last_activity_at,
  EXTRACT(DAY FROM (now() - COALESCE(MAX(p.updated_at), m.created_at)))::INT AS days_since_last_activity,

  -- Ready pour 1er mandat ? (toutes les étapes required jusqu'à #9 datamerry_active sont completed)
  (
    SELECT bool_and(p2.status = 'completed')
    FROM public.eurealimmo_onboarding_progress p2
    JOIN public.eurealimmo_onboarding_steps s2 ON s2.id = p2.step_id
    WHERE p2.mandataire_id = m.id
      AND s2.is_required
      AND s2.step_order <= 9
  ) AS ready_for_first_mandate

FROM public.eurealimmo_mandataires m
LEFT JOIN public.eurealimmo_onboarding_progress p ON p.mandataire_id = m.id
LEFT JOIN public.eurealimmo_onboarding_steps s ON s.id = p.step_id
GROUP BY m.id, m.first_name, m.last_name, m.email, m.phone, m.specialty,
         m.commission_eurealimmo_pct, m.is_active, m.is_blocked, m.created_at;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Fonction utilitaire : initialiser les 10 étapes pour un nouveau mandataire
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.init_onboarding_for_mandataire(p_mandataire_id UUID)
RETURNS INT
LANGUAGE plpgsql
AS $func$
DECLARE
  v_count INT;
BEGIN
  INSERT INTO public.eurealimmo_onboarding_progress (mandataire_id, step_id, status)
  SELECT p_mandataire_id, s.id,
         CASE WHEN s.validation_type = 'auto' AND s.step_key = 'email_confirmed'
              THEN 'completed' ELSE 'pending' END
  FROM public.eurealimmo_onboarding_steps s
  ON CONFLICT (mandataire_id, step_id) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$func$;

COMMENT ON FUNCTION public.init_onboarding_for_mandataire IS
  'Crée les 10 entrées de progress pour un nouveau mandataire. À appeler après l''insertion d''un mandataire.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.eurealimmo_onboarding_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eurealimmo_onboarding_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eurealimmo_onboarding_reminders ENABLE ROW LEVEL SECURITY;

-- Service role : full access sur toutes les tables onboarding
DO $$
DECLARE
  t RECORD;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'eurealimmo_onboarding_steps',
      'eurealimmo_onboarding_progress',
      'eurealimmo_onboarding_reminders'
    ]) AS table_name
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "service_role_full_%I" ON public.%I',
      t.table_name, t.table_name
    );
    EXECUTE format(
      'CREATE POLICY "service_role_full_%I" ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      t.table_name, t.table_name
    );
  END LOOP;
END $$;

-- Public read sur les steps (référentiel pas confidentiel)
DROP POLICY IF EXISTS "public_read_onboarding_steps" ON public.eurealimmo_onboarding_steps;
CREATE POLICY "public_read_onboarding_steps" ON public.eurealimmo_onboarding_steps
  FOR SELECT USING (true);

GRANT SELECT ON public.eurealimmo_onboarding_steps TO anon, authenticated;
GRANT SELECT ON public.v_eurealimmo_onboarding_summary TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Trigger updated_at sur progress
-- ─────────────────────────────────────────────────────────────────────────────

DROP TRIGGER IF EXISTS trg_touch_onboarding_progress ON public.eurealimmo_onboarding_progress;
CREATE TRIGGER trg_touch_onboarding_progress BEFORE UPDATE ON public.eurealimmo_onboarding_progress
  FOR EACH ROW EXECUTE FUNCTION public.touch_eurealimmo_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Seed initial — 10 étapes standard
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.eurealimmo_onboarding_steps
  (step_order, step_key, title, description, resource_url, estimated_days,
   is_required, validation_type, category)
VALUES
  (1, 'email_confirmed',
   'Email confirmé',
   'Validation automatique de votre adresse email via le lien magique reçu après votre candidature.',
   NULL, 0, true, 'auto', 'intake'),

  (2, 'structure_juridique',
   'Création / vérification structure juridique',
   'Entreprise Individuelle (EI) — au régime micro (= auto-entrepreneur, gratuit, recommandé pour démarrage) ou au régime réel ; sinon société SASU ou EURL. Renseignez votre SIREN une fois créé sur formalites.entreprises.gouv.fr (activité : agent commercial code APE 6831Z, régime micro-BNC ou réel).',
   'https://formalites.entreprises.gouv.fr',
   5, true, 'self_declare', 'legal'),

  (3, 'rcp_souscrite',
   'Souscription RCP agent commercial',
   'Responsabilité Civile Professionnelle agent commercial immobilier obligatoire (loi Hoguet art. 4). Comptez 150-200 €/an. Uploadez l''attestation dès souscription. Courtiers recommandés : April, Hiscox, AXA Pro.',
   NULL,
   3, true, 'document_upload', 'legal'),

  (4, 'alur_inscription',
   'Inscription formation Loi ALUR initiale',
   'Choisissez un de nos 3 partenaires recommandés : Pop Academy (99 € Qualiopi, classée N°1 2026), Maformationimmo.fr (99 €, 20 000 pros formés), ou ENFPI Paris (~490 €, premium). Confirmez votre inscription par lien.',
   NULL,
   2, true, 'self_declare', 'training'),

  (5, 'alur_completee',
   'Formation Loi ALUR 14h complétée',
   'Uploadez l''attestation Qualiopi de complétion (14 heures obligatoires couvrant déontologie, non-discrimination, DPE, LCB-FT).',
   NULL,
   7, true, 'document_upload', 'training'),

  (6, 'contrat_signe',
   'Signature contrat mandataire Eurealimmo',
   'Lecture et signature du contrat envoyé par notre équipe. Signature électronique sécurisée, pas de RDV physique nécessaire. Validation par Samuel.',
   NULL,
   3, true, 'admin_validation', 'legal'),

  (7, 'cci_declared',
   'Déclaration RCO à la CCI Paris',
   'Nous déposons votre dossier RCO (Représentant de carte T) à la CCI Paris. 50 € à régler directement à la CCI (frais réglementaire incompressible, non versé à Eurealimmo). Récépissé à uploader.',
   NULL,
   5, true, 'document_upload', 'cci'),

  (8, 'cci_validated',
   'Validation RCO par la CCI Paris',
   'Attente du retour CCI Paris (3-7 jours ouvrés en moyenne). Notification automatique dès validation.',
   NULL,
   7, true, 'admin_validation', 'cci'),

  (9, 'datamerry_active',
   'Activation accès DATAMERRY®',
   'Création de votre compte DATAMERRY et tour guidé de l''interface (estimation 30 sec, micro-marchés HDBSCAN, rapport PDF vendeur, chatbot LLM). Activation automatique après validation CCI.',
   NULL,
   1, true, 'auto', 'tools'),

  (10, 'first_mandate',
   'Premier mandat signé',
   'Objectif final : votre premier mandat signé sous 15-30 jours après l''onboarding complet. Marqué par Samuel à la signature effective.',
   NULL,
   14, false, 'admin_validation', 'milestone')

ON CONFLICT (step_key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Vérification finale
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  (SELECT COUNT(*) FROM public.eurealimmo_onboarding_steps) AS steps_seeded,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE 'eurealimmo_onboarding%') AS tables_created,
  (SELECT COUNT(*) FROM information_schema.views
   WHERE table_schema = 'public' AND table_name = 'v_eurealimmo_onboarding_summary') AS view_created;

COMMENT ON TABLE public.eurealimmo_onboarding_steps IS
  'Référentiel des 10 étapes d''onboarding d''un mandataire Eurealimmo. Seedé par migration 41.';
COMMENT ON TABLE public.eurealimmo_onboarding_progress IS
  'Avancement d''un mandataire dans son onboarding. Une ligne par (mandataire, étape).';
COMMENT ON TABLE public.eurealimmo_onboarding_reminders IS
  'Log des relances Resend envoyées (J+3 self-service, J+7 Samuel, J+14 alerte admin).';
