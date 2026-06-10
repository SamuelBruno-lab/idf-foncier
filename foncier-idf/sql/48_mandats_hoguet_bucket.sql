-- ============================================================
-- Migration 48 — Bucket Storage privé pour les mandats Hoguet
-- ============================================================
-- Stocke les .docx générés par generate-mandat-hoguet().
-- Accès uniquement via signed URLs (expiration courte).
-- ============================================================

BEGIN;

-- Crée le bucket mandats-hoguet (privé)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'mandats-hoguet',
  'mandats-hoguet',
  false,           -- privé : pas d'URL publique, signed URLs uniquement
  10485760,        -- 10 MB max par fichier
  ARRAY[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = 10485760,
      allowed_mime_types = ARRAY[
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/pdf'
      ];

-- Permettre upload depuis le service role (les API routes l'utilisent)
-- RLS storage : par défaut bloqué côté client, ouvert côté service_role.
-- Pas de policy à ajouter pour le service_role.

-- Étend les valeurs autorisées de mandat_type pour inclure les nouvelles
ALTER TABLE public.dim_cabinet_leads
  DROP CONSTRAINT IF EXISTS dim_cabinet_leads_mandat_type_check;

ALTER TABLE public.dim_cabinet_leads
  ADD CONSTRAINT dim_cabinet_leads_mandat_type_check
  CHECK (
    mandat_type IS NULL OR mandat_type IN (
      'vente',
      'recherche',                -- compat ancien code
      'recherche_acquereur',      -- nouveau (recommandé)
      'location',                 -- compat ancien code
      'mise_en_location',         -- nouveau (recommandé)
      'recherche_bien_locatif'    -- nouveau
    )
  );

COMMIT;
