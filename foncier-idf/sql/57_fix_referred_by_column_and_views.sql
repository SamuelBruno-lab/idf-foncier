-- ============================================================
-- Migration 57 — Fix colonne referred_by + recrée les vues
-- ============================================================
-- La migration SQL 50 a échoué silencieusement parce qu'elle
-- référence eurealimmo_mandataires.referred_by_mandataire_id
-- qui n'existait pas dans le schéma réel.
--
-- Conséquence : v_mandataire_stats et v_mandataire_commissions
-- n'ont pas été créées → dashboard mandataire renvoyait 404.
--
-- Ce patch :
--   1. Ajoute la colonne referred_by_mandataire_id (si absente)
--   2. Recrée les 2 vues (en redo SQL 50)
-- ============================================================

BEGIN;

-- ============================================================
-- 1. Ajoute la colonne (idempotent)
-- ============================================================
ALTER TABLE public.eurealimmo_mandataires
  ADD COLUMN IF NOT EXISTS referred_by_mandataire_id UUID;

CREATE INDEX IF NOT EXISTS eurealimmo_mandataires_referred_by_idx
  ON public.eurealimmo_mandataires (referred_by_mandataire_id)
  WHERE referred_by_mandataire_id IS NOT NULL;

COMMENT ON COLUMN public.eurealimmo_mandataires.referred_by_mandataire_id IS
  'FK vers le mandataire qui a apporté ce mandataire via referral (NULL si pas de parrain).';

-- ============================================================
-- 2. Recrée v_mandataire_stats (DROP + CREATE pour éviter conflits)
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
    count(*) FILTER (WHERE f.referred_by_mandataire_id = m.id
                       AND COALESCE(f.is_active, true) = true
                       AND COALESCE(f.is_blocked, false) = false) AS nb_filleuls_actifs
  FROM public.eurealimmo_mandataires f
) f ON true;

COMMENT ON VIEW public.v_mandataire_stats IS
  'Statistiques agrégées par mandataire (corrigée v57).';

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

COMMENT ON VIEW public.v_mandataire_commissions IS
  'Vue commissions par mandataire (corrigée v57).';

-- ============================================================
-- 4. Vérif rétroactive
-- ============================================================
SELECT 'v_mandataire_stats' AS view_name,
       (SELECT count(*) FROM public.v_mandataire_stats) AS row_count
UNION ALL
SELECT 'v_mandataire_commissions',
       (SELECT count(*) FROM public.v_mandataire_commissions);

COMMIT;
