-- ============================================================
-- Migration 61 — Virtual Staging Phase C (multi-photos + plan 2D)
-- ============================================================
-- Étend staging_jobs pour supporter :
--   - 1 ou 2 photos d'angles (cohérence stylistique)
--   - 1 plan 2D du bien (guide géométrique via ControlNet Canny)
-- ============================================================

BEGIN;

ALTER TABLE public.staging_jobs
  ADD COLUMN IF NOT EXISTS photo_2_path TEXT,
  ADD COLUMN IF NOT EXISTS plan_path TEXT,
  ADD COLUMN IF NOT EXISTS result_image_url_2 TEXT,
  ADD COLUMN IF NOT EXISTS seed_used INT;

COMMENT ON COLUMN public.staging_jobs.photo_2_path IS
  'Optionnel : 2e photo de la pièce (autre angle). NULL si single shot.';
COMMENT ON COLUMN public.staging_jobs.plan_path IS
  'Optionnel : plan 2D du bien (PNG après preprocessing PDF). Utilisé via ControlNet Canny.';
COMMENT ON COLUMN public.staging_jobs.result_image_url_2 IS
  'URL résultat staging photo 2.';
COMMENT ON COLUMN public.staging_jobs.seed_used IS
  'Seed Replicate utilisée (partagée entre photo 1 et 2 pour cohérence).';

COMMIT;
