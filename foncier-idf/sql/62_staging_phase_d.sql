-- ============================================================
-- Migration 62 — Virtual Staging Phase D (dessin de zones + inpainting)
-- ============================================================
-- Stocke les zones rectangulaires dessinées par l'utilisateur
-- (cuisine, repas, salon, lecture) et le résultat final composé.
-- ============================================================

BEGIN;

ALTER TABLE public.staging_jobs
  ADD COLUMN IF NOT EXISTS zones_json JSONB,
  ADD COLUMN IF NOT EXISTS final_image_url TEXT;

COMMENT ON COLUMN public.staging_jobs.zones_json IS
  'Array of zones drawn by user: [{type, x_pct, y_pct, w_pct, h_pct, prompt}, ...]. Coords as % of image dims.';
COMMENT ON COLUMN public.staging_jobs.final_image_url IS
  'URL de l''image composée finale (Phase D multi-pass inpainting).';

COMMIT;
