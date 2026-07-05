-- =========================================
-- Import ponctuel de VALIDATION -- reculs reels Vitry-sur-Seine (94081)
-- =========================================
-- A executer A LA MAIN dans le SQL editor Supabase, APRES la migration 71
-- et APRES sql/scripts/import_vitry_fontenay_ces_reel.sql (Phase 1, deja
-- execute ou a executer avant celui-ci -- meme couple insee_code/zone_libelle
-- '94081'/'UHXXXXXX').
--
-- Source : extraction reelle du reglement PLUi (regex section_finder +
-- plu_extract, prototype Python C:\Users\PC\datamerry), cache
-- `_reg__reglement_UH.pdf_UH_VSS1.json` -- zone UH, secteur VSS1, INDICE A
-- (indice reglementaire confirme pour la parcelle 94081000CF0200, 109 rue
-- Constant Coquelin, resolu via API Carto GPU + le meme reglement -- cf.
-- archive `_t_vitry.json`, section B_droit_construire.ces.valeur.indice="A").
--
-- Limite honnete, IDENTIQUE a celle deja acceptee en Phase 1 pour ces/hauteur
-- (import_vitry_fontenay_ces_reel.sql) : l'indice A est celui resolu pour
-- CETTE parcelle precise, applique ici a toute la zone 'UHXXXXXX' comme
-- valeur representative -- pas une garantie que TOUTE parcelle de la zone
-- ait le meme indice. a_verifier reste true.
--
-- Extrait brut (texte reel du reglement, page 103 "bande", page 162 "limites") :
--   FACADE (recul/voie), INDICE A : "les constructions principales doivent
--     etre implantees en retrait de 5 metres minimum de l'alignement."
--   LATERAL/FOND, INDICE A : "Les constructions principales doivent etre
--     implantees soit sur une seule des limites separatives laterales soit
--     en retrait des limites separatives. Les constructions principales
--     doivent etre implantees en retrait des limites separatives de fond.
--     En cas de retrait : 6 metres minimum en cas d'ouvertures constituant
--     des vues, 3 metres minimum en cas d'absence d'ouverture/vue."
--   -- Ce texte applique le MEME critere numerique (3m / 6m selon vue) aux
--   limites laterales ET de fond -- pas de distinction chiffree separee
--   entre les deux dans cet indice, d'ou la meme fourchette utilisee pour
--   setback_side_* et setback_rear_* ci-dessous (fidelite au texte source,
--   pas une approximation arbitraire).
--
-- Fontenay-sous-Bois (94033) : traitee separement dans
-- sql/scripts/import_fontenay_prospect_reel.sql -- le cache structure
-- (`sf__reglement_fontenay.pdf_UB_FontenaysousBois.json`) n'avait rien,
-- mais le texte brut du reglement (`_reglement_fontenay.pdf.txt`) contient
-- bien les articles UB.6/UB.7 -- retrouves et importes dans ce 2e script.

-- 1) Facade (recul/voie) -- correction du NULL laisse en Phase 1
UPDATE public.plu_zone_rules_reel
SET recul_voie_m = 5.0,
    source_extrait = 'UH indice A (bande) : retrait de 5 metres minimum de l''alignement',
    updated_at = now()
WHERE insee_code = '94081' AND zone_libelle = 'UHXXXXXX';

-- 2) Lateral / fond (eventail, meme fourchette source pour les deux -- cf. note ci-dessus)
-- DELETE avant INSERT : script rejouable sans creer de doublon si execute
-- deux fois (pas de contrainte UNIQUE sur cette table, cf. migration 71).
DELETE FROM public.plu_zone_rules_reel_prospect
WHERE insee_code = '94081' AND zone_libelle = 'UHXXXXXX' AND indice_reglementaire = 'A';

INSERT INTO public.plu_zone_rules_reel_prospect
  (insee_code, zone_libelle, indice_reglementaire,
   setback_side_min_m, setback_side_max_m,
   setback_rear_min_m, setback_rear_max_m,
   is_range, source_extrait, methode_extraction, a_verifier)
VALUES
  ('94081', 'UHXXXXXX', 'A',
   3.0, 6.0,
   3.0, 6.0,
   true,
   'UH indice A (limites separatives) : 3m minimum sans vue / 6m minimum avec vue -- meme critere applique lateral et fond',
   'regex_pluid', true);

-- ============================================================
-- Verification (a executer manuellement) :
--   SELECT recul_voie_m FROM public.plu_zone_rules_reel
--   WHERE insee_code='94081' AND zone_libelle='UHXXXXXX';
--   -- attendu : 5.0 (au lieu de NULL)
--
--   SELECT * FROM public.plu_zone_rules_reel_prospect WHERE insee_code='94081';
--   -- 1 ligne, indice A, 3.0/6.0 des deux cotes
--
--   SELECT setback_side_min_m_worst_case, setback_rear_min_m_worst_case
--   FROM public.v_parcel_prefaisabilite WHERE insee_code='94081' LIMIT 5;
--   -- attendu : 3.0 des deux cotes (MAX sur une seule ligne = elle-meme)
--
--   SELECT ST_Area(public.compute_buildable_envelope(parcel_id)), ST_Area(geom)
--   FROM public.parcels WHERE insee_code='94081' LIMIT 5;
--   -- l'enveloppe doit maintenant etre visiblement plus petite que la
--   -- parcelle (reculs facade 5m + laterale/fond 3m desormais actifs,
--   -- contrairement a avant ce script ou seul le plafond CES s'appliquait)
-- ============================================================
