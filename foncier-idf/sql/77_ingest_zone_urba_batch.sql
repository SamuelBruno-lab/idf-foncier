-- ============================================================
-- Migration 77 : ingestion des VRAIES zones PLU (geometrie + destinations)
-- depuis l'API officielle IGN "GPU zone-urba".
--
-- Corrige a la racine un bug remonte par l'utilisateur : le filtre persona
-- (logement/commerce/industrie/...) renvoyait les MEMES parcelles quelle
-- que soit la destination choisie. Cause reelle : la Phase 1 avait
-- approxime la geometrie de zone par un fallback "union de toutes les
-- parcelles de la commune" associe a UNE SEULE zone_libelle -- TOUTES les
-- parcelles d'une commune tombaient donc dans la meme zone, et
-- destinations_autorisees n'a jamais ete rempli nulle part (colonne
-- toujours NULL). Verifie en direct sur apicarto.ign.fr/api/gpu/zone-urba :
-- l'API renvoie de VRAIES geometries de zones distinctes (ex: 54 zones
-- differentes rien que dans un rayon de qq km sur Vitry -- UH habitat
-- individuel, UR residentiel collectif, UI activites economiques avec
-- sous-variantes UIc commerce/UIl logistique/UIp production, UM mixte,
-- UE equipements...) avec les codes CNIG officiels des destinations
-- autorisees/soumises a condition/interdites (destoui/destcdt/destnon).
--
-- Mapping des codes CNIG (nomenclature officielle R151-27/28, verifie par
-- recoupement empirique sur plusieurs familles de zones -- ex: zone UIl
-- "Activites logistiques" autorise bien 51/52, zone agricole autorise 11,
-- zone commerciale UIc autorise 31-36 et interdit 51) :
--   11=agricole 12=forestier 21=logement 22=hebergement
--   31=commerce_detail 32=restauration 33=commerce_gros
--   34=activites_services 35=hebergement_hotelier 36=cinema
--   41/42=administration_publique 43=equipement_sante 44/45=salle_spectacle
--   51=industrie 52=entrepot 53=bureau 54=centre_congres
-- Codes 37/46/47/55 rencontres dans les donnees mais NON documentes dans
-- le standard officiel a 20 sous-destinations -- volontairement laisses
-- NON mappes (ni autorises ni interdits) plutot que de deviner leur sens.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ingest_zone_urba_batch(zones_json TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT
      j->>'insee_code' AS insee_code,
      j->>'zone_libelle' AS zone_libelle,
      j->>'zone_family' AS zone_family,
      j->>'gpu_partition' AS gpu_partition,
      j->>'geojson' AS geojson,
      ARRAY(SELECT jsonb_array_elements_text(j->'destinations_autorisees')) AS destinations_autorisees,
      ARRAY(SELECT jsonb_array_elements_text(j->'destinations_interdites')) AS destinations_interdites
    FROM jsonb_array_elements(zones_json::jsonb) AS j
  LOOP
    -- Geometrie : une ligne par polygone (une meme zone_libelle peut avoir
    -- plusieurs ilots disjoints dans la commune -- pas de UNIQUE sur cette
    -- table, cf. migration 66, c'est voulu). Le rattachement parcelle->zone
    -- (score_commune_parcels, ST_Contains + ORDER BY ST_Area ASC LIMIT 1)
    -- fonctionne correctement quel que soit le nombre d'ilots.
    INSERT INTO public.plu_zone_urba_geom (insee_code, zone_libelle, gpu_partition, geom, source_millesime)
    VALUES (
      rec.insee_code,
      rec.zone_libelle,
      rec.gpu_partition,
      ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(rec.geojson), 4326), 2154)),
      CURRENT_DATE
    );

    -- Regle de zone : UNE ligne par zone_libelle (upsert, plusieurs
    -- polygones de la meme zone partagent la meme regle). N'ecrase QUE
    -- destinations_autorisees/interdites + zone_family (si absent) --
    -- ces/hauteur_max_m/recul_voie_m ne sont PAS dans ce SET : si une
    -- extraction reglementaire manuelle existe deja pour cette zone
    -- (ex: 94081/UHXXXXXX, 94033/UBb), elle n'est jamais ecrasee par
    -- cette ingestion API (qui ne fournit pas ces valeurs).
    INSERT INTO public.plu_zone_rules_reel
      (insee_code, zone_libelle, zone_family, destinations_autorisees, destinations_interdites,
       methode_extraction, source_document, a_verifier)
    VALUES
      (rec.insee_code, rec.zone_libelle, rec.zone_family,
       rec.destinations_autorisees, rec.destinations_interdites,
       'api_gpu', rec.gpu_partition, true)
    ON CONFLICT (insee_code, zone_libelle) DO UPDATE SET
      destinations_autorisees = EXCLUDED.destinations_autorisees,
      destinations_interdites = EXCLUDED.destinations_interdites,
      zone_family = COALESCE(public.plu_zone_rules_reel.zone_family, EXCLUDED.zone_family),
      updated_at = now();

    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;

-- ============================================================
-- Verification (a executer manuellement, apres avoir appele la route
-- /api/foncier/enrich-zone-urba pour 94081 et 94033) :
--
--   SELECT zone_libelle, destinations_autorisees, destinations_interdites
--   FROM public.plu_zone_rules_reel WHERE insee_code = '94081'
--   ORDER BY zone_libelle LIMIT 20;
--   -- attendu : plusieurs zones distinctes, avec des destinations
--   -- clairement differentes (une zone UH n'aura pas "industrie" dans
--   -- ses destinations_autorisees, une zone UIl l'aura).
--
--   SELECT count(DISTINCT plu_zone_code) FROM public.parcel_constructibility
--   WHERE parcel_id LIKE '94081%';
--   -- doit etre > 1 apres re-execution de score_commune_parcels('94081', ...)
--   -- (avant cette migration : toujours 1, meme zone pour toute la commune)
-- ============================================================
