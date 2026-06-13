-- ============================================================
-- Migration 59 — Seed cabinet "collabimo" pour outil estimation
-- ============================================================
-- Active la page d'estimation accessible à
-- https://app.eurealimmo.com/cabinets/collabimo/estimer
-- + API correspondantes pour création de leads avec
-- cabinet_slug='collabimo' (propriété Collabimo).
-- ============================================================

BEGIN;

INSERT INTO public.dim_cabinets_white_label (
  slug,
  cabinet_name,
  primary_color,
  secondary_color,
  cta_contact_url,
  cta_contact_label,
  contact_email,
  contact_phone,
  legal_mention,
  active
)
VALUES (
  'collabimo',
  'Collabimo',
  '#0f7a4d',                                            -- vert Collabimo
  '#053824',                                            -- vert foncé
  'https://collabimo.com/contact',                      -- à ajuster selon la vraie URL Wix
  'Discuter avec Diara CAMARA',
  'diara.camara@collabimo.com',
  NULL,                                                 -- téléphone à ajouter si Diara veut
  'Estimation propulsée par DATAMERRY® · Collabimo, partenaire HNWI Eurealimmo Réseau (carte T CPI 7501 2024 000 219)',
  true
)
ON CONFLICT (slug) DO UPDATE SET
  cabinet_name = EXCLUDED.cabinet_name,
  primary_color = EXCLUDED.primary_color,
  secondary_color = EXCLUDED.secondary_color,
  cta_contact_url = EXCLUDED.cta_contact_url,
  cta_contact_label = EXCLUDED.cta_contact_label,
  contact_email = EXCLUDED.contact_email,
  legal_mention = EXCLUDED.legal_mention,
  active = true,
  updated_at = now();

-- Vérif
SELECT slug, cabinet_name, primary_color, contact_email, active
FROM public.dim_cabinets_white_label
WHERE slug = 'collabimo';

COMMIT;
