-- ============================================================
-- Migration 70 : vue v_parcel_sous_densite
-- Purement additive : empile une nouvelle vue par-dessus v_parcel_foncier
-- (inchangee) plutot que d'y ajouter des colonnes -- zero risque de
-- regression sur les routes publiques qui consomment v_parcel_foncier
-- directement (/api/foncier/opportunities, /bbox, /tiles/foncier/*).
-- ============================================================

-- Note : v_parcel_foncier (INCHANGEE) ne selectionne pas encore ces_source
-- (colonne ajoutee par la migration 66, apres la derniere definition de
-- v_parcel_foncier) -- on rejoint parcel_constructibility directement ici
-- plutot que de toucher v_parcel_foncier, conformement au plan.
CREATE OR REPLACE VIEW public.v_parcel_sous_densite AS
SELECT
  v.*,
  pc.ces_source,
  COALESCE(pds.dpe_passoire_any, false) AS dpe_passoire_any,
  COALESCE(pds.dpe_passoire_copro, false) AS dpe_passoire_copro,
  COALESCE(pds.dpe_passoire_maison, false) AS dpe_passoire_maison,
  COALESCE(pds.nb_groupes_passoire, 0) AS nb_groupes_passoire,
  r.destinations_autorisees,
  r.destinations_interdites,
  r.bande_constructible_m,
  r.a_verifier AS plu_reel_a_verifier
FROM public.v_parcel_foncier v
LEFT JOIN public.parcel_constructibility pc ON pc.parcel_id = v.parcel_id
LEFT JOIN public.parcel_dpe_stats pds ON pds.parcel_id = v.parcel_id
LEFT JOIN public.plu_zone_rules_reel r
  ON r.insee_code = v.insee_code AND r.zone_libelle = v.plu_zone_code;

-- Verification :
--   SELECT parcel_id, insee_code, plu_zone_code, ces_source, dpe_passoire_any
--   FROM public.v_parcel_sous_densite WHERE insee_code = '94081' LIMIT 20;
