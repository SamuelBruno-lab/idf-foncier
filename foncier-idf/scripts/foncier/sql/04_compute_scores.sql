-- Calcule le score final de mutabilité par parcelle.
-- Intègre :
--   - Bilan promoteur avec coût parking souterrain réel
--   - Taxe d'aménagement (valeur forfaitaire IDF × taux communal)
--   - Vocation de zone (résidentiel / économique / mixte)
--   - Best_use tenant compte de la vocation PLU

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

  -- Best use tenant compte de la VOCATION de la zone PLU
  CASE
    -- Zones à vocation économique → pas de résidentiel
    WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'economique'
      THEN CASE
        WHEN p.area_m2 >= 2000 AND pc.underuse_ratio >= 0.70
          THEN 'activite_economique'
        WHEN p.area_m2 >= 500 AND pc.underuse_ratio >= 0.50
          THEN 'bureaux_commerces'
        ELSE 'analyse_complementaire'
      END
    -- Zones résidentielles ou mixtes
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
        -- Zones mixtes grandes parcelles → possibilité éco
        WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'mixte'
             AND p.area_m2 >= 2000
             AND pc.underuse_ratio >= 0.60
          THEN 'mixte_logements_activite'
        ELSE 'analyse_complementaire'
      END
    ELSE 'analyse_complementaire'
  END AS best_use,

  bilan.land_value_est AS land_value_est,
  bilan.program_value_est AS program_value_est,
  bilan.nb_logements AS nb_logements_est,
  bilan.nb_parking_places AS nb_parking_places,
  bilan.parking_cost AS parking_cost,
  bilan.parking_surface_m2 AS parking_surface_m2,
  bilan.taxe_amenagement AS taxe_amenagement,
  bilan.ta_taux AS taxe_amenagement_taux,
  COALESCE(pc.zone_vocation, 'residentiel') AS zone_vocation,
  pc.plu_zone_code,

  jsonb_build_object(
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
    'nb_logements_est', bilan.nb_logements,
    'nb_parking_places', bilan.nb_parking_places,
    'parking_cost', bilan.parking_cost,
    'parking_surface_m2', bilan.parking_surface_m2,
    'taxe_amenagement', bilan.taxe_amenagement,
    'taxe_amenagement_taux', bilan.ta_taux,
    'program_value_est', bilan.program_value_est,
    'construction_cost_total', bilan.construction_cost_total,
    'land_value_est', bilan.land_value_est
  ) AS explanation_json,

  now() AS computed_at

FROM public.parcels p
JOIN public.parcel_constructibility pc
  ON pc.parcel_id = p.parcel_id
LEFT JOIN public.parcel_market_stats pms
  ON pms.parcel_id = p.parcel_id
LEFT JOIN public.parcel_building_stats bs
  ON bs.parcel_id = p.parcel_id
