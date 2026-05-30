-- ============================================================================
-- 36_mandate_workflow_and_anchor.sql
--
-- DATAMERRY × Eurealimmo Réseau — Pipeline CRM/ERP complet + ancrage blockchain
--
-- Phase 1 (immédiate) :
--   - Enrichir dim_cabinet_leads avec les colonnes mandat (loi Hoguet)
--   - Couvrir les 3 types : vente / recherche / location
--   - Tracer visite planifiée + visite réalisée
--   - Tracer la vente finale (prix réel, date)
--
-- Phase 2 (immédiate aussi) :
--   - Table dim_mandate_anchor : empreinte SHA256 du mandat
--   - Status workflow : pending → batched → anchored
--   - Champ solana_tx_sig pour Y2 (smart contract Anchor Rust)
--   - Vue v_mandates_to_anchor pour le cron mensuel
--
-- Phase 3 (Y2, hors scope SQL) :
--   - Smart contract Solana publie le Merkle Root mensuel
--   - Cron Resend récupère le tx_sig et met à jour anchor_status='anchored'
--
-- Conformité :
--   - Loi Hoguet n° 70-9 (registre des mandats obligatoire pour titulaire carte T)
--   - Décret 72-678 art. 73 (mentions obligatoires du mandat)
--   - CNIL délibération 2018-303 (blockchain et RGPD : on n'inscrit QUE le hash
--     SHA256 du JSON canonique du mandat, jamais les données personnelles)
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enrichir dim_cabinet_leads avec les colonnes mandat
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.dim_cabinet_leads
  ADD COLUMN IF NOT EXISTS mandat_type TEXT
    CHECK (mandat_type IN ('vente', 'recherche', 'location') OR mandat_type IS NULL),
  ADD COLUMN IF NOT EXISTS mandat_modalite TEXT
    CHECK (mandat_modalite IN ('simple', 'exclusif', 'semi_exclusif') OR mandat_modalite IS NULL),
  ADD COLUMN IF NOT EXISTS mandat_signe_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS mandat_duree_mois INTEGER
    CHECK (mandat_duree_mois IS NULL OR (mandat_duree_mois >= 1 AND mandat_duree_mois <= 36)),
  ADD COLUMN IF NOT EXISTS mandat_date_fin DATE,
  -- Commission négociée (% TTC, généralement 3-7 % pour vente, 1-3 % pour recherche)
  ADD COLUMN IF NOT EXISTS mandat_commission_pct NUMERIC(5, 2)
    CHECK (mandat_commission_pct IS NULL OR (mandat_commission_pct >= 0 AND mandat_commission_pct <= 20)),
  -- Pour vente : prix net vendeur (= prix bien - com). Pour recherche : budget max.
  ADD COLUMN IF NOT EXISTS mandat_prix_net_vendeur NUMERIC(12, 0),
  ADD COLUMN IF NOT EXISTS mandat_prix_max NUMERIC(12, 0),
  -- Numéro de registre carte T (incrémental par cabinet, format AAAANNNN)
  ADD COLUMN IF NOT EXISTS mandat_numero_registre TEXT,
  -- Pour mandat recherche : critères structurés (zones, type, surface min/max…)
  ADD COLUMN IF NOT EXISTS mandat_criteres_recherche JSONB,
  -- Workflow visite (statut rdv_planifie + mandat_signe)
  ADD COLUMN IF NOT EXISTS visite_planifiee_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS visite_realisee_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS visite_notes TEXT,
  -- Workflow vente finale (statut vendu)
  ADD COLUMN IF NOT EXISTS vente_prix_final NUMERIC(12, 0),
  ADD COLUMN IF NOT EXISTS vente_date DATE,
  ADD COLUMN IF NOT EXISTS vente_compromis_date DATE,
  -- Notes libres de l'agent (suivi qualitatif)
  ADD COLUMN IF NOT EXISTS notes_agent TEXT;

COMMENT ON COLUMN public.dim_cabinet_leads.mandat_type IS
  'Type de mandat loi Hoguet : vente (proprio vend), recherche (acquéreur cherche), location.';
COMMENT ON COLUMN public.dim_cabinet_leads.mandat_modalite IS
  'Modalité (vente uniquement) : simple = non exclusif, exclusif = 1 seule agence, semi_exclusif = agence + vente directe.';
COMMENT ON COLUMN public.dim_cabinet_leads.mandat_numero_registre IS
  'Numéro de registre carte T au format AAAANNNN. Auto-généré à la signature (trigger).';

