-- ============================================================
-- Migration 53 — Ajoute contract_signed_at à la vue admin
-- ============================================================
-- Permet à l'UI admin onboarding d'afficher le bouton "Activer"
-- uniquement sur les mandataires dont le contrat n'est pas signé.
--
-- NOTE : CREATE OR REPLACE VIEW interdit de réordonner les colonnes
-- (erreur 42P16). On ajoute donc contract_signed_at À LA FIN.
-- ============================================================

BEGIN;

CREATE OR REPLACE VIEW public.v_eurealimmo_onboarding_summary AS
SELECT
  m.id AS mandataire_id,
  m.first_name,
  m.last_name,
  m.email,
  m.phone,
  m.specialty,
  CASE
    WHEN m.commission_eurealimmo_pct = 5 THEN 'founder'
    WHEN m.commission_eurealimmo_pct = 8 THEN 'standard'
    WHEN m.commission_eurealimmo_pct IS NULL THEN 'pending'
    ELSE 'custom'
  END AS tier,
  m.is_active,
  m.is_blocked,
  m.created_at AS mandataire_created_at,

  (SELECT COUNT(*) FROM public.eurealimmo_onboarding_steps WHERE is_required) AS total_required_steps,
  COUNT(p.id) FILTER (WHERE p.status = 'completed' AND s.is_required) AS completed_required_steps,
  COUNT(p.id) FILTER (WHERE p.status = 'in_progress') AS in_progress_steps,
  COUNT(p.id) FILTER (WHERE p.status = 'blocked') AS blocked_steps,

  ROUND(
    100.0 * COUNT(p.id) FILTER (WHERE p.status = 'completed' AND s.is_required)
      / NULLIF((SELECT COUNT(*) FROM public.eurealimmo_onboarding_steps WHERE is_required), 0),
    0
  ) AS pct_completion,

  MAX(p.updated_at) AS last_activity_at,
  EXTRACT(DAY FROM (now() - COALESCE(MAX(p.updated_at), m.created_at)))::INT AS days_since_last_activity,

  (
    SELECT bool_and(p2.status = 'completed')
    FROM public.eurealimmo_onboarding_progress p2
    JOIN public.eurealimmo_onboarding_steps s2 ON s2.id = p2.step_id
    WHERE p2.mandataire_id = m.id
      AND s2.is_required
      AND s2.step_order <= 9
  ) AS ready_for_first_mandate,

  -- ⬇ AJOUTÉ EN FIN pour respecter la contrainte CREATE OR REPLACE VIEW
  m.contract_signed_at

FROM public.eurealimmo_mandataires m
LEFT JOIN public.eurealimmo_onboarding_progress p ON p.mandataire_id = m.id
LEFT JOIN public.eurealimmo_onboarding_steps s ON s.id = p.step_id
GROUP BY m.id, m.first_name, m.last_name, m.email, m.phone, m.specialty,
         m.commission_eurealimmo_pct, m.is_active, m.is_blocked,
         m.created_at, m.contract_signed_at;

COMMIT;
