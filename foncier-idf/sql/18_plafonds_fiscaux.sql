-- ============================================================
-- datamerry — Phase 2.6 : plafonds fiscaux LLI/Loc'Avantages/Denormandie
-- À exécuter dans Supabase SQL Editor
-- ============================================================
-- Sources :
--   - Zonage A/B/C : arrêté ministériel annuel (data.gouv.fr "Zonage A B C")
--   - Plafonds LLI : Article 2 terdecies D annexe III CGI (arrêté annuel BOI)
--   - Plafonds Loc'Avantages : arrêté annuel BOI
--   - Liste ACV : 234 villes Action Cœur de Ville (ANCT)
--   - Liste Denormandie : ~700 communes ACV + ORT
--
-- Pinel = mort au 31/12/2024, non géré.

-- ──────────────────────────────────────────────────────────────
-- Zonage A bis / A / B1 / B2 / C par commune
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dim_zonage_abc (
  code_insee  TEXT NOT NULL,
  zone        TEXT NOT NULL,          -- 'Abis' | 'A' | 'B1' | 'B2' | 'C'
  annee       SMALLINT NOT NULL,
  PRIMARY KEY (code_insee, annee)
);

CREATE INDEX IF NOT EXISTS idx_zonage_zone ON dim_zonage_abc (zone);

ALTER TABLE dim_zonage_abc ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read dim_zonage_abc"
  ON dim_zonage_abc FOR SELECT USING (true);

-- ──────────────────────────────────────────────────────────────
-- Plafonds de loyer par dispositif × zone × année (€/m²/mois)
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dim_plafond_loyer (
  dispositif    TEXT NOT NULL,          -- 'lli' | 'loc_avantages_intermediaire'
                                        -- | 'loc_avantages_social' | 'loc_avantages_tres_social'
                                        -- | 'denormandie'
  zone          TEXT NOT NULL,          -- 'Abis' | 'A' | 'B1' | 'B2' | 'C'
  annee         SMALLINT NOT NULL,
  loyer_max_m2  NUMERIC NOT NULL,
  source_juridique TEXT,                -- réf au texte officiel
  PRIMARY KEY (dispositif, zone, annee)
);

ALTER TABLE dim_plafond_loyer ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read dim_plafond_loyer"
  ON dim_plafond_loyer FOR SELECT USING (true);

-- ──────────────────────────────────────────────────────────────
-- Éligibilité ACV / Denormandie / ORT par commune × année
-- ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dim_commune_eligibilite (
  code_insee   TEXT NOT NULL,
  programme    TEXT NOT NULL,           -- 'acv' | 'denormandie' | 'ort'
  annee        SMALLINT NOT NULL,
  PRIMARY KEY (code_insee, programme, annee)
);

CREATE INDEX IF NOT EXISTS idx_eligibilite_programme
  ON dim_commune_eligibilite (programme);

ALTER TABLE dim_commune_eligibilite ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read dim_commune_eligibilite"
  ON dim_commune_eligibilite FOR SELECT USING (true);

-- ──────────────────────────────────────────────────────────────
-- Seed : plafonds LLI 2025
-- Source : Article 2 terdecies D annexe III CGI, arrêté annuel
-- Note : montants 2024 réutilisés pour 2025 si non publiés, à actualiser
-- via pipeline_plafonds.py chaque janvier.
-- ──────────────────────────────────────────────────────────────
INSERT INTO dim_plafond_loyer (dispositif, zone, annee, loyer_max_m2, source_juridique) VALUES
  ('lli', 'Abis', 2025, 18.89, 'Art. 2 terdecies D annexe III CGI'),
  ('lli', 'A',    2025, 14.03, 'Art. 2 terdecies D annexe III CGI'),
  ('lli', 'B1',   2025, 11.31, 'Art. 2 terdecies D annexe III CGI'),
  ('lli', 'B2',   2025,  9.83, 'Art. 2 terdecies D annexe III CGI'),
  -- Zone C : non éligible LLI (omis)

  ('loc_avantages_intermediaire', 'Abis', 2025, 16.65, 'Arrêté Loc Avantages 2025 (BOI)'),
  ('loc_avantages_intermediaire', 'A',    2025, 12.45, 'Arrêté Loc Avantages 2025 (BOI)'),
  ('loc_avantages_intermediaire', 'B1',   2025, 10.02, 'Arrêté Loc Avantages 2025 (BOI)'),
  ('loc_avantages_intermediaire', 'B2',   2025,  8.73, 'Arrêté Loc Avantages 2025 (BOI)'),
  ('loc_avantages_intermediaire', 'C',    2025,  8.73, 'Arrêté Loc Avantages 2025 (BOI)'),

  ('loc_avantages_social', 'Abis', 2025, 12.95, 'Arrêté Loc Avantages 2025 (BOI)'),
  ('loc_avantages_social', 'A',    2025,  9.69, 'Arrêté Loc Avantages 2025 (BOI)'),
  ('loc_avantages_social', 'B1',   2025,  7.80, 'Arrêté Loc Avantages 2025 (BOI)'),
  ('loc_avantages_social', 'B2',   2025,  7.80, 'Arrêté Loc Avantages 2025 (BOI)'),
  ('loc_avantages_social', 'C',    2025,  7.80, 'Arrêté Loc Avantages 2025 (BOI)'),

  ('loc_avantages_tres_social', 'Abis', 2025,  9.85, 'Arrêté Loc Avantages 2025 (BOI)'),
  ('loc_avantages_tres_social', 'A',    2025,  7.37, 'Arrêté Loc Avantages 2025 (BOI)'),
  ('loc_avantages_tres_social', 'B1',   2025,  6.30, 'Arrêté Loc Avantages 2025 (BOI)'),
  ('loc_avantages_tres_social', 'B2',   2025,  6.30, 'Arrêté Loc Avantages 2025 (BOI)'),
  ('loc_avantages_tres_social', 'C',    2025,  6.30, 'Arrêté Loc Avantages 2025 (BOI)'),

  -- Denormandie réutilise les plafonds Pinel-historique
  ('denormandie', 'Abis', 2025, 18.89, 'Art. 199 novovicies CGI'),
  ('denormandie', 'A',    2025, 14.03, 'Art. 199 novovicies CGI'),
  ('denormandie', 'B1',   2025, 11.31, 'Art. 199 novovicies CGI'),
  ('denormandie', 'B2',   2025,  9.83, 'Art. 199 novovicies CGI')
ON CONFLICT (dispositif, zone, annee) DO NOTHING;

COMMENT ON TABLE dim_plafond_loyer IS
  'Plafonds de loyer par dispositif fiscal (LLI, Loc Avantages, Denormandie). Pinel = mort 31/12/2024, non listé.';
