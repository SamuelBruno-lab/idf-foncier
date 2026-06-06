-- ============================================================================
-- 48_mandataire_documents_bucket.sql
--
-- Bucket privé de stockage des justificatifs d'onboarding mandataire
-- (RCP, ALUR, CCI…) uploadés en PDF via
-- POST /api/mandataire/[id]/onboarding/upload.
--
-- Accès uniquement via service_role (côté serveur) ; les liens fournis aux
-- mandataires sont des URLs signées à durée limitée. Aucune policy publique.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('mandataire-documents', 'mandataire-documents', false)
ON CONFLICT (id) DO NOTHING;
