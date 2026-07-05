-- ============================================================
-- Migration 74 : fonction check_scenario_gating(parcel_id, scenario_type)
--
-- Wrapper de faisabilite reglementaire, appele a la volee par la route API
-- publique (/api/foncier/scenario-gating) avant de proposer un scenario a
-- l'utilisateur dans le simulateur (Phase 2c). Lit v_parcel_prefaisabilite
-- (migration 72) -- ne persiste rien lui-meme, c'est parcel_scenarios
-- (migration 73) qui fige un snapshot au moment de la sauvegarde.
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_scenario_gating(
  p_parcel_id TEXT,
  p_scenario_type TEXT
) RETURNS JSONB
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v RECORD;
  ok BOOLEAN := true;
  reasons JSONB := '{}'::jsonb;
BEGIN
  SELECT * INTO v FROM public.v_parcel_prefaisabilite WHERE parcel_id = p_parcel_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('gating_ok', false, 'reasons', jsonb_build_object('erreur', 'parcelle_non_scoree'));
  END IF;

  CASE p_scenario_type
    WHEN 'surelevation' THEN
      -- Impossible si la hauteur existante est deja au plafond PLU (ou si
      -- l'une des deux valeurs est inconnue -- gating conservateur : on ne
      -- propose pas un scenario qu'on ne peut pas verifier).
      ok := COALESCE(v.surelevation_possible_hauteur, false);
      reasons := jsonb_build_object(
        'hauteur_existante_m', v.height_existing_m,
        'hauteur_existante_source', v.height_existing_source,
        'hauteur_max_plu_m', v.max_height_est,
        'note', CASE WHEN v.height_existing_m IS NULL
          THEN 'hauteur existante inconnue (re-pipeline BD TOPO requis)'
          ELSE NULL END
      );

    WHEN 'construction_neuve_meme_parcelle' THEN
      -- Impossible si le CES existant a deja atteint le CES max PLU.
      ok := COALESCE(v.extension_possible_ces, false);
      reasons := jsonb_build_object(
        'ces_existant', v.coverage_ratio,
        'ces_max_plu', v.ces_applied,
        'ces_source', v.ces_source
      );

    WHEN 'demolition_reconstruction' THEN
      -- Quasi toujours faisable cote reglementaire (demolir puis
      -- reconstruire au plafond PLU est presque toujours autorise) -- la
      -- vraie contrainte est economique, portee par le bilan promoteur
      -- (Phase 2b, bilan-promoteur.ts), pas par ce gating.
      ok := true;
      reasons := jsonb_build_object(
        'note', 'faisabilite reglementaire quasi-systematique ; verdict reel porte par le bilan financier'
      );

    WHEN 'changement_usage' THEN
      ok := (v.destinations_autorisees IS NOT NULL AND array_length(v.destinations_autorisees, 1) > 0);
      reasons := jsonb_build_object('destinations_autorisees', v.destinations_autorisees);

    WHEN 'strategie_mixte' THEN
      -- Faisable si au moins une des voies d'ajout (surelevation OU
      -- construction neuve) est possible.
      ok := COALESCE(v.surelevation_possible_hauteur, false) OR COALESCE(v.extension_possible_ces, false);
      reasons := jsonb_build_object(
        'via_surelevation', v.surelevation_possible_hauteur,
        'via_extension', v.extension_possible_ces
      );

    ELSE
      ok := false;
      reasons := jsonb_build_object('erreur', 'scenario_type_inconnu', 'valeur_recue', p_scenario_type);
  END CASE;

  RETURN jsonb_build_object('gating_ok', ok, 'reasons', reasons);
END;
$$;

-- ============================================================
-- Verification (a executer manuellement) :
--   SELECT public.check_scenario_gating('<parcel_id_hauteur_deja_max>', 'surelevation');
--   -- attendu : gating_ok = false, reasons explicite
--   SELECT public.check_scenario_gating('<parcel_id_marge_ces>', 'construction_neuve_meme_parcelle');
--   -- attendu : gating_ok = true
--   SELECT public.check_scenario_gating('<parcel_id_quelconque>', 'demolition_reconstruction');
--   -- attendu : gating_ok = true, note explicative
-- ============================================================
