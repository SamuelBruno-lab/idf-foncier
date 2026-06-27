-- ============================================================
-- Migration 60 — Bucket Supabase Storage pour Virtual Staging
-- ============================================================
-- Stocke les uploads originaux (photo de pièce vide) ET les
-- résultats générés (photo meublée par Replicate).
-- ============================================================

BEGIN;

-- Bucket privé (signature URL pour accès)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'staging-images',
  'staging-images',
  false,
  20 * 1024 * 1024,  -- 20 MB max
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Table de tracking des stagings (historique + quotas + audit)
CREATE TABLE IF NOT EXISTS public.staging_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Auth / origine
  cabinet_slug TEXT,  -- NULL si anonyme
  client_ip TEXT,
  user_agent TEXT,

  -- Inputs
  original_image_path TEXT NOT NULL,   -- chemin dans staging-images bucket
  room_type TEXT,                      -- salon / chambre / cuisine / sdb / bureau
  style TEXT,                          -- moderne / scandinave / luxe / industriel
  custom_prompt TEXT,                  -- prompt custom si saisi par utilisateur

  -- Replicate
  replicate_prediction_id TEXT,
  replicate_status TEXT,               -- starting / processing / succeeded / failed / canceled
  result_image_url TEXT,               -- URL Replicate (TTL 24h) ou bucket interne

  -- Coût
  cost_usd NUMERIC(6, 4),

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS staging_jobs_cabinet_idx
  ON public.staging_jobs (cabinet_slug, created_at DESC);

CREATE INDEX IF NOT EXISTS staging_jobs_status_idx
  ON public.staging_jobs (replicate_status, created_at DESC);

COMMENT ON TABLE public.staging_jobs IS
  'Historique des stagings Replicate — quotas, audit, debug.';

-- RLS : seul service_role accède
ALTER TABLE public.staging_jobs ENABLE ROW LEVEL SECURITY;

COMMIT;
