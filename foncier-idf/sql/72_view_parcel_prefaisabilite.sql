-- ============================================================
-- Migration 72 : vue v_parcel_prefaisabilite
-- Empilee sur v_parcel_sous_densite (elle-meme empilee sur v_parcel_foncier,
-- toutes deux INCHANGEES) -- meme discipline que la migration 70 : zero
-- impact sur les routes publiques existantes (/opportunities, /bbox,
-- /tiles/foncier/*), qui ne voient aucune difference.
--
-- Agrege, par parcelle, le comparatif existant vs PLU sur 3 axes :
--   - CES : v.coverage_ratio (existant) vs v.ces_applied (PLU) -- deja la
--   - Hauteur : bs.height_existing_m (existant, Phase 2a) vs v.max_height_est (PLU)
--   - Prospects : parcel_edge_classification (existant, par cote reel de
--     la parcelle) vs plu_zone_rules_reel_prospect (PLU, eventail par indice)
-- + deux booleens de gating haut niveau, reutilises tels quels par le
-- moteur de scenarios (Phase 2b, check_scenario_gating()).
-- ============================================================

CREATE OR REPLACE VIEW public.v_parcel_prefaisabilite AS
SELECT
  v.*,
  -- Hauteur existante (Phase 2a)
  bs.height_existing_m,
  bs.height_existing_source,
  -- Reculs existants reels, par cote classifie (facade/lateral/fond) --
  -- NULL si aucun bati sur la parcelle, ou si ce type de cote n'existe
  -- pas sur cette parcelle (ex: pas de 'fond' distinct si parcelle
  -- entierement enclavee, cf. limite documentee en migration 71)
  edges.setback_facade_existing_m,
  edges.setback_lateral_existing_m,
  edges.setback_fond_existing_m,
  edges.nb_facades,
  -- Reculs PLU (eventail, jamais une valeur unique -- cf. migration 71) :
  -- worst_case = le plus restrictif (MAX des minimums exiges par indice),
  -- a utiliser par le gating tant que l'indice exact de la parcelle n'est
  -- pas connu.
  prospect.setback_side_min_m_worst_case,
  prospect.setback_side_min_m_range_low,
  prospect.setback_side_max_m_range_high,
  prospect.setback_rear_min_m_worst_case,
  prospect.setback_rear_min_m_range_low,
  prospect.setback_rear_max_m_range_high,
  COALESCE(prospect.setback_plu_is_range, true) AS setback_plu_is_range,
  -- Gating haut niveau, reutilisable par check_scenario_gating() (Phase 2b)
  (bs.height_existing_m IS NOT NULL AND v.max_height_est IS NOT NULL
     AND bs.height_existing_m < v.max_height_est) AS surelevation_possible_hauteur,
  (v.coverage_ratio IS NOT NULL AND v.ces_applied IS NOT NULL
     AND v.coverage_ratio < v.ces_applied) AS extension_possible_ces
FROM public.v_parcel_sous_densite v
LEFT JOIN public.parcel_building_stats bs ON bs.parcel_id = v.parcel_id
LEFT JOIN LATERAL (
  SELECT
    MIN(pec.existing_setback_m) FILTER (WHERE pec.edge_type = 'facade') AS setback_facade_existing_m,
    MIN(pec.existing_setback_m) FILTER (WHERE pec.edge_type = 'lateral') AS setback_lateral_existing_m,
    MIN(pec.existing_setback_m) FILTER (WHERE pec.edge_type = 'fond') AS setback_fond_existing_m,
    COUNT(*) FILTER (WHERE pec.edge_type = 'facade') AS nb_facades
  FROM public.parcel_edge_classification pec
  WHERE pec.parcel_id = v.parcel_id
) edges ON true
LEFT JOIN LATERAL (
  SELECT
    MAX(r.setback_side_min_m) AS setback_side_min_m_worst_case,
    MIN(r.setback_side_min_m) AS setback_side_min_m_range_low,
    MAX(r.setback_side_max_m) AS setback_side_max_m_range_high,
    MAX(r.setback_rear_min_m) AS setback_rear_min_m_worst_case,
    MIN(r.setback_rear_min_m) AS setback_rear_min_m_range_low,
    MAX(r.setback_rear_max_m) AS setback_rear_max_m_range_high,
    bool_or(r.is_range) AS setback_plu_is_range
  FROM public.plu_zone_rules_reel_prospect r
  WHERE r.insee_code = v.insee_code AND r.zone_libelle = v.plu_zone_code
) prospect ON true;

-- ============================================================
-- Verification (a executer manuellement) :
--
--   SELECT parcel_id, insee_code, plu_zone_code,
--          coverage_ratio, ces_applied, extension_possible_ces,
--          height_existing_m, max_height_est, surelevation_possible_hauteur,
--          setback_facade_existing_m, setback_lateral_existing_m, setback_fond_existing_m,
--          setback_side_min_m_worst_case, setback_plu_is_range
--   FROM public.v_parcel_prefaisabilite
--   WHERE insee_code = '94081' LIMIT 20;
--
--   -- Aucune erreur SQL attendue meme si les colonnes remontent NULL
--   -- (tant que le re-pipeline height_m et l'import plu_zone_rules_reel_prospect
--   -- n'ont pas ete faits -- cf. sql/scripts/backfill_height_and_setbacks.sql).
-- ============================================================
