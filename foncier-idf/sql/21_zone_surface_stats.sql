-- ============================================================
-- datamerry — Phase 8 : stats de surface par zone HDBSCAN
-- ============================================================
-- Permet au LLM/front de nuancer une estimation :
--   "Pour 250m² (vs médiane 100m² du quartier), prévoir une décote
--    car les grandes surfaces se vendent moins cher au m²."

ALTER TABLE dvf_hdbscan_zones
  ADD COLUMN IF NOT EXISTS surface_median INTEGER,
  ADD COLUMN IF NOT EXISTS surface_p25    INTEGER,
  ADD COLUMN IF NOT EXISTS surface_p75    INTEGER,
  ADD COLUMN IF NOT EXISTS surface_n      INTEGER;

ALTER TABLE dvf_hdbscan_zones_5y
  ADD COLUMN IF NOT EXISTS surface_median INTEGER,
  ADD COLUMN IF NOT EXISTS surface_p25    INTEGER,
  ADD COLUMN IF NOT EXISTS surface_p75    INTEGER,
  ADD COLUMN IF NOT EXISTS surface_n      INTEGER;

COMMENT ON COLUMN dvf_hdbscan_zones.surface_median IS
  'Médiane des surfaces (m²) des transactions du cluster. Permet de détecter quand surface demandée >> médiane → appliquer décote prix/m².';
