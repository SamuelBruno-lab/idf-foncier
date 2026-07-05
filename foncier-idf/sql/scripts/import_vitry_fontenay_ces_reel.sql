-- =========================================
-- Import ponctuel de VALIDATION -- Vitry-sur-Seine (94081) + Fontenay-sous-Bois (94033)
-- =========================================
-- A executer A LA MAIN dans le SQL editor Supabase APRES la migration 66.
-- Hors chaine de migrations numerotees : ceci est une insertion de DONNEES
-- (issues du prototype Python C:\Users\PC\datamerry\ces_rules.csv), pas un
-- changement de schema.
--
-- Fidelite aux donnees : seules les valeurs REELLEMENT presentes dans
-- ces_rules.csv sont importees. Des valeurs plus riches (recul_voie_m=3m
-- pour Fontenay, destinations_autorisees pour les deux communes) avaient
-- ete observees lors de tests interactifs ce soir mais N'ONT PAS ETE
-- PERSISTEES dans ce CSV (les appels ces_store.upsert de demo n'incluaient
-- que ces/hauteur_max_m) -- elles sont donc laissees NULL ici plutot que
-- reconstruites de memoire. Une vraie passe d'extraction (section_finder +
-- plu_extract, log complet vers ces_rules.csv) est necessaire pour les
-- completer avant la generalisation a toute l'IDF.

INSERT INTO public.plu_zone_rules_reel
  (insee_code, zone_libelle, zone_family, ces, hauteur_max_m, recul_voie_m,
   source_extrait, source_document, methode_extraction, a_verifier)
VALUES
  ('94081', 'UHXXXXXX', 'U', 0.40, 10.0, NULL,
   'UH indice A : emprise 40%',
   'PLUi Grand-Orly Seine Bievre (DU_200058014)', 'regex_pluid', true),
  ('94033', 'UBb', 'U', NULL, 12.0, NULL,
   'UB.10 UBb : 12 m au faitage (CES non reglemente dans ce PLUi)',
   'PLUi Paris Est Marne & Bois (DU_200057941)', 'llm_groq', true)
ON CONFLICT (insee_code, zone_libelle) DO UPDATE SET
  ces = EXCLUDED.ces,
  hauteur_max_m = EXCLUDED.hauteur_max_m,
  recul_voie_m = EXCLUDED.recul_voie_m,
  source_extrait = EXCLUDED.source_extrait,
  source_document = EXCLUDED.source_document,
  methode_extraction = EXCLUDED.methode_extraction,
  updated_at = now();

-- Geometrie de repli V1 : union de toutes les parcelles de la commune,
-- associee au zone_libelle dominant (perte de granularite intra-commune
-- ASSUMEE et documentee -- suffisant pour valider le pipeline bout-en-bout
-- sans dependre de l'ingestion GPU zone-urba complete, hors scope V1).
-- A remplacer en V2 par la vraie geometrie GPU (WFS data.geopf.fr).
-- ST_MakeValid avant ST_Union : les geometries cadastrales Etalab contiennent
-- parfois des auto-intersections mineures -- ST_Union brut plante alors avec
-- une TopologyException GEOS ("side location conflict").
INSERT INTO public.plu_zone_urba_geom (insee_code, zone_libelle, gpu_partition, geom, source_millesime)
SELECT '94081', 'UHXXXXXX', 'DU_200058014',
       ST_Multi(ST_CollectionExtract(ST_Union(ST_MakeValid(p.geom)), 3)), CURRENT_DATE
FROM public.parcels p WHERE p.insee_code = '94081'
HAVING ST_Union(ST_MakeValid(p.geom)) IS NOT NULL;

INSERT INTO public.plu_zone_urba_geom (insee_code, zone_libelle, gpu_partition, geom, source_millesime)
SELECT '94033', 'UBb', 'DU_200057941',
       ST_Multi(ST_CollectionExtract(ST_Union(ST_MakeValid(p.geom)), 3)), CURRENT_DATE
FROM public.parcels p WHERE p.insee_code = '94033'
HAVING ST_Union(ST_MakeValid(p.geom)) IS NOT NULL;

-- Verification rapide (a lancer manuellement apres l'import) :
--   SELECT * FROM public.plu_zone_rules_reel WHERE insee_code IN ('94081','94033');
--   SELECT insee_code, zone_libelle, ST_Area(geom) FROM public.plu_zone_urba_geom WHERE insee_code IN ('94081','94033');
-- Si les tables parcels sont VIDES pour ces communes (pas encore ingerees via
-- /api/foncier/pipeline step=ingest), les deux INSERT plu_zone_urba_geom ne
-- feront rien (HAVING filtre les groupes sans geometrie) -- lancer d'abord
-- l'ingestion cadastre pour 94081/94033 avant ce script, ou apres, l'ordre
-- n'a pas d'importance pour plu_zone_rules_reel (independante des parcels).
