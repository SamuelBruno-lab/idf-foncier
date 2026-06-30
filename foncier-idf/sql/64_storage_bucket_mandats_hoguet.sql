-- ============================================================
-- Migration 64 — Bucket Supabase Storage "mandats-hoguet"
-- ============================================================
-- Bucket privé pour stocker les mandats Hoguet DOCX générés
-- (loi 70-9 + décret 72-678).
--
-- Accès via signed URL (1h de validité). Pas d'accès public.
-- Service_role uniquement (writes + reads via API server-side).
-- ============================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('mandats-hoguet', 'mandats-hoguet', false, 52428800)  -- 50 Mo max
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "service_role full access mandats hoguet" ON storage.objects;
CREATE POLICY "service_role full access mandats hoguet"
  ON storage.objects FOR ALL
  USING (bucket_id = 'mandats-hoguet' AND auth.role() = 'service_role')
  WITH CHECK (bucket_id = 'mandats-hoguet' AND auth.role() = 'service_role');

COMMIT;