-- Index pour la vue registre + l'auto-incrément du numéro
CREATE INDEX IF NOT EXISTS idx_cabinet_leads_mandat_signe
  ON public.dim_cabinet_leads (cabinet_slug, mandat_signe_at DESC)
  WHERE mandat_signe_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cabinet_leads_numero_registre
  ON public.dim_cabinet_leads (cabinet_slug, mandat_numero_registre)
  WHERE mandat_numero_registre IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Trigger : auto-génération du numéro de registre à la signature
--    Format : AAAA + 4 chiffres séquentiels par cabinet
--    Ex : 20260001, 20260002, ...
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assign_mandat_numero_registre()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
DECLARE
  v_year INTEGER;
  v_next_seq INTEGER;
BEGIN
  -- Ne déclenche que sur la 1re mise en place de mandat_signe_at
  IF NEW.mandat_signe_at IS NOT NULL
     AND (OLD.mandat_signe_at IS NULL OR OLD.mandat_signe_at IS DISTINCT FROM NEW.mandat_signe_at)
     AND NEW.mandat_numero_registre IS NULL THEN
    v_year := EXTRACT(YEAR FROM NEW.mandat_signe_at);

    -- Cherche le dernier numéro de l'année courante pour ce cabinet
    SELECT COALESCE(
      MAX(CAST(SUBSTRING(mandat_numero_registre FROM 5 FOR 4) AS INTEGER)),
      0
    ) + 1
    INTO v_next_seq
    FROM public.dim_cabinet_leads
    WHERE cabinet_slug = NEW.cabinet_slug
      AND mandat_numero_registre LIKE v_year || '%';

    NEW.mandat_numero_registre := v_year || LPAD(v_next_seq::TEXT, 4, '0');
  END IF;

  -- Calcul automatique de mandat_date_fin si durée fournie
  IF NEW.mandat_signe_at IS NOT NULL
     AND NEW.mandat_duree_mois IS NOT NULL
     AND NEW.mandat_date_fin IS NULL THEN
    NEW.mandat_date_fin := (NEW.mandat_signe_at + (NEW.mandat_duree_mois || ' months')::INTERVAL)::DATE;
  END IF;

  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_assign_mandat_numero ON public.dim_cabinet_leads;
CREATE TRIGGER trg_assign_mandat_numero
  BEFORE INSERT OR UPDATE OF mandat_signe_at, mandat_duree_mois
  ON public.dim_cabinet_leads
  FOR EACH ROW EXECUTE FUNCTION public.assign_mandat_numero_registre();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Table dim_mandate_anchor — empreinte cryptographique pour blockchain
--
--    Une ligne par mandat signé. Le hash est calculé côté API (Node crypto)
--    sur le JSON canonique du mandat. Le cron mensuel batchera les hashes
--    pending dans un Merkle Tree puis publiera le Root sur Solana.
--
--    RGPD-safe : on ne stocke QUE le hash + métadonnées techniques.
--    Les données personnelles restent dans Postgres (effaçables sur demande,
--    article 17 RGPD). L'invariance de la blockchain ne porte que sur
--    l'empreinte, pas sur l'identité.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dim_mandate_anchor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.dim_cabinet_leads(id) ON DELETE CASCADE,
  cabinet_slug TEXT NOT NULL REFERENCES public.dim_cabinets_white_label(slug) ON DELETE CASCADE,

  -- ─── Empreinte cryptographique ────────────────────────────────────────────
  -- SHA256 (hex 64 chars) du JSON canonique du mandat. Le JSON contient :
  --   { lead_id, cabinet_slug, mandat_type, mandat_signe_at,
  --     mandat_numero_registre, mandat_duree_mois,
  --     mandat_prix_net_vendeur, mandat_commission_pct,
  --     address_norm, surface, type_bien, visitor_name_initials }
  -- Le visitor_name est anonymisé en initiales (DC pour Diara CAMARA) pour
  -- limiter l'exposition sur blockchain publique.
  mandate_hash_sha256 CHAR(64) NOT NULL,
  -- JSON canonique stocké pour reproductibilité du hash (audit interne)
  canonical_payload JSONB NOT NULL,

  -- ─── Workflow d'ancrage ───────────────────────────────────────────────────
  anchor_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (anchor_status IN ('pending', 'batched', 'anchored', 'failed', 'opted_out')),
  -- ID du batch Merkle Tree (généré par le cron mensuel)
  merkle_root_batch_id UUID,
  -- Position du hash dans le Merkle Tree (pour générer la proof d'inclusion)
  merkle_leaf_index INTEGER,
  -- Merkle proof JSON : array de hashes pour reconstituer le root
  merkle_proof JSONB,

  -- ─── Solana ───────────────────────────────────────────────────────────────
  -- Signature de la tx Solana qui a publié le Merkle Root parent (rempli Y2)
  solana_tx_sig TEXT,
  solana_slot BIGINT,
  solana_block_time TIMESTAMPTZ,
  solana_program_id TEXT,

  -- ─── Métadonnées ──────────────────────────────────────────────────────────
  -- Email de l'agent qui a déclenché l'ancrage
  triggered_by_email TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  anchored_at TIMESTAMPTZ,

  -- Contrainte : un lead = 1 entrée d'ancrage (re-anchor = retry, pas duplicate)
  CONSTRAINT uniq_mandate_anchor_lead UNIQUE (lead_id)
);

