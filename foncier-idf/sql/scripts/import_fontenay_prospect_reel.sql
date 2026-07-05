-- =========================================
-- Import ponctuel de VALIDATION -- reculs reels Fontenay-sous-Bois (94033)
-- =========================================
-- A executer A LA MAIN dans le SQL editor Supabase, APRES la migration 71
-- et APRES sql/scripts/import_vitry_fontenay_ces_reel.sql (Phase 1, deja
-- execute ou a executer avant celui-ci -- meme couple insee_code/zone_libelle
-- '94033'/'UBb').
--
-- Source : texte brut du reglement PLUi (cache
-- C:\Users\PC\datamerry\cache_plu\_reglement_fontenay.pdf.txt), sections
-- "Pour la commune de Fontenay-sous-Bois – UB.6" (implantation/voies,
-- lignes ~15247-15264) et "Pour la commune de Fontenay-sous-Bois – UB.7"
-- (implantation/limites separatives, lignes ~15947-15992) -- dispositions
-- COMMUNALES generales, aucune sous-regle specifique au secteur UBb n'a ete
-- trouvee dans ces deux articles pour Fontenay-sous-Bois (verifie par
-- recherche exhaustive de toutes les occurrences "UBb" du document : les
-- carve-outs UBb existants concernent d'autres articles -- UB.9 emprise au
-- sol, UB.10 hauteur, UB.14 -- pas UB.6/UB.7). La regle communale generale
-- s'applique donc telle quelle au secteur UBb.
--
-- Extrait brut -- FACADE (recul/voie), Article UB.6, Fontenay-sous-Bois :
--   "1 – Les constructions devront s'implanter :
--    • soit a l'alignement actuel ou futur des voies publiques...
--    • soit selon un recul entre 3 metres minimum et 5 metres maximum dans
--      une bande de 20 metres de l'alignement..."
--   -- Deux options reglementaires (alignement=0m OU retrait 3-5m) : la
--   valeur retenue ci-dessous (3m) est le minimum de l'option "retrait",
--   documentee comme telle -- l'alignement pur (0m) reste egalement
--   conforme et n'est pas represente par une seule valeur numerique.
--
-- Extrait brut -- LATERAL/FOND, Article UB.7, Fontenay-sous-Bois :
--   "3 – En cas d'implantation en retrait des limites separatives, les
--    modalites... doivent etre respectees simultanement :
--    - En cas de facade comportant des baies, le retrait L ... doit etre
--      egal a la hauteur H de cette facade (L=H), avec un minimum de 8m ;
--    - En cas de facade ne comportant pas de baies, le retrait L ... doit
--      etre egal a la moitie de la hauteur H (L=H/2), avec un minimum de
--      3m."
--   -- Regle a formule dependante de la hauteur (L=H ou L=H/2), pas une
--   distance fixe : les valeurs 3/8 stockees ici sont les PLANCHERS
--   reglementaires (minimums), pas la formule complete -- un batiment haut
--   avec baies exigerait plus que 8m (L=H). Limite documentee, coherente
--   avec le principe "eventail = pire cas connu, pas une formule complete"
--   deja accepte pour les autres zones. Le texte ne distingue pas lateral
--   de fond (regle unique "limites separatives"), meme fourchette utilisee
--   pour les deux, comme pour Vitry.

-- 1) Facade (recul/voie) -- correction du NULL laisse en Phase 1
UPDATE public.plu_zone_rules_reel
SET recul_voie_m = 3.0,
    source_extrait = 'UB.6 Fontenay-sous-Bois : alignement OU recul 3m min / 5m max (bande 20m) -- valeur retenue = minimum de l''option retrait',
    updated_at = now()
WHERE insee_code = '94033' AND zone_libelle = 'UBb';

-- 2) Lateral / fond (planchers reglementaires, meme fourchette source pour les deux)
-- DELETE avant INSERT : script rejouable sans creer de doublon si execute
-- deux fois (pas de contrainte UNIQUE sur cette table, cf. migration 71 --
-- une zone peut legitimement avoir plusieurs indices, mais Fontenay n'en a
-- qu'un seul ici, indice_reglementaire NULL).
DELETE FROM public.plu_zone_rules_reel_prospect
WHERE insee_code = '94033' AND zone_libelle = 'UBb' AND indice_reglementaire IS NULL;

INSERT INTO public.plu_zone_rules_reel_prospect
  (insee_code, zone_libelle, indice_reglementaire,
   setback_side_min_m, setback_side_max_m,
   setback_rear_min_m, setback_rear_max_m,
   is_range, source_extrait, methode_extraction, a_verifier)
VALUES
  ('94033', 'UBb', NULL,
   3.0, 8.0,
   3.0, 8.0,
   true,
   'UB.7 Fontenay-sous-Bois : retrait minimum 3m (facade sans baie, L=H/2) ou 8m (facade avec baie, L=H) -- planchers reglementaires, formule dependante de la hauteur non modelisee',
   'regex_pluid', true);

-- ============================================================
-- Verification (a executer manuellement) :
--   SELECT recul_voie_m FROM public.plu_zone_rules_reel
--   WHERE insee_code='94033' AND zone_libelle='UBb';
--   -- attendu : 3.0 (au lieu de NULL)
--
--   SELECT * FROM public.plu_zone_rules_reel_prospect WHERE insee_code='94033';
--   -- 1 ligne, indice_reglementaire NULL (regle communale generale, pas
--   -- d'indice par parcelle dans ce PLUi contrairement a Vitry), 3.0/8.0
--
--   SELECT setback_side_min_m_worst_case, setback_rear_min_m_worst_case
--   FROM public.v_parcel_prefaisabilite WHERE insee_code='94033' LIMIT 5;
--   -- attendu : 3.0 des deux cotes
--
--   SELECT ST_Area(public.compute_buildable_envelope(parcel_id)), ST_Area(geom)
--   FROM public.parcels WHERE insee_code='94033' LIMIT 5;
--   -- l'enveloppe doit maintenant etre visiblement plus petite que la
--   -- parcelle (reculs facade 3m + laterale/fond 3m desormais actifs)
-- ============================================================
