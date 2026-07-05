-- ============================================================
-- Script ponctuel (hors chaine de migrations numerotees, a executer a la
-- main) : backfill Phase 2a pour les communes DEJA pipelinees AVANT la
-- migration 71 (Vitry-sur-Seine 94081, Fontenay-sous-Bois 94033).
--
-- IMPORTANT -- deux realites bien distinctes, ne pas les confondre :
--
-- 1) Classification des cotes de parcelle (facade/lateral/fond) :
--    calcul PostGIS PUR sur les geometries deja en base (parcels.geom,
--    buildings.geom) -- fonctionne DES MAINTENANT, aucun re-fetch requis.
--
-- 2) Hauteur reelle du bati (height_m) :
--    la valeur brute BD TOPO (m) n'a JAMAIS ete stockee pour les batiments
--    deja ingeres avant le fix de pipeline/route.ts (migration 71) -- elle
--    a ete recuperee du WFS, convertie en levels_est, puis DEFINITIVEMENT
--    perdue. Impossible de la "backfiller" depuis la base actuelle.
--    refresh_building_height_stats() ci-dessous ne remontera donc AUCUNE
--    valeur tant que la commune n'a pas ete RE-PIPELINEE (step 1b, POST
--    fix) -- c'est-a-dire appeler /api/foncier/pipeline avec le meme insee
--    pour re-fetcher BD TOPO et re-inserer les batiments AVEC height_m
--    cette fois. Ne pas s'etonner d'un refresh_building_height_stats() a 0
--    lignes tant que ce re-pipeline n'a pas ete fait.
-- ============================================================

-- 1) Classification des cotes -- fonctionne immediatement
SELECT public.classify_commune_parcel_edges('94081') AS vitry_edges_classified;
SELECT public.classify_commune_parcel_edges('94033') AS fontenay_edges_classified;

-- Verification rapide de la repartition des types de cotes
SELECT p.insee_code, pec.edge_type, count(*) AS nb
FROM public.parcel_edge_classification pec
JOIN public.parcels p ON p.parcel_id = pec.parcel_id
WHERE p.insee_code IN ('94081', '94033')
GROUP BY p.insee_code, pec.edge_type
ORDER BY p.insee_code, pec.edge_type;

-- 2) Hauteur reelle -- a executer SEULEMENT apres re-pipeline (voir note
-- ci-dessus). Inoffensif a lancer avant (retourne 0 sans erreur), mais ne
-- sera utile qu'apres.
SELECT public.refresh_building_height_stats('94081') AS vitry_heights_refreshed;
SELECT public.refresh_building_height_stats('94033') AS fontenay_heights_refreshed;

-- Verification
SELECT p.insee_code, count(*) FILTER (WHERE bs.height_existing_m IS NOT NULL) AS avec_hauteur,
       count(*) AS total_parcelles_avec_stats
FROM public.parcel_building_stats bs
JOIN public.parcels p ON p.parcel_id = bs.parcel_id
WHERE p.insee_code IN ('94081', '94033')
GROUP BY p.insee_code;
