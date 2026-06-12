-- ============================================================
-- Migration 50 — Workspace mandataire (vue de Diara et autres)
-- ============================================================
-- Lie les leads et les commissions aux mandataires, et fournit
-- des vues agrégées prêtes à consommer côté UI mandataire.
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Lier dim_cabinet_leads à un mandataire (qui gère le lead)
-- ============================================================
ALTER TABLE public.dim_cabinet_leads
  ADD COLUMN IF NOT EXISTS mandataire_id UUID;

CREATE INDEX IF NOT EXISTS dim_cabinet_leads_mandataire_idx
  ON public.dim_cabinet_leads (mandataire_id, status, created_at DESC);

COMMENT ON COLUMN public.dim_cabinet_leads.mandataire_id IS
  'FK soft vers eurealimmo_mandataires.id — le mandataire qui gère le lead. NULL si non attribué.';

-- ============================================================
-- 2. Vue : statistiques globales par mandataire (dashboard)
-- ============================================================
CREATE OR REPLACE VIEW public.v_mandataire_stats AS
SELECT
  m.id AS mandataire_id,
  m.first_name,
  m.last_name,
  m.email,
  m.commission_eurealimmo_pct,

  -- Leads
  COALESCE(l.total_leads, 0)        AS total_leads,
  COALESCE(l.leads_actifs, 0)       AS leads_actifs,
  COALESCE(l.leads_mandat_signe, 0) AS leads_mandat_signe,
  COALESCE(l.leads_vendus, 0)       AS leads_vendus,

  -- CA généré (commission Eurealimmo encaissée sur les ventes du mandataire)
  COALESCE(l.ca_eurealimmo_total, 0) AS ca_eurealimmo_total,

  -- Rétrocession mandataire (95 % par défaut)
  COALESCE(l.ca_eurealimmo_total * 0.95, 0) AS retrocession_estimee_total,

  -- Filleuls (referral)
  COALESCE(f.nb_filleuls_total, 0)     AS nb_filleuls_total,
  COALESCE(f.nb_filleuls_actifs, 0)    AS nb_filleuls_actifs

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
    count(*) FILTER (WHERE f.referred_by_mandataire_id = m.id AND f.is_active = true) AS nb_filleuls_actifs
  FROM public.eurealimmo_mandataires f
) f ON true;

COMMENT ON VIEW public.v_mandataire_stats IS
  'Statistiques agrégées par mandataire pour dashboard workspace.';

-- ============================================================
-- 3. Vue : commissions détaillées par mandataire
-- ============================================================
CREATE OR REPLACE VIEW public.v_mandataire_commissions AS
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
  -- CA Eurealimmo
  (l.vente_prix_final * l.mandat_commission_pct / 100) AS commission_eurealimmo_brute,
  -- Rétrocession mandataire (95 % standard)
  (l.vente_prix_final * l.mandat_commission_pct / 100) * 0.95 AS retrocession_mandataire,
  -- Statut commission
  CASE
    WHEN l.vente_date IS NULL THEN 'a_venir'
    WHEN l.vente_date IS NOT NULL THEN 'encaissee_attente_versement'
    ELSE 'inconnue'
  END AS statut_commission
FROM public.dim_cabinet_leads l
WHERE l.mandataire_id IS NOT NULL
  AND l.mandat_signe_at IS NOT NULL
ORDER BY l.vente_date DESC NULLS FIRST, l.mandat_signe_at DESC;

COMMENT ON VIEW public.v_mandataire_commissions IS
  'Vue détaillée des commissions par mandataire (à venir + encaissées).';

-- ============================================================
-- 4. Fonction RPC : auto-attribution lead au mandataire
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_lead_to_mandataire(
  p_lead_id UUID,
  p_mandataire_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
  UPDATE public.dim_cabinet_leads
  SET mandataire_id = p_mandataire_id,
      updated_at = now()
  WHERE id = p_lead_id
  RETURNING true;
$$;

COMMENT ON FUNCTION public.assign_lead_to_mandataire IS
  'Attribue un lead à un mandataire. À appeler depuis l''UI admin ou matching.';

COMMIT;
