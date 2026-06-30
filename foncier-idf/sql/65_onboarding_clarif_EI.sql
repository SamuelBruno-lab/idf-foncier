-- ============================================================
-- Migration 65 — Clarification étape onboarding "structure juridique"
-- ============================================================
-- Le texte mentionnait "Auto-entrepreneur ... EI réel ..." de manière
-- elliptique. On rend explicite que l'Entreprise Individuelle (EI) est
-- le statut juridique de référence, et auto-entrepreneur = EI au
-- régime micro.
-- ============================================================

BEGIN;

UPDATE public.eurealimmo_onboarding_steps
SET description = 'Entreprise Individuelle (EI) — au régime micro (= auto-entrepreneur, gratuit, recommandé pour démarrage) ou au régime réel ; sinon société SASU ou EURL. Renseignez votre SIREN une fois créé sur formalites.entreprises.gouv.fr (activité : agent commercial code APE 6831Z, régime micro-BNC ou réel).'
WHERE step_key = 'structure_juridique';

COMMIT;
