-- Calcule le score final de mutabilité par parcelle.
-- Bilan promoteur — méthode ICH compte à rebours (tableur PROMOTION)
--
-- RECETTES
--   CA = surface habitable × prix vente m²
--   surface habitable = SDP × rendement (0.75)
--
-- DÉPENSES (dans l'ordre du tableur ICH)
--   1. Marge promoteur    = 8% × CA              (DÉPENSE, pas un résultat !)
--   2. Construction        = 1 800 €/m² × SDP    (honoraires compris, IDF)
--   3. VRD                 = 100 €/m² × surface TERRAIN
--   4. Publicité           = 2.5% × CA
--   5. Dette (frais fin.)  = 6% × (construction + pub + VRD)
--   6. Parking souterrain  = nb_places × 13 500 €/place
--   7. Taxe d'aménagement  = SDP × 854 €/m² × taux communal
--
-- RÉSULTAT
--   Charge foncière = CA - somme dépenses = prix max terrain

INSERT INTO public.parcel_scores (
  parcel_id,
  mutability_score,
  underuse_score,
  zoning_score,
  market_score,
  size_score,
  land_value_score,
  best_use,
  land_value_est,
  program_value_est,
  nb_logements_est,
  nb_parking_places,
  parking_cost,
  parking_surface_m2,
  taxe_amenagement,
  taxe_amenagement_taux,
  zone_vocation,
  plu_zone_code,
  explanation_json,
  computed_at
)
SELECT
  p.parcel_id,

  -- Score final pondéré
  ROUND(
    (
      0.30 * sub.underuse_score +
      0.25 * sub.zoning_score +
      0.20 * sub.market_score +
      0.15 * sub.size_score +
      0.10 * sub.land_value_score
    )
  , 2) AS mutability_score,

  sub.underuse_score,
  sub.zoning_score,
  sub.market_score,
  sub.size_score,
  sub.land_value_score,

  -- Best use selon vocation PLU
  CASE
    WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'economique'
      THEN CASE
        WHEN p.area_m2 >= 2000 AND pc.underuse_ratio >= 0.70
          THEN 'activite_economique'
        WHEN p.area_m2 >= 500 AND pc.underuse_ratio >= 0.50
          THEN 'bureaux_commerces'
        ELSE 'analyse_complementaire'
      END
    WHEN COALESCE(pc.zone_vocation, 'residentiel') IN ('residentiel', 'mixte')
      THEN CASE
        WHEN pc.dominant_zone_family IN ('U', 'AU')
             AND p.area_m2 >= 600
             AND pc.underuse_ratio >= 0.70
          THEN 'densification_residentielle'
        WHEN pc.dominant_zone_family = 'U'
             AND p.area_m2 BETWEEN 300 AND 700
             AND pc.underuse_ratio >= 0.60
          THEN 'division_parcellaire'
        WHEN pc.dominant_zone_family = 'U'
             AND COALESCE(bs.coverage_ratio, 0) < 0.15
          THEN 'dent_creuse'
        WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'mixte'
             AND p.area_m2 >= 2000
             AND pc.underuse_ratio >= 0.60
          THEN 'mixte_logements_activite'
        ELSE 'analyse_complementaire'
      END
    ELSE 'analyse_complementaire'
  END AS best_use,

  bilan.charge_fonciere AS land_value_est,
  bilan.ca_total AS program_value_est,
  bilan.nb_logements AS nb_logements_est,
  bilan.nb_parking_places AS nb_parking_places,
  bilan.cout_parking AS parking_cost,
  bilan.surface_parking AS parking_surface_m2,
  bilan.taxe_amenagement AS taxe_amenagement,
  bilan.ta_taux AS taxe_amenagement_taux,
  COALESCE(pc.zone_vocation, 'residentiel') AS zone_vocation,
  pc.plu_zone_code,

  jsonb_build_object(
    -- Parcelle
    'area_m2', p.area_m2,
    'underuse_ratio', pc.underuse_ratio,
    'dominant_zone_family', pc.dominant_zone_family,
    'plu_zone_code', pc.plu_zone_code,
    'zone_vocation', COALESCE(pc.zone_vocation, 'residentiel'),
    'ces_applied', pc.ces_applied,
    'max_height_est', pc.max_height_est,
    'setback_front_m', pc.setback_front_m,
    'setback_side_m', pc.setback_side_m,
    'median_price_m2', pms.median_price_m2,
    'estimated_gfa', pc.estimated_gfa,
    'residual_potential_est', pc.residual_potential_est,
    'coverage_ratio', bs.coverage_ratio,
    -- Bilan promoteur ICH
    'surface_habitable', bilan.surface_habitable,
    'ca_total', bilan.ca_total,
    'nb_logements_est', bilan.nb_logements,
    'prix_par_logement', bilan.prix_par_logement,
    'nb_parking_places', bilan.nb_parking_places,
    'marge_promoteur', bilan.marge_promoteur,
    'cout_construction', bilan.cout_construction,
    'cout_vrd', bilan.cout_vrd,
    'cout_publicite', bilan.cout_publicite,
    'cout_dette', bilan.cout_dette,
    'cout_parking', bilan.cout_parking,
    'surface_parking', bilan.surface_parking,
    'taxe_amenagement', bilan.taxe_amenagement,
    'taxe_amenagement_taux', bilan.ta_taux,
    'total_depenses', bilan.total_depenses,
    'charge_fonciere', bilan.charge_fonciere,
    'charge_fonciere_m2_terrain', CASE WHEN p.area_m2 > 0 THEN bilan.charge_fonciere / p.area_m2 ELSE 0 END
  ) AS explanation_json,

  now() AS computed_at

FROM public.parcels p
JOIN public.parcel_constructibility pc
  ON pc.parcel_id = p.parcel_id
LEFT JOIN public.parcel_market_stats pms
  ON pms.parcel_id = p.parcel_id
LEFT JOIN public.parcel_building_stats bs
  ON bs.parcel_id = p.parcel_id
-- Jointure PLU pour les ratios parking par typo
LEFT JOIN public.plu_zone_rules plu_r
  ON plu_r.zone_code = pc.plu_zone_code
  AND plu_r.epci_code = 'BNS'
-- ═══════════════════════════════════════════
-- BILAN PROMOTEUR ICH (compte à rebours)
-- ═══════════════════════════════════════════
CROSS JOIN LATERAL (
  SELECT
    -- ── Nb logements (SDP / 60 m²) ──
    GREATEST(1, FLOOR(pc.estimated_gfa / 60.0))::int AS nb_logements,

    -- ── Nb places parking PLU ──
    CASE
      WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'economique'
        THEN GREATEST(1, CEIL(pc.estimated_gfa / 100.0 * COALESCE(plu_r.parking_per_100m2_eco, 1.0)))::int
      ELSE GREATEST(1,
        CEIL(
          GREATEST(1, FLOOR(pc.estimated_gfa / 60.0))
          * (
            0.10 * COALESCE(plu_r.parking_logement_t1, 1.0)
            + 0.25 * COALESCE(plu_r.parking_logement_t2, 1.5)
            + 0.35 * COALESCE(plu_r.parking_logement_t3, 1.5)
            + 0.20 * COALESCE(plu_r.parking_logement_t4, 1.5)
            + 0.10 * COALESCE(plu_r.parking_logement_t5, 2.0)
          )
        )
      )::int
    END AS nb_parking_places,

    -- ═══ RECETTES ═══
    -- Surface habitable = SDP × rendement (0.75)
    (pc.estimated_gfa * %(sellable_ratio)s::numeric)
    AS surface_habitable,

    -- CA = surface habitable × prix vente m²
    (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
    AS ca_total,

    -- Prix par logement = CA / nb logements
    CASE WHEN GREATEST(1, FLOOR(pc.estimated_gfa / 60.0)) > 0
      THEN (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
           / GREATEST(1, FLOOR(pc.estimated_gfa / 60.0))
      ELSE 0
    END AS prix_par_logement,

    -- ═══ DÉPENSE 1 : Marge promoteur = 8%% × CA ═══
    (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
    * %(margin_ratio)s::numeric
    AS marge_promoteur,

    -- ═══ DÉPENSE 2 : Construction = 1300 €/m² × SDP (honoraires compris) ═══
    (pc.estimated_gfa * %(construction_cost_m2)s::numeric)
    AS cout_construction,

    -- ═══ DÉPENSE 3 : VRD = 100 €/m² × surface TERRAIN ═══
    (p.area_m2 * %(vrd_cost_m2_terrain)s::numeric)
    AS cout_vrd,

    -- ═══ DÉPENSE 4 : Publicité = 2.5%% × CA ═══
    (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
    * %(commercialisation_ratio)s::numeric
    AS cout_publicite,

    -- ═══ DÉPENSE 5 : Dette = 6%% × (construction + pub + VRD) ═══
    (
      (pc.estimated_gfa * %(construction_cost_m2)s::numeric)
      + (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
        * %(commercialisation_ratio)s::numeric
      + (p.area_m2 * %(vrd_cost_m2_terrain)s::numeric)
    ) * %(frais_financiers_ratio)s::numeric
    AS cout_dette,

    -- ═══ DÉPENSE 6 : Parking souterrain = nb_places × 13 500 € ═══
    (
      CASE
        WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'economique'
          THEN GREATEST(1, CEIL(pc.estimated_gfa / 100.0 * COALESCE(plu_r.parking_per_100m2_eco, 1.0)))
        ELSE GREATEST(1,
          CEIL(
            GREATEST(1, FLOOR(pc.estimated_gfa / 60.0))
            * (
              0.10 * COALESCE(plu_r.parking_logement_t1, 1.0)
              + 0.25 * COALESCE(plu_r.parking_logement_t2, 1.5)
              + 0.35 * COALESCE(plu_r.parking_logement_t3, 1.5)
              + 0.20 * COALESCE(plu_r.parking_logement_t4, 1.5)
              + 0.10 * COALESCE(plu_r.parking_logement_t5, 2.0)
            )
          )
        )
      END * %(parking_cost_per_place)s::numeric
    ) AS cout_parking,

    -- Surface parking (m²)
    (
      CASE
        WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'economique'
          THEN GREATEST(1, CEIL(pc.estimated_gfa / 100.0 * COALESCE(plu_r.parking_per_100m2_eco, 1.0)))
        ELSE GREATEST(1,
          CEIL(
            GREATEST(1, FLOOR(pc.estimated_gfa / 60.0))
            * (
              0.10 * COALESCE(plu_r.parking_logement_t1, 1.0)
              + 0.25 * COALESCE(plu_r.parking_logement_t2, 1.5)
              + 0.35 * COALESCE(plu_r.parking_logement_t3, 1.5)
              + 0.20 * COALESCE(plu_r.parking_logement_t4, 1.5)
              + 0.10 * COALESCE(plu_r.parking_logement_t5, 2.0)
            )
          )
        )
      END * %(parking_surface_per_place)s::numeric
    ) AS surface_parking,

    -- ═══ DÉPENSE 7 : Taxe d'aménagement = SDP × 854 × taux ═══
    (pc.estimated_gfa * %(taxe_valeur_forfaitaire)s::numeric * %(taxe_taux_default)s::numeric)
    AS taxe_amenagement,

    %(taxe_taux_default)s::numeric AS ta_taux,

    -- ═══ TOTAL DÉPENSES ═══
    (
      -- 1. Marge (8% CA)
      (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
        * %(margin_ratio)s::numeric
      -- 2. Construction (1300 × SDP)
      + (pc.estimated_gfa * %(construction_cost_m2)s::numeric)
      -- 3. VRD (100 × terrain)
      + (p.area_m2 * %(vrd_cost_m2_terrain)s::numeric)
      -- 4. Publicité (2.5% CA)
      + (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
        * %(commercialisation_ratio)s::numeric
      -- 5. Dette (6% × (constr + pub + VRD))
      + (
          (pc.estimated_gfa * %(construction_cost_m2)s::numeric)
          + (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
            * %(commercialisation_ratio)s::numeric
          + (p.area_m2 * %(vrd_cost_m2_terrain)s::numeric)
        ) * %(frais_financiers_ratio)s::numeric
      -- 6. Parking
      + (
        CASE
          WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'economique'
            THEN GREATEST(1, CEIL(pc.estimated_gfa / 100.0 * COALESCE(plu_r.parking_per_100m2_eco, 1.0)))
          ELSE GREATEST(1,
            CEIL(
              GREATEST(1, FLOOR(pc.estimated_gfa / 60.0))
              * (
                0.10 * COALESCE(plu_r.parking_logement_t1, 1.0)
                + 0.25 * COALESCE(plu_r.parking_logement_t2, 1.5)
                + 0.35 * COALESCE(plu_r.parking_logement_t3, 1.5)
                + 0.20 * COALESCE(plu_r.parking_logement_t4, 1.5)
                + 0.10 * COALESCE(plu_r.parking_logement_t5, 2.0)
              )
            )
          )
        END * %(parking_cost_per_place)s::numeric
      )
      -- 7. Taxe d'aménagement
      + (pc.estimated_gfa * %(taxe_valeur_forfaitaire)s::numeric * %(taxe_taux_default)s::numeric)
    ) AS total_depenses,

    -- ═══ CHARGE FONCIÈRE = CA - total dépenses ═══
    (
      -- CA
      (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
      -- 1. Marge (8% CA)
      - (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
        * %(margin_ratio)s::numeric
      -- 2. Construction (1300 × SDP)
      - (pc.estimated_gfa * %(construction_cost_m2)s::numeric)
      -- 3. VRD (100 × terrain)
      - (p.area_m2 * %(vrd_cost_m2_terrain)s::numeric)
      -- 4. Publicité (2.5% CA)
      - (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
        * %(commercialisation_ratio)s::numeric
      -- 5. Dette (6% × (constr + pub + VRD))
      - (
          (pc.estimated_gfa * %(construction_cost_m2)s::numeric)
          + (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
            * %(commercialisation_ratio)s::numeric
          + (p.area_m2 * %(vrd_cost_m2_terrain)s::numeric)
        ) * %(frais_financiers_ratio)s::numeric
      -- 6. Parking
      - (
        CASE
          WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'economique'
            THEN GREATEST(1, CEIL(pc.estimated_gfa / 100.0 * COALESCE(plu_r.parking_per_100m2_eco, 1.0)))
          ELSE GREATEST(1,
            CEIL(
              GREATEST(1, FLOOR(pc.estimated_gfa / 60.0))
              * (
                0.10 * COALESCE(plu_r.parking_logement_t1, 1.0)
                + 0.25 * COALESCE(plu_r.parking_logement_t2, 1.5)
                + 0.35 * COALESCE(plu_r.parking_logement_t3, 1.5)
                + 0.20 * COALESCE(plu_r.parking_logement_t4, 1.5)
                + 0.10 * COALESCE(plu_r.parking_logement_t5, 2.0)
              )
            )
          )
        END * %(parking_cost_per_place)s::numeric
      )
      -- 7. Taxe d'aménagement
      - (pc.estimated_gfa * %(taxe_valeur_forfaitaire)s::numeric * %(taxe_taux_default)s::numeric)
    ) AS charge_fonciere
) bilan
-- Sous-scores
CROSS JOIN LATERAL (
  SELECT
    CASE
      WHEN pc.underuse_ratio >= 0.80 THEN 10
      WHEN pc.underuse_ratio >= 0.60 THEN 8
      WHEN pc.underuse_ratio >= 0.40 THEN 6
      WHEN pc.underuse_ratio >= 0.20 THEN 4
      ELSE 1
    END AS underuse_score,
    CASE
      WHEN pc.dominant_zone_family = 'U' THEN 9
      WHEN pc.dominant_zone_family = 'AU' THEN 7
      WHEN pc.dominant_zone_family = 'A' THEN 2
      WHEN pc.dominant_zone_family = 'N' THEN 1
      ELSE 3
    END AS zoning_score,
    CASE
      WHEN pms.median_price_m2 >= 6000 THEN 10
      WHEN pms.median_price_m2 >= 4500 THEN 8
      WHEN pms.median_price_m2 >= 3000 THEN 6
      WHEN pms.median_price_m2 >= 2000 THEN 4
      ELSE 2
    END AS market_score,
    CASE
      WHEN p.area_m2 >= 1000 THEN 9
      WHEN p.area_m2 >= 600 THEN 7
      WHEN p.area_m2 >= 300 THEN 5
      ELSE 2
    END AS size_score,
    CASE
      WHEN bilan.charge_fonciere >= 1500000 THEN 10
      WHEN bilan.charge_fonciere >= 800000 THEN 8
      WHEN bilan.charge_fonciere >= 400000 THEN 6
      WHEN bilan.charge_fonciere >= 150000 THEN 4
      ELSE 2
    END AS land_value_score
) sub
WHERE (%(insee_code)s IS NULL OR p.insee_code = %(insee_code)s)
ON CONFLICT (parcel_id) DO UPDATE SET
  mutability_score = EXCLUDED.mutability_score,
  underuse_score = EXCLUDED.underuse_score,
  zoning_score = EXCLUDED.zoning_score,
  market_score = EXCLUDED.market_score,
  size_score = EXCLUDED.size_score,
  land_value_score = EXCLUDED.land_value_score,
  best_use = EXCLUDED.best_use,
  land_value_est = EXCLUDED.land_value_est,
  program_value_est = EXCLUDED.program_value_est,
  nb_logements_est = EXCLUDED.nb_logements_est,
  nb_parking_places = EXCLUDED.nb_parking_places,
  parking_cost = EXCLUDED.parking_cost,
  parking_surface_m2 = EXCLUDED.parking_surface_m2,
  taxe_amenagement = EXCLUDED.taxe_amenagement,
  taxe_amenagement_taux = EXCLUDED.taxe_amenagement_taux,
  zone_vocation = EXCLUDED.zone_vocation,
  plu_zone_code = EXCLUDED.plu_zone_code,
  explanation_json = EXCLUDED.explanation_json,
  computed_at = now();
