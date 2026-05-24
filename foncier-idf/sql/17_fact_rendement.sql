-- ============================================================
-- datamerry — Phase 2.5 : OLAP rendement (star schema)
-- À exécuter dans Supabase SQL Editor
-- ============================================================
-- Cross-source : OLAP (loyers réels, ~37 agglos) + Carte des loyers ANIL
-- (loyers d'annonce, France entière en fallback).

-- ──────────────────────────────────────────────────────────────
-- Table de faits : 1 ligne par (zone × type × bucket pièces)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fact_rendement (
  zone_id            TEXT NOT NULL,                              -- "{cluster_hdbscan.id}" OU "COMMUNE_{code_insee}"
  code_commune       TEXT NOT NULL,                              -- pour filtres rapides
  type_local         TEXT NOT NULL,                              -- 'Appartement' / 'Maison' / 'Local...'
  nb_pieces_bucket   TEXT NOT NULL DEFAULT 'all',                -- 'T1-T2' / 'T3+' / 'all'

  -- Mesure côté loyer (source : OLAP ou ANIL)
  loyer_source       TEXT NOT NULL,                              -- 'olap' | 'anil'
  loyer_quality      TEXT NOT NULL,                              -- 'high' (OLAP) | 'medium' (ANIL) | 'low'
  loyer_annee        SMALLINT NOT NULL,                          -- millésime de la source loyer
  loyer_m2_median    NUMERIC,                                    -- €/m²/mois
  loyer_n_obs        INTEGER,                                    -- nb d'observations pour cette mesure

  -- Mesure côté prix (snapshot dvf_hdbscan_zones au moment du calcul)
  prix_m2_median     NUMERIC,                                    -- €/m² achat
  prix_window        TEXT,                                       -- "2024-2025" ou "2025" (fenêtre adaptative)

  -- Rendement
  rendement_brut     NUMERIC,                                    -- = loyer_m2 × 12 / prix_m2 × 100
  rendement_net_est  NUMERIC,                                    -- = brut × (1 - vacance% - charges% - TF%)

  computed_at        TIMESTAMPTZ DEFAULT NOW(),

  PRIMARY KEY (zone_id, type_local, nb_pieces_bucket)
);

CREATE INDEX IF NOT EXISTS idx_fact_rendement_commune
  ON fact_rendement (code_commune, type_local);

CREATE INDEX IF NOT EXISTS idx_fact_rendement_zone
  ON fact_rendement (zone_id);

ALTER TABLE fact_rendement ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read fact_rendement"
  ON fact_rendement FOR SELECT USING (true);

COMMENT ON TABLE fact_rendement IS
  'Rendement locatif par zone (HDBSCAN ou commune). Hybride OLAP (haute qualité, ~37 agglos) + ANIL Carte des loyers (asking prices, France entière).';

-- ──────────────────────────────────────────────────────────────
-- Hypothèses du calcul rendement net (modifiable par l'admin)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dim_rendement_hypotheses (
  type_local         TEXT PRIMARY KEY,
  vacance_pct        NUMERIC NOT NULL DEFAULT 5,                 -- 5% par défaut
  charges_pct        NUMERIC NOT NULL DEFAULT 15,                -- 15% par défaut
  taxe_fonciere_pct  NUMERIC NOT NULL DEFAULT 8,                 -- 8% par défaut
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO dim_rendement_hypotheses (type_local)
VALUES
  ('Appartement'),
  ('Maison'),
  ('Local industriel. commercial ou assimilé')
ON CONFLICT (type_local) DO NOTHING;

ALTER TABLE dim_rendement_hypotheses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read dim_rendement_hypotheses"
  ON dim_rendement_hypotheses FOR SELECT USING (true);
