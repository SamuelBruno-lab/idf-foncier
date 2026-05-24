-- ============================================================
-- datamerry — Phase 1 : fenêtre adaptative, P10/P90, holding period, volatilité
-- À exécuter dans Supabase SQL Editor
-- ============================================================

ALTER TABLE dvf_hdbscan_zones
  ADD COLUMN IF NOT EXISTS prix_m2_p10                 INTEGER,
  ADD COLUMN IF NOT EXISTS prix_m2_p90                 INTEGER,
  ADD COLUMN IF NOT EXISTS window_annee_min            SMALLINT,
  ADD COLUMN IF NOT EXISTS window_annee_max            SMALLINT,
  ADD COLUMN IF NOT EXISTS duree_detention_median_mois INTEGER,
  ADD COLUMN IF NOT EXISTS n_reventes_observees        INTEGER,
  ADD COLUMN IF NOT EXISTS prix_m2_yoy_pct             REAL,
  ADD COLUMN IF NOT EXISTS prix_m2_volatility          REAL,
  ADD COLUMN IF NOT EXISTS prix_m2_history             JSONB;

COMMENT ON COLUMN dvf_hdbscan_zones.prix_m2_p10 IS 'Min réaliste = 10e percentile (hors outliers de saisie)';
COMMENT ON COLUMN dvf_hdbscan_zones.prix_m2_p90 IS 'Max réaliste = 90e percentile';
COMMENT ON COLUMN dvf_hdbscan_zones.window_annee_min IS 'Année min de la fenêtre adaptative choisie (≠ annee_min descriptif)';
COMMENT ON COLUMN dvf_hdbscan_zones.window_annee_max IS 'Année max de la fenêtre adaptative choisie';
COMMENT ON COLUMN dvf_hdbscan_zones.duree_detention_median_mois IS 'Médiane des durées entre mutations successives sur les parcelles du cluster (mois)';
COMMENT ON COLUMN dvf_hdbscan_zones.n_reventes_observees IS 'Nombre de couples de mutations observés (≥2 ventes même parcelle)';
COMMENT ON COLUMN dvf_hdbscan_zones.prix_m2_yoy_pct IS 'Évolution % moyenne année sur année de la médiane prix_m2 dans la fenêtre';
COMMENT ON COLUMN dvf_hdbscan_zones.prix_m2_volatility IS 'Coefficient de variation = stddev/mean des médianes annuelles';
COMMENT ON COLUMN dvf_hdbscan_zones.prix_m2_history IS '[{annee, median, n}] par année dans la fenêtre — pour mini-graph côté client';
