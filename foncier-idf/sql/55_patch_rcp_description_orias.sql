-- ============================================================
-- Migration 55 — Patch description étape RCP (clause ORIAS)
-- ============================================================
-- Ajoute une mention "purement informative" sur les courtiers cités
-- pour éviter toute requalification en intermédiation d'assurance
-- non immatriculée ORIAS (Code des assurances art. L. 511-1).
--
-- Position ACPR : citer des courtiers à titre informationnel sans
-- démarche commerciale ni rémunération n'est pas de l'intermédiation.
-- ============================================================

BEGIN;

UPDATE public.eurealimmo_onboarding_steps
SET description = 'Responsabilité Civile Professionnelle agent commercial immobilier obligatoire (loi Hoguet art. 4). Comptez 150-200 €/an. Uploadez l''attestation dès souscription.

À titre purement informatif et sans démarche commerciale ni rémunération de notre part, des courtiers du marché professionnel à consulter : April, Hiscox, AXA Pro, Coover. Liste non exhaustive. La sélection du courtier et du contrat relève de votre seule décision.'
WHERE step_key IN ('rcp_souscription', 'rcp_agent_commercial', 'souscription_rcp')
   OR title ILIKE '%RCP%agent commercial%'
   OR title ILIKE '%Souscription RCP%';

-- Compteur de lignes touchées (à observer dans le retour de Studio)
SELECT step_key, title, LEFT(description, 100) AS description_extract
FROM public.eurealimmo_onboarding_steps
WHERE description ILIKE '%titre purement informatif%';

COMMIT;