-- Bilan promoteur complet avec parking + taxe d'aménagement
CROSS JOIN LATERAL (
  SELECT
    -- Nombre de logements estimé (SDP vendable / 65 m² moyen par logement)
    GREATEST(1,
      FLOOR(pc.estimated_gfa * %(sellable_ratio)s::numeric / 65.0)
    )::int AS nb_logements,

    -- Nombre de places parking selon PLU
    -- Mix typologique : T1=10%%, T2=25%%, T3=35%%, T4=20%%, T5=10%%
    -- Places par typo : T1=1, T2=1.5, T3=1.5, T4=1.5, T5=2
    -- Moyenne pondérée = 0.10×1 + 0.25×1.5 + 0.35×1.5 + 0.20×1.5 + 0.10×2 = 1.5 place/logement
    CASE
      WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'economique'
        THEN GREATEST(1, CEIL(pc.estimated_gfa / 100.0 * COALESCE(plu_r.parking_per_100m2_eco, 1.0)))::int
      ELSE GREATEST(1,
        CEIL(
          GREATEST(1, FLOOR(pc.estimated_gfa * %(sellable_ratio)s::numeric / 65.0))
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

    -- Coût parking souterrain = nb_places × 13 500 €/place
    CASE
      WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'economique'
        THEN GREATEST(1, CEIL(pc.estimated_gfa / 100.0 * COALESCE(plu_r.parking_per_100m2_eco, 1.0)))
             * %(parking_cost_per_place)s::numeric
      ELSE GREATEST(1,
        CEIL(
          GREATEST(1, FLOOR(pc.estimated_gfa * %(sellable_ratio)s::numeric / 65.0))
          * (
            0.10 * COALESCE(plu_r.parking_logement_t1, 1.0)
            + 0.25 * COALESCE(plu_r.parking_logement_t2, 1.5)
            + 0.35 * COALESCE(plu_r.parking_logement_t3, 1.5)
            + 0.20 * COALESCE(plu_r.parking_logement_t4, 1.5)
            + 0.10 * COALESCE(plu_r.parking_logement_t5, 2.0)
          )
        )
      ) * %(parking_cost_per_place)s::numeric
    END AS parking_cost,

    -- Surface parking (27 m²/place)
    CASE
      WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'economique'
        THEN GREATEST(1, CEIL(pc.estimated_gfa / 100.0 * COALESCE(plu_r.parking_per_100m2_eco, 1.0)))
             * %(parking_surface_per_place)s::numeric
      ELSE GREATEST(1,
        CEIL(
          GREATEST(1, FLOOR(pc.estimated_gfa * %(sellable_ratio)s::numeric / 65.0))
          * (
            0.10 * COALESCE(plu_r.parking_logement_t1, 1.0)
            + 0.25 * COALESCE(plu_r.parking_logement_t2, 1.5)
            + 0.35 * COALESCE(plu_r.parking_logement_t3, 1.5)
            + 0.20 * COALESCE(plu_r.parking_logement_t4, 1.5)
            + 0.10 * COALESCE(plu_r.parking_logement_t5, 2.0)
          )
        )
      ) * %(parking_surface_per_place)s::numeric
    END AS parking_surface_m2,

    -- Taxe d'aménagement = SDP × valeur forfaitaire × taux communal
    pc.estimated_gfa * %(taxe_valeur_forfaitaire)s::numeric * %(taxe_taux_default)s::numeric
    AS taxe_amenagement,

    %(taxe_taux_default)s::numeric AS ta_taux,

    -- Chiffre d'affaires programme
    (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
    AS program_value_est,

    -- Coût construction total
    (pc.estimated_gfa * %(construction_cost_m2)s::numeric)
    + (pc.estimated_gfa * %(vrd_cost_m2)s::numeric)
    AS construction_cost_total,

    -- Charge foncière résiduelle = CA - construction - parking - taxe - frais - marge
    (
      -- CA programme
      (pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0))
      -- Construction + VRD
      - (pc.estimated_gfa * %(construction_cost_m2)s::numeric)
      - (pc.estimated_gfa * %(vrd_cost_m2)s::numeric)
      -- Parking souterrain
      - (
        CASE
          WHEN COALESCE(pc.zone_vocation, 'residentiel') = 'economique'
            THEN GREATEST(1, CEIL(pc.estimated_gfa / 100.0 * COALESCE(plu_r.parking_per_100m2_eco, 1.0)))
          ELSE GREATEST(1,
            CEIL(
              GREATEST(1, FLOOR(pc.estimated_gfa * %(sellable_ratio)s::numeric / 65.0))
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
      -- Taxe d'aménagement
      - (pc.estimated_gfa * %(taxe_valeur_forfaitaire)s::numeric * %(taxe_taux_default)s::numeric)
      -- Frais de commercialisation
      - ((pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0)) * %(sales_fee_ratio)s::numeric)
      -- Marge promoteur
      - ((pc.estimated_gfa * %(sellable_ratio)s::numeric * COALESCE(pms.median_price_m2, 0)) * %(margin_ratio)s::numeric)
    ) AS land_value_est
) bilan
-- Jointure PLU pour les ratios parking par typo
LEFT JOIN public.plu_zone_rules plu_r
  ON plu_r.zone_code = pc.plu_zone_code
  AND plu_r.epci_code = 'BNS'
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
      WHEN bilan.land_value_est >= 1500000 THEN 10
      WHEN bilan.land_value_est >= 800000 THEN 8
      WHEN bilan.land_value_est >= 400000 THEN 6
      WHEN bilan.land_value_est >= 150000 THEN 4
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
