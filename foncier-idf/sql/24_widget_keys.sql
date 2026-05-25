-- DATAMERRY — Clés widget (sous-type de dim_api_keys)
--
-- Pourquoi un nouveau type :
--   Le widget JS tourne dans le NAVIGATEUR du visiteur du site cabinet.
--   La clé est donc visible en clair dans le HTML/JS. Il faut une protection
--   différente d'une clé serveur (dmk_live_) :
--     - Restriction par Referer/Origin → la clé ne marche que si l'appel
--       vient du domaine déclaré par le cabinet
--     - Rate-limit IP plus strict que la clé serveur
--     - Quota séparé (ex: 5 000 vues widget /mois inclus)
--
-- Format de clé widget : wdmk_live_<32 base32>  (préfixe différent de dmk_)

-- ============================================================================
-- 1. Étendre le CHECK plan + colonnes referrer
-- ============================================================================
ALTER TABLE public.dim_api_keys DROP CONSTRAINT IF EXISTS dim_api_keys_plan_check;
ALTER TABLE public.dim_api_keys
  ADD CONSTRAINT dim_api_keys_plan_check
  CHECK (plan IN ('pilot', 'pro', 'enterprise', 'internal', 'widget'));

-- Liste des domaines autorisés (lowercase, sans schéma).
-- Ex: ['collabimmo.fr', 'www.collabimmo.fr', 'app.collabimmo.fr']
-- NULL = pas de restriction (clés serveur classiques)
ALTER TABLE public.dim_api_keys
  ADD COLUMN IF NOT EXISTS allowed_referrers TEXT[];

-- Compteur de vues widget — utile pour analytics indépendamment de api_usage_log
ALTER TABLE public.dim_api_keys
  ADD COLUMN IF NOT EXISTS widget_views_count BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_dim_api_keys_referrers
  ON public.dim_api_keys USING GIN (allowed_referrers)
  WHERE allowed_referrers IS NOT NULL;

COMMENT ON COLUMN public.dim_api_keys.allowed_referrers IS
  'Liste de domaines autorisés à utiliser cette clé (clés widget uniquement). Match exact lowercase.';

-- ============================================================================
-- 2. Helper : vérifier qu'un domaine est autorisé pour une clé
-- ============================================================================
CREATE OR REPLACE FUNCTION public.is_referrer_allowed(
  p_key_hash TEXT,
  p_domain TEXT
) RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT
    CASE
      -- Clé inconnue → refus
      WHEN NOT EXISTS (
        SELECT 1 FROM public.dim_api_keys WHERE key_hash = p_key_hash
      ) THEN false

      -- Pas de restriction → autorisé
      WHEN (
        SELECT allowed_referrers FROM public.dim_api_keys WHERE key_hash = p_key_hash
      ) IS NULL THEN true

      -- Match exact lowercase
      ELSE LOWER(p_domain) = ANY (
        SELECT LOWER(unnest(allowed_referrers))
        FROM public.dim_api_keys
        WHERE key_hash = p_key_hash
      )
    END
$$;
