-- ============================================================================
-- 40_eurealimmo_referral_codes.sql
--
-- Codes referral pour le programme Fondateur Eurealimmo.
--
-- Stratégie : chaque mandataire ambassadeur (Diara, Samuel, etc.) a un code
-- unique court (ex: "DIARA", "SAMUEL") qui :
--   - Pré-applique l'offre Fondateur (59€/mo + 5% com + 6 mois gratuits + 18% referral)
--   - Limite à N places (ex: 5 pour Diara, 10 pour Samuel)
--   - Track qui a recruté qui pour le calcul du 18% à vie
--
-- URL magique : https://reseau.eurealimmo.com/?ref=DIARA
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.eurealimmo_referral_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Code unique court (case-insensitive en pratique)
  code TEXT UNIQUE NOT NULL,

  -- Propriétaire du code (qui invite)
  owner_name TEXT NOT NULL,
  owner_email TEXT NOT NULL,

  -- Tier appliqué automatiquement aux candidatures via ce code
  tier TEXT NOT NULL DEFAULT 'founder'
    CHECK (tier IN ('founder', 'standard', 'partner')),

  -- Limite + compteur
  max_uses INTEGER NOT NULL DEFAULT 5,  -- 5 places par défaut
  current_uses INTEGER NOT NULL DEFAULT 0,

  -- Métadonnées affichage public
  display_name TEXT,                    -- "Diara CAMARA" pour affichage banner
  message_public TEXT,                  -- "Invité par votre relation HSBC Privée"

  -- Activation
  is_active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,               -- NULL = pas d'expiration

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT referral_codes_uses_check CHECK (current_uses <= max_uses)
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_active
  ON public.eurealimmo_referral_codes (code)
  WHERE is_active = true;

ALTER TABLE public.eurealimmo_referral_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_referral_codes" ON public.eurealimmo_referral_codes;
CREATE POLICY "service_role_full_referral_codes"
  ON public.eurealimmo_referral_codes FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Lecture publique des codes actifs (pour afficher le banner référent +
-- le compteur 'X places restantes') — mais seulement les champs publics
-- via une vue limitée (pas current_uses précis pour éviter les leaks)
CREATE OR REPLACE VIEW public.v_eurealimmo_referral_codes_public AS
SELECT
  code,
  owner_name AS referrer_name,
  display_name,
  message_public,
  tier,
  (max_uses - current_uses) AS places_remaining,
  max_uses,
  is_active,
  expires_at
FROM public.eurealimmo_referral_codes
WHERE is_active = true
  AND (expires_at IS NULL OR expires_at > now())
  AND current_uses < max_uses;

GRANT SELECT ON public.v_eurealimmo_referral_codes_public TO anon, authenticated;

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_touch_referral_codes ON public.eurealimmo_referral_codes;
CREATE TRIGGER trg_touch_referral_codes BEFORE UPDATE ON public.eurealimmo_referral_codes
  FOR EACH ROW EXECUTE FUNCTION public.touch_eurealimmo_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- Seed initial — codes Diara + Samuel (générique fondateur)
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.eurealimmo_referral_codes
  (code, owner_name, owner_email, display_name, message_public, tier, max_uses)
VALUES
  ('DIARA', 'Diara CAMARA', 'diara.camara@example.com',
   'Diara CAMARA',
   'Invité par Diara CAMARA, partenaire fondatrice Eurealimmo — offre exclusive cercle restreint.',
   'founder', 5),
  ('SAMUEL', 'Samuel BRUNO', 'contact@datamerry.com',
   'Samuel BRUNO',
   'Invité par Samuel BRUNO, fondateur Eurealimmo.',
   'founder', 10),
  ('FONDATEUR2026', 'Eurealimmo', 'contact@datamerry.com',
   'Eurealimmo Réseau',
   'Programme Fondateur 2026 — 40 places exclusives.',
   'founder', 40)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fonction utilitaire : valider un code et incrémenter le compteur
-- (à utiliser lors de l'acceptation effective, pas à la soumission)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.consume_referral_code(p_code TEXT)
RETURNS TABLE (
  ok BOOLEAN,
  reason TEXT,
  tier TEXT,
  remaining INTEGER
)
LANGUAGE plpgsql
AS $func$
DECLARE
  v_row RECORD;
BEGIN
  SELECT * INTO v_row
  FROM public.eurealimmo_referral_codes
  WHERE upper(code) = upper(p_code) AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'code_not_found'::TEXT, NULL::TEXT, NULL::INTEGER;
    RETURN;
  END IF;

  IF v_row.expires_at IS NOT NULL AND v_row.expires_at < now() THEN
    RETURN QUERY SELECT false, 'code_expired'::TEXT, v_row.tier, 0;
    RETURN;
  END IF;

  IF v_row.current_uses >= v_row.max_uses THEN
    RETURN QUERY SELECT false, 'code_exhausted'::TEXT, v_row.tier, 0;
    RETURN;
  END IF;

  UPDATE public.eurealimmo_referral_codes
  SET current_uses = current_uses + 1
  WHERE id = v_row.id;

  RETURN QUERY SELECT
    true,
    'consumed'::TEXT,
    v_row.tier,
    (v_row.max_uses - v_row.current_uses - 1);
END;
$func$;

COMMENT ON FUNCTION public.consume_referral_code IS
  'Consomme une utilisation d''un code referral. À appeler à l''acceptation effective de la candidature (pas à la soumission, pour éviter spam).';

-- Vérification
SELECT
  (SELECT COUNT(*) FROM public.eurealimmo_referral_codes) AS codes_seeded,
  (SELECT COUNT(*) FROM information_schema.views
   WHERE table_schema = 'public' AND table_name = 'v_eurealimmo_referral_codes_public') AS public_view_ok;
