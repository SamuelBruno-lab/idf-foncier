-- Migration : ajout loyers OLAP sur dvf_clusters_commune
-- À exécuter dans Supabase SQL Editor avant de lancer 03_import_loyers.py

ALTER TABLE dvf_clusters_commune
  ADD COLUMN IF NOT EXISTS loyer_median_m2  NUMERIC,   -- €/m²/mois (source OLAP 2024)
  ADD COLUMN IF NOT EXISTS rendement_brut   NUMERIC;   -- % brut annuel = loyer_m2*12/prix_m2*100
