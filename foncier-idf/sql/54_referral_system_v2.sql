-- ============================================================
-- Migration 54 — Système parrainage v2
-- ============================================================
-- 1. Diara : max_uses=59 (60 places fondateur - elle-même)
-- 2. Samuel : reste à 59 (cap dur en aval)
-- 3. Crée DIARA-STD et SAMUEL-STD pour les standards
-- 4. Cap dur SQL : <= 60 mandataires fondateurs au total
-- 5. Trigger : auto-create code <PREFIX>-STD à chaque nouveau mandataire
--    → tous les mandataires peuvent recruter des standards
--    → mais seuls DIARA et SAMUEL ont un code founder
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Update codes existants Diara + Samuel
-- ============================================================

UPDATE public.eurealimmo_referral_codes
SET max_uses = 59,
    message_public = 'Invité par Diara CAMARA, Associée Fondatrice n°1 Eurealimmo — cercle restreint des 60 fondateurs.',
    updated_at = now()
WHERE code = 'DIARA';

UPDATE public.eurealimmo_referral_codes
SET max_uses = 59,
    message_public = 'Invité par Samuel BRUNO, co-fondateur Eurealimmo — cercle restreint des 60 fondateurs.',
    updated_at = now()
WHERE code = 'SAMUEL';

-- ============================================================
-- 2. Création codes STANDARD pour Diara + Samuel
-- ============================================================

INSERT INTO public.eurealimmo_referral_codes
  (code, owner_name, owner_email, display_name, message_public, tier, max_uses)
VALUES
  ('DIARA-STD', 'Diara CAMARA', 'diara.camara@collabimo.com',
   'Diara CAMARA',
   'Invité par Diara CAMARA — rejoignez le réseau Eurealimmo.',
   'standard', 9999),
  ('SAMUEL-STD', 'Samuel BRUNO', 'contact@datamerry.com',
   'Samuel BRUNO',
   'Invité par Samuel BRUNO — rejoignez le réseau Eurealimmo.',
   'standard', 9999)
ON CONFLICT (code) DO NOTHING;

-- ============================================================
-- 3. Cap dur SQL : 60 mandataires fondateurs maximum
-- ============================================================
-- commission_eurealimmo_pct = 5 identifie un fondateur (par convention)
-- Si quelqu'un essaie d'insérer le 61e fondateur, RAISE EXCEPTION.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_founder_cap()
RETURNS TRIGGER AS $$
DECLARE
  v_founder_count INT;
BEGIN
  -- Cas INSERT ou UPDATE qui passe quelqu'un en tier founder
  IF NEW.commission_eurealimmo_pct = 5 THEN
    SELECT COUNT(*)
      INTO v_founder_count
    FROM public.eurealimmo_mandataires
    WHERE commission_eurealimmo_pct = 5
      AND (TG_OP = 'INSERT' OR id != NEW.id)
      AND COALESCE(is_blocked, false) = false;

    IF v_founder_count >= 60 THEN
      RAISE EXCEPTION
        'founder_cap_reached: %/60 places fondateur déjà occupées, impossible d''ajouter ce mandataire au tier fondateur',
        v_founder_count
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_enforce_founder_cap ON public.eurealimmo_mandataires;
CREATE TRIGGER trg_enforce_founder_cap
  BEFORE INSERT OR UPDATE OF commission_eurealimmo_pct
  ON public.eurealimmo_mandataires
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_founder_cap();

COMMENT ON FUNCTION public.enforce_founder_cap IS
  'Cap dur 60 mandataires fondateurs (commission_eurealimmo_pct = 5).';

-- ============================================================
-- 4. Trigger : auto-create code STANDARD pour chaque nouveau mandataire
-- ============================================================
-- À chaque création (INSERT) de mandataire, on crée automatiquement son
-- code referral STANDARD basé sur son prénom (ou son ID si conflit).
-- → tous les mandataires peuvent recruter des standards
-- → seul Diara et Samuel ont un code founder (création manuelle)
-- ============================================================

CREATE OR REPLACE FUNCTION public.auto_create_standard_referral()
RETURNS TRIGGER AS $$
DECLARE
  v_base_code TEXT;
  v_final_code TEXT;
  v_attempt INT := 0;
BEGIN
  -- Construit le code de base : prénom upper sans accents/espaces + "-STD"
  v_base_code := upper(
    regexp_replace(
      translate(coalesce(NEW.first_name, 'MANDATAIRE'),
                'àáâãäåèéêëìíîïòóôõöùúûüýÿñçÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÝŸÑÇ',
                'aaaaaaeeeeiiiiooooouuuuyycAAAAAAEEEEIIIIOOOOOUUUUYYNC'),
      '[^A-Za-z0-9]', '', 'g'
    )
  ) || '-STD';

  -- Trouve un code unique (ajoute un suffixe numérique si conflit)
  v_final_code := v_base_code;
  WHILE EXISTS (SELECT 1 FROM public.eurealimmo_referral_codes WHERE code = v_final_code) LOOP
    v_attempt := v_attempt + 1;
    v_final_code := v_base_code || v_attempt::TEXT;
    EXIT WHEN v_attempt > 99;  -- safety
  END LOOP;

  -- Insère le code referral standard
  INSERT INTO public.eurealimmo_referral_codes
    (code, owner_name, owner_email, display_name, message_public, tier, max_uses)
  VALUES (
    v_final_code,
    NEW.first_name || ' ' || NEW.last_name,
    NEW.email,
    NEW.first_name || ' ' || NEW.last_name,
    'Invité par ' || NEW.first_name || ' ' || NEW.last_name || ' — rejoignez le réseau Eurealimmo.',
    'standard',
    9999
  )
  ON CONFLICT (code) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_create_standard_referral ON public.eurealimmo_mandataires;
CREATE TRIGGER trg_auto_create_standard_referral
  AFTER INSERT ON public.eurealimmo_mandataires
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_create_standard_referral();

COMMENT ON FUNCTION public.auto_create_standard_referral IS
  'Crée automatiquement un code referral STANDARD <PRENOM>-STD à chaque nouveau mandataire.';

-- ============================================================
-- 5. Vue : codes referral par owner (pour UI)
-- ============================================================

CREATE OR REPLACE VIEW public.v_referral_codes_by_owner AS
SELECT
  rc.code,
  rc.owner_email,
  rc.owner_name,
  rc.display_name,
  rc.tier,
  rc.max_uses,
  rc.current_uses,
  GREATEST(0, rc.max_uses - rc.current_uses) AS places_remaining,
  rc.is_active,
  rc.expires_at,
  rc.message_public,
  rc.created_at,
  -- Compteur global fondateurs (pour afficher "X/60 dans le réseau")
  (SELECT COUNT(*) FROM public.eurealimmo_mandataires
   WHERE commission_eurealimmo_pct = 5
     AND COALESCE(is_blocked, false) = false) AS network_founder_count,
  60 AS network_founder_cap
FROM public.eurealimmo_referral_codes rc
WHERE rc.is_active = true
  AND (rc.expires_at IS NULL OR rc.expires_at > now())
ORDER BY rc.tier DESC, rc.created_at ASC;

COMMENT ON VIEW public.v_referral_codes_by_owner IS
  'Codes referral actifs, joints avec le compteur global fondateurs réseau.';

COMMIT;
