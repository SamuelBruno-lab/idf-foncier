-- ============================================================
-- Migration 58 — Reset complet du sous-système workspace mandataire
-- ============================================================
-- Diagnostic : SQL 50 dans une transaction → CREATE VIEW a planté
-- (colonne referred_by_mandataire_id absente) → ROLLBACK total →
-- aucune des structures de SQL 50 n'existe (mandataire_id sur
-- dim_cabinet_leads, vues, RPC).
--
-- Cette migration idempotente ajoute TOUT ce qui devait l'être,
-- sans plantage cette fois car les pré-requis sont vérifiés.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Colonnes manquantes
-- ============================================================

-- Sur dim_cabinet_leads
ALTER TABLE public.dim_cabinet_leads
  ADD COLUMN IF NOT EXISTS mandataire_id UUID;

CREATE INDEX IF NOT EXISTS dim_cabinet_leads_mandataire_idx
  ON public.dim_cabinet_leads (mandataire_id, status, created_at DESC);

COMMENT ON COLUMN public.dim_cabinet_leads.mandataire_id IS
  'FK soft vers eurealimmo_mandataires.id — le mandataire qui gère le lead.';

-- Sur eurealimmo_mandataires
ALTER TABLE public.eurealimmo_mandataires
  ADD COLUMN IF NOT EXISTS referred_by_mandataire_id UUID;

CREATE INDEX IF NOT EXISTS eurealimmo_mandataires_referred_by_idx
  ON public.eurealimmo_mandataires (referred_by_mandataire_id)
  WHERE referred_by_mandataire_id IS NOT NULL;

COMMENT ON COLUMN public.eurealimmo_mandataires.referred_by_mandataire_id IS
  'FK vers le mandataire parrain (NULL si pas de parrain).';

-- ============================================================
-- 2. Recrée v_mandataire_stats
-- ============================================================
DROP VIEW IF EXISTS public.v_mandataire_stats CASCADE;

CREATE VIEW public.v_mandataire_stats AS
SELECT
  m.id AS mandataire_id,
  m.first_name,
  m.last_name,
  m.email,
  m.commission_eurealimmo_pct,
  COALESCE(l.total_leads, 0)        AS total_leads,
  COALESCE(l.leads_actifs, 0)       AS leads_actifs,
  COALESCE(l.leads_mandat_signe, 0) AS leads_mandat_signe,
  COALESCE(l.leads_vendus, 0)       AS leads_vendus,
  COALESCE(l.ca_eurealimmo_total, 0) AS ca_eurealimmo_total,
  COALESCE(l.ca_eurealimmo_total * 0.95, 0) AS retrocession_estimee_total,
  COALESCE(f.nb_filleuls_total, 0)  AS nb_filleuls_total,
  COALESCE(f.nb_filleuls_actifs, 0) AS nb_filleuls_actifs
FROM public.eurealimmo_mandataires m
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE l.mandataire_id = m.id) AS total_leads,
    count(*) FILTER (WHERE l.mandataire_id = m.id
                       AND l.status IN ('new', 'contacted', 'visite_planifiee', 'rdv_planifie')) AS leads_actifs,
    count(*) FILTER (WHERE l.mandataire_id = m.id
                       AND l.mandat_signe_at IS NOT NULL) AS leads_mandat_signe,
    count(*) FILTER (WHERE l.mandataire_id = m.id
                       AND l.vente_date IS NOT NULL) AS leads_vendus,
    COALESCE(SUM(
      CASE
        WHEN l.mandataire_id = m.id AND l.vente_prix_final IS NOT NULL
        THEN l.vente_prix_final * COALESCE(l.mandat_commission_pct, 5) / 100
        ELSE 0
      END
    ), 0) AS ca_eurealimmo_total
  FROM public.dim_cabinet_leads l
) l ON true
LEFT JOIN LATERAL (
  SELECT
    count(*) FILTER (WHERE f.referred_by_mandataire_id = m.id) AS nb_filleuls_total,
    count(*) FILTER (WHERE f.referred_by_mandataire_id = m.id
                       AND COALESCE(f.is_active, true) = true
                       AND COALESCE(f.is_blocked, false) = false) AS nb_filleuls_actifs
  FROM public.eurealimmo_mandataires f
) f ON true;

-- ============================================================
-- 3. Recrée v_mandataire_commissions
-- ============================================================
DROP VIEW IF EXISTS public.v_mandataire_commissions CASCADE;

