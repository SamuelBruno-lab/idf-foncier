-- ============================================================
-- Migration 46 — Audit k-anonymisation (CNIL WP216)
-- ============================================================
-- Engagement public DATAMERRY : aucune statistique de zone n'est
-- publiée si la zone contient moins de K transactions distinctes.
--
-- Niveaux de protection :
--   k = 5  -- minimum CNIL recommandé pour stats agrégées
--   k = 30 -- DATAMERRY pour estimations cluster (déjà appliqué
--            via CLUSTER_MIN_N dans /api/estimate)
--
-- Cette migration ajoute :
--   1. Function check_k_anonymity_for_cluster(cluster_id, k)
--      → renvoie TRUE si la zone passe k-anonymisation
--   2. View v_k_anonymity_violations
--      → liste les clusters qui ne respecteraient PAS k=5
--   3. Function k_anonymity_audit_report()
--      → rapport agrégé pour audit RGPD
-- ============================================================

BEGIN;

-- ============================================================
-- Function : check_k_anonymity_for_cluster
-- ============================================================
CREATE OR REPLACE FUNCTION public.check_k_anonymity_for_cluster(
  p_cluster_id INT,
  p_k INT DEFAULT 5
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    (SELECT "count" >= p_k
     FROM dvf_hdbscan_zones_5y
     WHERE cluster_id = p_cluster_id),
    FALSE
  );
$$;

COMMENT ON FUNCTION public.check_k_anonymity_for_cluster IS
  'Vérifie si un cluster respecte la k-anonymisation au seuil k (défaut 5). À appeler avant toute publication de stat agrégée.';


-- ============================================================
-- View : v_k_anonymity_status
-- Statut de tous les clusters par rapport au seuil k=5 et k=30
-- ============================================================
CREATE OR REPLACE VIEW public.v_k_anonymity_status AS
SELECT
  cluster_id,
  "count" AS nb_transactions,
  CASE
    WHEN "count" >= 30 THEN 'PUBLIC_OK_K30'
    WHEN "count" >= 5  THEN 'CNIL_OK_K5_MIN'
    ELSE 'BLOCKED_KANONYM'
  END AS protection_level,
  ("count" >= 5) AS passes_cnil_minimum,
  ("count" >= 30) AS passes_datamerry_standard
FROM public.dvf_hdbscan_zones_5y;

COMMENT ON VIEW public.v_k_anonymity_status IS
  'Statut k-anonymisation de chaque cluster HDBSCAN — visibilité ops + audit.';


-- ============================================================
-- View : v_k_anonymity_violations
-- Clusters qui ne respecteraient PAS k=5 (donc à masquer)
-- ============================================================
CREATE OR REPLACE VIEW public.v_k_anonymity_violations AS
SELECT
  cluster_id,
  "count" AS count_obs,
  'cluster_id = ' || cluster_id::text || ' a ' || "count"::text ||
  ' transactions (< 5) — protection k-anonymisation requise' AS detail
FROM public.dvf_hdbscan_zones_5y
WHERE "count" < 5
ORDER BY "count" DESC;

COMMENT ON VIEW public.v_k_anonymity_violations IS
  'Clusters NON conformes k=5 — ces zones doivent être masquées dans toute publication.';


-- ============================================================
-- Function : k_anonymity_audit_report
-- Rapport agrégé pour audit RGPD / CNIL
-- ============================================================
CREATE OR REPLACE FUNCTION public.k_anonymity_audit_report()
RETURNS TABLE (
  total_clusters INT,
  clusters_protected_k5 INT,
  clusters_protected_k30 INT,
  clusters_blocked_kanonym INT,
  protection_rate_k5_pct NUMERIC,
  protection_rate_k30_pct NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    count(*)::int AS total_clusters,
    count(*) FILTER (WHERE "count" >= 5)::int AS clusters_protected_k5,
    count(*) FILTER (WHERE "count" >= 30)::int AS clusters_protected_k30,
    count(*) FILTER (WHERE "count" < 5)::int AS clusters_blocked_kanonym,
    ROUND(
      100.0 * count(*) FILTER (WHERE "count" >= 5) / NULLIF(count(*), 0),
      2
    ) AS protection_rate_k5_pct,
    ROUND(
      100.0 * count(*) FILTER (WHERE "count" >= 30) / NULLIF(count(*), 0),
      2
    ) AS protection_rate_k30_pct
  FROM public.dvf_hdbscan_zones_5y;
$$;

COMMENT ON FUNCTION public.k_anonymity_audit_report IS
  'Rapport agrégé d''audit k-anonymisation pour CNIL/DPO/avocat.';

COMMIT;

-- ============================================================
-- Test :
--   SELECT * FROM public.k_anonymity_audit_report();
--   SELECT * FROM public.v_k_anonymity_violations LIMIT 20;
--   SELECT public.check_k_anonymity_for_cluster(42, 5);
-- ============================================================