COMMENT ON TABLE public.dim_mandate_anchor IS
  'Empreinte SHA256 des mandats signés, prête pour ancrage Merkle Root sur Solana. Hash uniquement — données personnelles restent en DB pour RGPD art. 17.';

CREATE INDEX IF NOT EXISTS idx_mandate_anchor_cabinet
  ON public.dim_mandate_anchor (cabinet_slug, anchor_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mandate_anchor_pending
  ON public.dim_mandate_anchor (anchor_status, created_at)
  WHERE anchor_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_mandate_anchor_batch
  ON public.dim_mandate_anchor (merkle_root_batch_id)
  WHERE merkle_root_batch_id IS NOT NULL;

-- RLS : seul le service_role (côté API serveur) accède à cette table.
-- Les clients/agents passent par l'endpoint admin.
ALTER TABLE public.dim_mandate_anchor ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_mandate_anchor" ON public.dim_mandate_anchor;
CREATE POLICY "service_role_full_mandate_anchor"
  ON public.dim_mandate_anchor FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_mandate_anchor_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_touch_mandate_anchor_updated_at ON public.dim_mandate_anchor;
CREATE TRIGGER trg_touch_mandate_anchor_updated_at
  BEFORE UPDATE ON public.dim_mandate_anchor
  FOR EACH ROW EXECUTE FUNCTION public.touch_mandate_anchor_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Table dim_merkle_batch — un batch mensuel de mandats ancrés sur Solana
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dim_merkle_batch (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Période couverte par le batch (mensuelle : 2026-05-01 → 2026-05-31)
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  -- Nombre de hashes dans le Merkle Tree
  leaf_count INTEGER NOT NULL,
  -- Le Merkle Root (32 bytes hex) qui sera publié on-chain
  merkle_root_hex CHAR(64) NOT NULL,
  -- Status du batch : built → submitted → confirmed → failed
  batch_status TEXT NOT NULL DEFAULT 'built'
    CHECK (batch_status IN ('built', 'submitted', 'confirmed', 'failed')),
  -- Tx Solana qui a publié le root
  solana_tx_sig TEXT,
  solana_slot BIGINT,
  solana_block_time TIMESTAMPTZ,
  solana_program_id TEXT,
  -- Coût de l'ancrage (lamports puis SOL au moment de la confirmation)
  cost_lamports BIGINT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_merkle_batch_period
  ON public.dim_merkle_batch (period_start DESC);

ALTER TABLE public.dim_merkle_batch ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_merkle_batch" ON public.dim_merkle_batch;
CREATE POLICY "service_role_full_merkle_batch"
  ON public.dim_merkle_batch FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Vue v_mandates_to_anchor — pour le cron mensuel
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_mandates_to_anchor AS
SELECT
  a.id AS anchor_id,
  a.lead_id,
  a.cabinet_slug,
  a.mandate_hash_sha256,
  a.created_at AS hash_created_at,
  l.mandat_type,
  l.mandat_numero_registre,
  l.mandat_signe_at
FROM public.dim_mandate_anchor a
JOIN public.dim_cabinet_leads l ON l.id = a.lead_id
WHERE a.anchor_status = 'pending'
ORDER BY a.created_at ASC;

COMMENT ON VIEW public.v_mandates_to_anchor IS
  'Mandats signés en attente d''ancrage blockchain. Le cron mensuel construit le Merkle Tree à partir de cette liste.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Vue v_cabinet_registre_mandats_extended — registre + status blockchain
--    Remplace l'ancienne vue (migration 31) avec les nouvelles colonnes mandat.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_cabinet_registre_mandats_extended AS
SELECT
  l.id,
  l.cabinet_slug,
  c.cabinet_name,
  l.mandat_numero_registre,
  l.mandat_type,
  l.mandat_modalite,
  l.mandat_signe_at,
  l.mandat_duree_mois,
  l.mandat_date_fin,
  l.mandat_commission_pct,
  l.mandat_prix_net_vendeur,
  l.mandat_prix_max,
  l.visitor_name,
  l.visitor_email,
  l.address,
  l.type_bien,
  l.surface,
  l.prix_total_median AS estimation_datamerry,
  l.status,
  l.visite_planifiee_at,
  l.visite_realisee_at,
  l.vente_prix_final,
  l.vente_date,
  l.vente_compromis_date,
  -- Status blockchain
  a.anchor_status,
  a.mandate_hash_sha256,
  a.solana_tx_sig,
  a.anchored_at,
  l.created_at,
  l.updated_at
FROM public.dim_cabinet_leads l
JOIN public.dim_cabinets_white_label c ON c.slug = l.cabinet_slug
LEFT JOIN public.dim_mandate_anchor a ON a.lead_id = l.id
WHERE l.status IN ('mandat_signe', 'vendu', 'non_vendu')
ORDER BY l.mandat_signe_at DESC NULLS LAST;

COMMENT ON VIEW public.v_cabinet_registre_mandats_extended IS
  'Registre des mandats complet : champs mandat + status d''ancrage blockchain. Source pour la page /cabinets/{slug}/admin/registre.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Fonction utilitaire : déclencher l'ancrage d'un mandat (appelée par API)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.queue_mandate_anchor(
  p_lead_id UUID,
  p_mandate_hash CHAR(64),
  p_canonical_payload JSONB,
  p_triggered_by_email TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $func$
DECLARE
  v_cabinet_slug TEXT;
  v_mandat_signe_at TIMESTAMPTZ;
  v_anchor_id UUID;
BEGIN
  -- Vérifie que le lead existe et a un mandat signé
  SELECT cabinet_slug, mandat_signe_at
  INTO v_cabinet_slug, v_mandat_signe_at
  FROM public.dim_cabinet_leads
  WHERE id = p_lead_id;

  IF v_cabinet_slug IS NULL THEN
    RAISE EXCEPTION 'Lead % introuvable', p_lead_id;
  END IF;

  IF v_mandat_signe_at IS NULL THEN
    RAISE EXCEPTION 'Lead % n''a pas de mandat signé', p_lead_id;
  END IF;

  -- Upsert : si déjà queuée et failed, on retry. Si pending/batched/anchored, no-op.
  INSERT INTO public.dim_mandate_anchor (
    lead_id, cabinet_slug, mandate_hash_sha256, canonical_payload,
    anchor_status, triggered_by_email
  )
  VALUES (
    p_lead_id, v_cabinet_slug, p_mandate_hash, p_canonical_payload,
    'pending', p_triggered_by_email
  )
  ON CONFLICT (lead_id) DO UPDATE
    SET mandate_hash_sha256 = EXCLUDED.mandate_hash_sha256,
        canonical_payload = EXCLUDED.canonical_payload,
        anchor_status = CASE
          WHEN public.dim_mandate_anchor.anchor_status = 'failed' THEN 'pending'
          ELSE public.dim_mandate_anchor.anchor_status
        END,
        retry_count = public.dim_mandate_anchor.retry_count + CASE
          WHEN public.dim_mandate_anchor.anchor_status = 'failed' THEN 1
          ELSE 0
        END,
        error_message = NULL,
        triggered_by_email = COALESCE(EXCLUDED.triggered_by_email, public.dim_mandate_anchor.triggered_by_email)
    WHERE public.dim_mandate_anchor.anchor_status IN ('failed', 'pending')
  RETURNING id INTO v_anchor_id;

  RETURN v_anchor_id;
END;
$func$;

COMMENT ON FUNCTION public.queue_mandate_anchor IS
  'Place un mandat dans la file d''ancrage blockchain. Idempotent : second appel sur le même lead met à jour le hash si statut pending/failed. Aucun effet sur anchored.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Vérification finale
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema='public' AND table_name='dim_cabinet_leads'
     AND column_name IN ('mandat_type', 'mandat_signe_at', 'mandat_numero_registre',
                         'visite_planifiee_at', 'vente_prix_final')) AS new_columns_count,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_name='dim_mandate_anchor') AS anchor_table_ok,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_name='dim_merkle_batch') AS batch_table_ok,
  (SELECT COUNT(*) FROM information_schema.views
   WHERE table_schema='public' AND table_name='v_mandates_to_anchor') AS to_anchor_view_ok,
  (SELECT COUNT(*) FROM information_schema.views
   WHERE table_schema='public' AND table_name='v_cabinet_registre_mandats_extended') AS registre_view_ok;