CREATE VIEW public.v_mandataire_commissions AS
SELECT
  l.id AS lead_id,
  l.mandataire_id,
  l.cabinet_slug,
  l.visitor_name AS client_nom,
  l.address AS bien_adresse,
  l.mandat_type,
  l.mandat_modalite,
  l.mandat_numero_registre,
  l.mandat_signe_at,
  l.vente_date,
  l.vente_compromis_date,
  l.vente_prix_final,
  l.mandat_commission_pct,
  (l.vente_prix_final * l.mandat_commission_pct / 100) AS commission_eurealimmo_brute,
  (l.vente_prix_final * l.mandat_commission_pct / 100) * 0.95 AS retrocession_mandataire,
  CASE
    WHEN l.vente_date IS NULL THEN 'a_venir'
    WHEN l.vente_date IS NOT NULL THEN 'encaissee_attente_versement'
    ELSE 'inconnue'
  END AS statut_commission
FROM public.dim_cabinet_leads l
WHERE l.mandataire_id IS NOT NULL
  AND l.mandat_signe_at IS NOT NULL
ORDER BY l.vente_date DESC NULLS FIRST, l.mandat_signe_at DESC;

-- ============================================================
-- 4. Recrée la fonction assign_lead_to_mandataire (avec gate signé)
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_lead_to_mandataire(
  p_lead_id UUID,
  p_mandataire_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_contract_signed_at TIMESTAMPTZ;
  v_is_active BOOLEAN;
  v_is_blocked BOOLEAN;
  v_first_name TEXT;
  v_last_name TEXT;
BEGIN
  SELECT contract_signed_at, is_active, is_blocked, first_name, last_name
    INTO v_contract_signed_at, v_is_active, v_is_blocked, v_first_name, v_last_name
  FROM public.eurealimmo_mandataires
  WHERE id = p_mandataire_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mandataire_not_found: %', p_mandataire_id USING ERRCODE = 'P0002';
  END IF;

  IF v_contract_signed_at IS NULL THEN
    RAISE EXCEPTION 'contract_not_signed: % % — contrat non signé (Hoguet/RSAC)',
      v_first_name, v_last_name USING ERRCODE = 'P0001';
  END IF;

  IF v_is_blocked = true THEN
    RAISE EXCEPTION 'mandataire_blocked: % %', v_first_name, v_last_name USING ERRCODE = 'P0001';
  END IF;

  IF v_is_active = false THEN
    RAISE EXCEPTION 'mandataire_inactive: % %', v_first_name, v_last_name USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.dim_cabinet_leads
  SET mandataire_id = p_mandataire_id,
      updated_at = now()
  WHERE id = p_lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_not_found: %', p_lead_id USING ERRCODE = 'P0002';
  END IF;

  RETURN true;
END;
$$;

-- ============================================================
-- 5. Vue mandataires éligibles
-- ============================================================
CREATE OR REPLACE VIEW public.v_mandataires_eligibles AS
SELECT
  id, first_name, last_name, email, specialty,
  city_name, state_name, commission_eurealimmo_pct, contract_signed_at,
  CASE
    WHEN commission_eurealimmo_pct = 5 THEN 'founder'
    WHEN commission_eurealimmo_pct = 8 THEN 'standard'
    WHEN commission_eurealimmo_pct IS NULL THEN 'pending'
    ELSE 'custom'
  END AS tier_derived
FROM public.eurealimmo_mandataires
WHERE contract_signed_at IS NOT NULL
  AND is_active = true
  AND COALESCE(is_blocked, false) = false
ORDER BY contract_signed_at ASC;

-- ============================================================
-- 6. Vérif rétroactive
-- ============================================================
SELECT 'v_mandataire_stats' AS object,
       (SELECT count(*) FROM public.v_mandataire_stats)::TEXT AS info
UNION ALL
SELECT 'v_mandataire_commissions',
       (SELECT count(*) FROM public.v_mandataire_commissions)::TEXT
UNION ALL
SELECT 'v_mandataires_eligibles',
       (SELECT count(*) FROM public.v_mandataires_eligibles)::TEXT
UNION ALL
SELECT 'dim_cabinet_leads.mandataire_id',
       CASE WHEN EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'dim_cabinet_leads' AND column_name = 'mandataire_id'
       ) THEN 'OK' ELSE 'MISSING' END;

COMMIT;
