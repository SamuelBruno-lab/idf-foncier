-- ============================================================================
-- 37_mandate_signature_pipeline.sql
--
-- Pipeline signature électronique (eIDAS) + upload mandat papier signé.
--
-- 2 CHEMINS DE SIGNATURE :
--   A. Électronique (Yousign / DocuSign) — pour les vendeurs OK avec le digital
--      → DATAMERRY génère le PDF mandat depuis les champs CRM
--      → API Yousign crée une enveloppe, signataires reçoivent un email
--      → Webhook callback met à jour le mandat à la complétion
--      → mandat_signe_at = timestamp Yousign / DocuSign
--
--   B. Papier scanné (uploadé après signature physique) — pour les vendeurs âgés
--      → Agent uploade le PDF signé depuis le dashboard
--      → Le pdf-matcher (Node) extrait les champs et les compare avec la DB
--      → Si match : mandat_signe_at = date détectée dans le PDF
--      → Si mismatch : signature_mismatch_alerts JSONB + status = mismatch_pending_review
--
-- Conformité :
--   - eIDAS Règlement UE 910/2014 — signature électronique qualifiée
--   - Loi Hoguet n° 70-9 + décret 72-678 art. 73 — mentions obligatoires
--   - Format PDF/A pour archivage longue durée (Y2 avec smart contract)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enrichir dim_cabinet_leads avec colonnes signature + métier
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.dim_cabinet_leads
  -- Provider de signature
  ADD COLUMN IF NOT EXISTS signature_provider TEXT
    CHECK (signature_provider IN ('yousign', 'docusign', 'paper_upload', NULL)),
  -- Status du workflow signature
  ADD COLUMN IF NOT EXISTS signature_status TEXT
    CHECK (signature_status IN (
      'not_started',         -- Pas encore lancé
      'pdf_generated',       -- PDF mandat généré, prêt à envoyer
      'sent_for_signature',  -- Enveloppe Yousign/DocuSign envoyée
      'signed_electronic',   -- Tous signataires ont signé (chemin A)
      'uploaded_paper',      -- PDF papier uploadé par l'agent (chemin B)
      'matched_ok',          -- Le matcher a validé la cohérence
      'mismatch_pending_review', -- Mismatch détecté, agent doit valider
      'cancelled'            -- Annulé / révoqué
    ) OR signature_status IS NULL),
  -- ID externe (Yousign envelope_id, DocuSign envelope_id, etc.)
  ADD COLUMN IF NOT EXISTS signature_envelope_id TEXT,
  -- URL du PDF mandat (généré ou uploadé) stocké sur Supabase Storage
  ADD COLUMN IF NOT EXISTS signature_pdf_url TEXT,
  -- URL du PDF signé final (avec certificat eIDAS si chemin A)
  ADD COLUMN IF NOT EXISTS signed_pdf_url TEXT,
  -- Timestamp signature côté provider (≠ mandat_signe_at qui est la date "officielle")
  ADD COLUMN IF NOT EXISTS signed_at_provider TIMESTAMPTZ,
  -- Résultat du pdf-matcher : champ par champ {field, expected, found, match}
  ADD COLUMN IF NOT EXISTS signature_mismatch_alerts JSONB,
  -- Nb de tentatives de matching (incrémente à chaque upload retry)
  ADD COLUMN IF NOT EXISTS signature_match_attempts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.dim_cabinet_leads.signature_provider IS
  'Provider de signature : yousign (eIDAS FR), docusign (eIDAS UE), paper_upload (mandat papier signé scanné).';
COMMENT ON COLUMN public.dim_cabinet_leads.signature_status IS
  'Workflow signature : not_started → pdf_generated → sent_for_signature → signed_electronic / uploaded_paper → matched_ok / mismatch_pending_review.';
COMMENT ON COLUMN public.dim_cabinet_leads.signature_mismatch_alerts IS
  'JSONB array : [{field, expected, found, severity:high|low, normalized_distance}]. Vide si match parfait.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Colonnes métier bonus pour le pdf-matcher (extraction depuis PDF signé)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.dim_cabinet_leads
  -- Désignation détaillée du bien (extrait du PDF mandat)
  ADD COLUMN IF NOT EXISTS bien_consistance TEXT,
  ADD COLUMN IF NOT EXISTS bien_references_cadastrales TEXT,
  ADD COLUMN IF NOT EXISTS bien_dpe_classe TEXT
    CHECK (bien_dpe_classe IN ('A', 'B', 'C', 'D', 'E', 'F', 'G') OR bien_dpe_classe IS NULL),
  ADD COLUMN IF NOT EXISTS bien_dpe_annee INTEGER
    CHECK (bien_dpe_annee IS NULL OR (bien_dpe_annee >= 2000 AND bien_dpe_annee <= 2050)),
  ADD COLUMN IF NOT EXISTS bien_lots_copropriete JSONB,
  -- Prix affiché public (= prix net + commission)
  ADD COLUMN IF NOT EXISTS mandat_prix_presentation_public NUMERIC(12, 0),
  -- Fourchette de négociation (en %)
  ADD COLUMN IF NOT EXISTS mandat_fourchette_negociation_pct NUMERIC(5, 2)
    CHECK (mandat_fourchette_negociation_pct IS NULL OR (mandat_fourchette_negociation_pct >= 0 AND mandat_fourchette_negociation_pct <= 30)),
  -- Identité complète du mandant (= vendeur/acquéreur selon mandat_type)
  ADD COLUMN IF NOT EXISTS mandant_nom_complet TEXT,
  ADD COLUMN IF NOT EXISTS mandant_adresse_complete TEXT,
  -- Lieu de signature
  ADD COLUMN IF NOT EXISTS mandat_lieu_signature TEXT;

COMMENT ON COLUMN public.dim_cabinet_leads.bien_lots_copropriete IS
  'JSONB array : [{lot_numero, tantiemes_generaux, tantiemes_charges, descriptif}]. Pour les biens en copropriété, requis par décret 72-678.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Index pour performance
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_cabinet_leads_signature_status
  ON public.dim_cabinet_leads (cabinet_slug, signature_status)
  WHERE signature_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cabinet_leads_envelope
  ON public.dim_cabinet_leads (signature_envelope_id)
  WHERE signature_envelope_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Vue v_signature_pending_review : mandats avec mismatch détecté
--    Pour le badge "⚠️ N mandats à revoir" dans le dashboard cabinet.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_signature_pending_review AS
SELECT
  l.id,
  l.cabinet_slug,
  l.visitor_name,
  l.address,
  l.mandat_numero_registre,
  l.signature_provider,
  l.signature_pdf_url,
  l.signed_pdf_url,
  l.signature_mismatch_alerts,
  l.signature_match_attempts,
  l.updated_at
FROM public.dim_cabinet_leads l
WHERE l.signature_status = 'mismatch_pending_review'
  AND l.signature_mismatch_alerts IS NOT NULL
ORDER BY l.updated_at DESC;

COMMENT ON VIEW public.v_signature_pending_review IS
  'Mandats avec mismatch détecté par le pdf-matcher — nécessitent une revue manuelle par l''agent du cabinet.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Vérification finale
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='dim_cabinet_leads'
     AND column_name IN ('signature_provider', 'signature_status',
                         'signature_envelope_id', 'signed_pdf_url',
                         'signature_mismatch_alerts',
                         'bien_consistance', 'bien_dpe_classe',
                         'mandat_prix_presentation_public',
                         'mandant_nom_complet')) AS new_columns_count,
  (SELECT COUNT(*) FROM information_schema.views
   WHERE table_schema='public' AND table_name='v_signature_pending_review') AS review_view_ok;
