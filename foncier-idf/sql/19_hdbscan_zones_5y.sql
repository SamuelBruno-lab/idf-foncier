-- ============================================================
-- datamerry — Phase 1b : table parallèle dvf_hdbscan_zones_5y
-- Micro-marchés fins basés sur 5 ans glissants (vs 1 an adaptive)
-- ============================================================

CREATE TABLE IF NOT EXISTS dvf_hdbscan_zones_5y (LIKE dvf_hdbscan_zones INCLUDING ALL);

ALTER TABLE dvf_hdbscan_zones_5y ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read dvf_hdbscan_zones_5y"
  ON dvf_hdbscan_zones_5y FOR SELECT USING (true);

COMMENT ON TABLE dvf_hdbscan_zones_5y IS
  'Variante 5-ans glissants du clustering HDBSCAN. Plus de zones et plus de transactions par zone (micro-marchés fins) au prix d''une fraîcheur moindre. Utilisé via /api/estimate?precision=deep.';
