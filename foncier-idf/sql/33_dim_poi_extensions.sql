-- DATAMERRY — Fix contraintes dim_poi + extension types sportifs/événementiels
--
-- Deux bugs corrigés :
--
-- 1. Bug ON CONFLICT ON CONSTRAINT :
--    La migration 32 créait des UNIQUE INDEX partiels (CREATE UNIQUE INDEX ...
--    WHERE col IS NOT NULL). Or pipeline_poi.py utilise ON CONFLICT ON
--    CONSTRAINT uniq_poi_wikidata, qui exige une vraie CONSTRAINT (pas un
--    index). Résultat : 23000+ erreurs "constraint does not exist".
--
--    Fix : on remplace les UNIQUE INDEX par des CONSTRAINT UNIQUE.
--    PostgreSQL traite les NULL comme distincts par défaut, donc on peut
--    quand même avoir plusieurs rows avec wikidata_id=NULL (cas Mérimée only).
--
-- 2. CHECK constraint trop restrictif :
--    Le CHECK initial ne listait que 13 types. Or les stades / vélodromes /
--    hippodromes / arenas (Stade de France, Parc des Princes, Accor Arena,
--    Vélodrome Gerland, Longchamp, etc.) sont des POI majeurs qui impactent
--    fortement la valeur immobilière du quartier.
--
--    Fix : on étend le CHECK avec 5 nouveaux types : stade, arena,
--    velodrome, hippodrome, complexe_sportif.

BEGIN;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Remplacer les UNIQUE INDEX partiels par des UNIQUE CONSTRAINTS
-- ──────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS public.uniq_poi_wikidata;
DROP INDEX IF EXISTS public.uniq_poi_merimee;

-- Si jamais les CONSTRAINTS existent déjà (re-run), on les drop d'abord
ALTER TABLE public.dim_poi DROP CONSTRAINT IF EXISTS uniq_poi_wikidata;
ALTER TABLE public.dim_poi DROP CONSTRAINT IF EXISTS uniq_poi_merimee;

-- Création des vraies CONSTRAINTS (utilisables par ON CONFLICT ON CONSTRAINT)
-- Note : par défaut PostgreSQL traite les NULL comme distincts → plusieurs
-- rows avec wikidata_id=NULL restent autorisées (utile pour rows Mérimée only).
ALTER TABLE public.dim_poi
  ADD CONSTRAINT uniq_poi_wikidata UNIQUE (wikidata_id);

ALTER TABLE public.dim_poi
  ADD CONSTRAINT uniq_poi_merimee UNIQUE (merimee_id);

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Étendre le CHECK pour nouveaux types sportifs/événementiels
-- ──────────────────────────────────────────────────────────────────────────

ALTER TABLE public.dim_poi
  DROP CONSTRAINT IF EXISTS dim_poi_type_check;

ALTER TABLE public.dim_poi
  ADD CONSTRAINT dim_poi_type_check CHECK (type IN (
    'monument', 'musee', 'parc', 'eglise', 'chateau', 'site_archeologique',
    'pont', 'fontaine', 'place', 'theatre', 'opera', 'site_naturel',
    -- Nouveaux types (Stade de France, Parc des Princes, Accor Arena, etc.)
    'stade', 'arena', 'velodrome', 'hippodrome', 'complexe_sportif',
    'autre'
  ));

COMMIT;

-- ──────────────────────────────────────────────────────────────────────────
-- Vérification finale
-- ──────────────────────────────────────────────────────────────────────────

-- Liste les contraintes UNIQUE sur dim_poi (doit montrer uniq_poi_wikidata + uniq_poi_merimee)
SELECT
  conname AS constraint_name,
  contype AS type_code,  -- 'u' pour UNIQUE, 'c' pour CHECK
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.dim_poi'::regclass
  AND contype IN ('u', 'c')
ORDER BY contype, conname;

-- Compte de la table (sera 0 après TRUNCATE du prochain bootstrap)
SELECT COUNT(*) AS rows_before_bootstrap FROM public.dim_poi;
