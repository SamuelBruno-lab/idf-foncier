-- ============================================================
-- Helper : récupère l'UUID de Diara + URLs prêtes à coller
-- ============================================================
-- Usage : copier-coller dans Supabase Studio → SQL Editor.
-- Lance la requête et tu obtiens directement les URLs cliquables
-- à transmettre à Diara par email/WhatsApp.
--
-- NOTES SCHÉMA :
--   - La colonne "tier" n'existe PAS dans eurealimmo_mandataires.
--     Elle est dérivée via la vue v_mandataire_onboarding_summary
--     depuis commission_eurealimmo_pct (5% = founder, 8% = standard).
--   - "onboarding_completed" n'existe pas non plus en colonne directe.
-- ============================================================

WITH d AS (
  SELECT
    id,
    first_name,
    last_name,
    email,
    specialty,
    commission_eurealimmo_pct,
    is_active,
    contract_signed_at,
    created_at,
    CASE
      WHEN commission_eurealimmo_pct = 5 THEN 'founder'
      WHEN commission_eurealimmo_pct = 8 THEN 'standard'
      WHEN commission_eurealimmo_pct IS NULL THEN 'pending'
      ELSE 'custom'
    END AS tier_derived
  FROM public.eurealimmo_mandataires
  WHERE lower(email) IN (
    lower('diara.camara@collabimo.com'),
    lower('diara.camara@eurealimmo.com'),
    lower('diara@collabimo.com')
  )
     OR (lower(first_name) = 'diara' AND lower(last_name) = 'camara')
  ORDER BY created_at ASC
  LIMIT 1
)
SELECT
  d.id::text                                            AS uuid_diara,
  d.first_name || ' ' || d.last_name                    AS nom_complet,
  d.email                                               AS email,
  d.tier_derived                                        AS tier,
  d.specialty                                           AS specialty,
  d.commission_eurealimmo_pct                           AS com_pct,
  d.is_active                                           AS is_active,
  d.contract_signed_at                                  AS contrat_signe_le,
  'https://app.eurealimmo.com/mandataire/' || d.id::text || '/workspace'              AS url_workspace,
  'https://app.eurealimmo.com/mandataire/' || d.id::text || '/onboarding'             AS url_onboarding,
  'https://app.eurealimmo.com/mandataire/' || d.id::text || '/workspace/leads'        AS url_leads,
  'https://app.eurealimmo.com/mandataire/' || d.id::text || '/workspace/commissions'  AS url_commissions,
  'https://app.eurealimmo.com/mandataire/' || d.id::text || '/workspace/registre'     AS url_registre
FROM d;

-- ============================================================
-- En cas d'absence (Diara n'est pas encore dans la table)
-- ============================================================
-- Si la requête ci-dessus ne renvoie 0 ligne, lance ceci pour
-- la créer (adapte l'email si nécessaire) :
--
-- INSERT INTO public.eurealimmo_mandataires
--   (first_name, last_name, username, permalink, email,
--    company_name, city_name, state_name,
--    commission_eurealimmo_pct, referral_pct, specialty,
--    is_active, is_featured, is_public_profile)
-- VALUES
--   ('Diara', 'CAMARA', 'diara-camara', 'diara-camara',
--    'diara.camara@collabimo.com',
--    'Collabimo', 'Paris', 'Île-de-France',
--    5, 18, 'hnwi',
--    true, true, true)
-- RETURNING id, first_name, last_name, email;
-- ============================================================
