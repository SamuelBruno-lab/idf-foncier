-- ============================================================
-- Nettoyage + re-ingestion des VRAIES zones PLU pour Vitry (94081) et
-- Fontenay-sous-Bois (94033) -- corrige le bug remonte par l'utilisateur
-- (memes parcelles pour logement/commerce/industrie).
--
-- ORDRE D'EXECUTION :
--   1. Executer ce script SQL (supprime les anciennes zones fallback).
--   2. Appeler POST /api/foncier/enrich-zone-urba avec {"insee":"94081"}
--      puis {"insee":"94033"} (meme auth x-admin-key que les autres
--      routes d'enrichissement -- SUPABASE_SERVICE_ROLE_KEY).
--   3. Ré-executer le scoring pour re-rattacher chaque parcelle a sa VRAIE
--      zone (les requetes ci-dessous, a la fin de ce fichier).
-- ============================================================

-- 1) Supprimer les zones fallback Phase 1 (union de toutes les parcelles
-- de la commune associee a UNE SEULE zone_libelle -- geometrie qui va
-- etre remplacee par les vraies zones de l'API GPU). Les lignes
-- plu_zone_rules_reel correspondantes (94081/UHXXXXXX, 94033/UBb) sont
-- CONSERVEES : elles portent le ces/hauteur_max_m/recul_voie_m extraits
-- manuellement du reglement (Phase 1 + import_vitry_prospect_reel.sql/
-- import_fontenay_prospect_reel.sql), qui restent valables et seront
-- fusionnes (pas ecrases) avec les destinations reelles a l'etape 2.
DELETE FROM public.plu_zone_urba_geom
WHERE insee_code = '94081' AND zone_libelle = 'UHXXXXXX';

DELETE FROM public.plu_zone_urba_geom
WHERE insee_code = '94033' AND zone_libelle = 'UBb';

-- ============================================================
-- 2) (hors SQL) Appeler la route d'ingestion reelle pour les 2 communes :
--
--   curl -X POST https://<votre-domaine>/api/foncier/enrich-zone-urba \
--     -H "x-admin-key: <SUPABASE_SERVICE_ROLE_KEY>" \
--     -H "Content-Type: application/json" \
--     -d '{"insee":"94081"}'
--
--   curl -X POST https://<votre-domaine>/api/foncier/enrich-zone-urba \
--     -H "x-admin-key: <SUPABASE_SERVICE_ROLE_KEY>" \
--     -H "Content-Type: application/json" \
--     -d '{"insee":"94033"}'
--
-- Reponse attendue : {"insee":"94081","zones_found":N,"zones_ingested":N,
-- "zones_distinctes":M} avec M > 1 (plusieurs dizaines attendues, cf. test
-- manuel : 54 zones distinctes rien que dans un rayon de qq km sur Vitry).
-- ============================================================

-- 3) Re-scoring -- re-rattache chaque parcelle a sa VRAIE zone (au lieu de
-- la zone fallback unique) et recalcule le potentiel/CES/hauteur selon la
-- zone reellement trouvee (COALESCE de repli vers generique si la zone
-- specifique n'a pas de ces/hauteur/recul extrait -- comportement
-- identique a avant pour ces cas, migration 67).
SELECT public.score_commune_parcels('94081', 4000);
SELECT public.score_commune_parcels('94033', 4000);

-- Re-classification des cotes de parcelle (migration 71) et rafraichissement
-- hauteur existante -- inchange par cette correction, mais bon reflexe de
-- les rejouer si ce n'est pas deja fait depuis les migrations 71-76.
SELECT public.classify_commune_parcel_edges('94081');
SELECT public.classify_commune_parcel_edges('94033');

-- ============================================================
-- Verification (a executer manuellement) :
--
--   -- Plusieurs zones distinctes desormais rattachees aux parcelles :
--   SELECT plu_zone_code, count(*) FROM public.parcel_constructibility
--   WHERE parcel_id LIKE '94081%' GROUP BY plu_zone_code ORDER BY count(*) DESC;
--   -- attendu : plusieurs zone_code differents (pas un seul 'UHXXXXXX'
--   -- partout comme avant cette correction).
--
--   -- Les destinations different reellement d'une zone a l'autre :
--   SELECT zone_libelle, destinations_autorisees FROM public.plu_zone_rules_reel
--   WHERE insee_code = '94081' AND zone_libelle IN (
--     SELECT DISTINCT plu_zone_code FROM public.parcel_constructibility
--     WHERE parcel_id LIKE '94081%'
--   );
--
--   -- Le filtre persona doit maintenant renvoyer des listes DIFFERENTES :
--   -- comparer le nombre de resultats de
--   --   GET /api/cabinets/<slug>/foncier/sous-densite?insee=94081&persona=logement
--   -- vs persona=industrie -- ne doivent plus etre identiques.
-- ============================================================
