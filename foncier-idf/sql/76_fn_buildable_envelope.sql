-- ============================================================
-- Migration 76 : fonction compute_buildable_envelope(parcel_id)
--
-- Calcule l'ENVELOPPE CONSTRUCTIBLE reelle d'une parcelle -- le contour
-- geometrique obtenu en erodant la parcelle vers l'interieur, COTE PAR
-- COTE, avec le recul specifique qui s'applique a ce cote precis (facade =
-- recul_voie_m, lateral/fond = pire cas de l'eventail
-- plu_zone_rules_reel_prospect) -- PAS un retrait uniforme. C'est le
-- "positionnement fantome" demande : la forme suit la geometrie reelle de
-- la parcelle apres reculs, pas une simple surface abstraite en m².
--
-- Methode d'erosion par cote (evite les problemes de sens/orientation
-- d'anneau qu'un ST_OffsetCurve signe demanderait) : pour chaque cote
-- classifie (parcel_edge_classification, migration 71), on soustrait de
-- l'enveloppe un buffer a bouts plats ("endcap=flat") de ce segment, de
-- rayon = le recul exige pour ce type de cote. ST_Difference ne retire que
-- la partie qui chevauche reellement la parcelle -- robuste aux formes non
-- convexes, sans avoir a determiner un sens d'erosion.
--
-- Plafond CES : si l'enveloppe ainsi obtenue depasse encore la surface
-- autorisee par le CES (rare, cas des reculs tres faibles), un retrait
-- UNIFORME supplementaire est applique par bissection -- a ce stade, un
-- retrait uniforme est une approximation raisonnable puisque les reculs
-- specifiques par cote sont deja garantis par la boucle precedente (ce
-- retrait ne peut que les renforcer, jamais les violer).
-- ============================================================

CREATE OR REPLACE FUNCTION public.compute_buildable_envelope(p_parcel_id TEXT)
RETURNS geometry
LANGUAGE plpgsql
AS $$
DECLARE
  v_parcel RECORD;
  v_envelope geometry;
  v_edge RECORD;
  v_setback NUMERIC;
  v_target_area NUMERIC;
  v_current_area NUMERIC;
  v_low NUMERIC;
  v_high NUMERIC;
  v_mid NUMERIC;
  i INTEGER;
BEGIN
  SELECT p.geom, p.area_m2, p.insee_code, pc.plu_zone_code, pc.ces_applied
  INTO v_parcel
  FROM public.parcels p
  LEFT JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
  WHERE p.parcel_id = p_parcel_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_envelope := v_parcel.geom;

  FOR v_edge IN
    SELECT pec.edge_geom, pec.edge_type
    FROM public.parcel_edge_classification pec
    WHERE pec.parcel_id = p_parcel_id
  LOOP
    v_setback := NULL;

    IF v_edge.edge_type = 'facade' THEN
      SELECT r.recul_voie_m INTO v_setback
      FROM public.plu_zone_rules_reel r
      WHERE r.insee_code = v_parcel.insee_code AND r.zone_libelle = v_parcel.plu_zone_code;
    ELSIF v_edge.edge_type = 'lateral' THEN
      SELECT MAX(p2.setback_side_min_m) INTO v_setback
      FROM public.plu_zone_rules_reel_prospect p2
      WHERE p2.insee_code = v_parcel.insee_code AND p2.zone_libelle = v_parcel.plu_zone_code;
    ELSIF v_edge.edge_type = 'fond' THEN
      SELECT MAX(p2.setback_rear_min_m) INTO v_setback
      FROM public.plu_zone_rules_reel_prospect p2
      WHERE p2.insee_code = v_parcel.insee_code AND p2.zone_libelle = v_parcel.plu_zone_code;
    END IF;

    IF v_setback IS NOT NULL AND v_setback > 0 THEN
      v_envelope := ST_Difference(
        v_envelope,
        ST_Buffer(v_edge.edge_geom, v_setback, 'endcap=flat join=mitre')
      );
    END IF;
  END LOOP;

  v_current_area := ST_Area(v_envelope);

  IF v_parcel.ces_applied IS NOT NULL AND v_parcel.area_m2 IS NOT NULL AND v_current_area > 0 THEN
    v_target_area := v_parcel.area_m2 * v_parcel.ces_applied;
    IF v_current_area > v_target_area AND v_target_area > 0 THEN
      v_low := 0;
      v_high := SQRT(v_current_area);
      FOR i IN 1..30 LOOP
        v_mid := (v_low + v_high) / 2;
        IF ST_Area(ST_Buffer(v_envelope, -v_mid)) > v_target_area THEN
          v_low := v_mid;
        ELSE
          v_high := v_mid;
        END IF;
      END LOOP;
      v_envelope := ST_Buffer(v_envelope, -v_high);
    END IF;
  END IF;

  RETURN ST_MakeValid(v_envelope);
END;
$$;

-- Wrapper de serialisation GeoJSON -- un appel RPC scalaire renvoyant une
-- geometry brute serait renvoye en WKB hex par Supabase (peu pratique cote
-- client). Cette fonction renvoie directement du GeoJSON + l'aire, en
-- Lambert-93/2154 (pas de reprojection -- necessaire pour un calcul
-- metrique exact du rectangle inscrit optimal cote TypeScript).
CREATE OR REPLACE FUNCTION public.compute_buildable_envelope_geojson(p_parcel_id TEXT)
RETURNS TABLE (geojson JSONB, area_m2 NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ST_AsGeoJSON(env)::jsonb AS geojson,
    ST_Area(env) AS area_m2
  FROM (SELECT public.compute_buildable_envelope(p_parcel_id) AS env) e
  WHERE env IS NOT NULL;
$$;

-- ============================================================
-- Verification (a executer manuellement) :
--
--   SELECT ST_Area(public.compute_buildable_envelope('<parcel_id_test>')) AS aire_enveloppe_m2,
--          ST_Area(geom) AS aire_parcelle_m2
--   FROM public.parcels WHERE parcel_id = '<parcel_id_test>';
--   -- aire_enveloppe_m2 doit etre STRICTEMENT inferieure a aire_parcelle_m2
--   -- (sauf reculs tous nuls, cas degenere).
--
--   SELECT ST_AsGeoJSON(public.compute_buildable_envelope('<parcel_id_test>'));
--   -- geometrie valide (Polygon ou MultiPolygon), non vide sauf reculs
--   -- excessifs par rapport a la taille de la parcelle.
-- ============================================================
