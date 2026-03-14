-- Calcule la constructibilité par parcelle en utilisant les règles PLU par sous-zone.
-- Utilise la table plu_zone_rules si disponible, sinon fallback sur les défauts.
--
-- Logique de prospect :
--   1. Emprise constructible = min(area × CES, area × (1 - green_ratio))
--   2. Déduction reculs : réduction proportionnelle aux setbacks front + side
--   3. Hauteur → nombre d'étages (hauteur / 3.0m pour étage courant)
--   4. GFA = emprise × étages
--   5. Résiduel = GFA - existant
--   6. Sous-exploitation = 1 - (existant / GFA max)

INSERT INTO public.parcel_constructibility (
  parcel_id,
  dominant_zone_family,
  plu_zone_code,
  zone_vocation,
  max_height_est,
  max_footprint_ratio_est,
  ces_applied,
  min_green_ratio_est,
  setback_penalty_est,
  setback_front_m,
  setback_side_m,
  parking_penalty_est,
  buildable_footprint_est,
  floors_est,
  estimated_gfa,
  residual_potential_est,
  underuse_ratio,
  updated_at
)
SELECT
  p.parcel_id,

  COALESCE(plu.zone_family, 'U') AS dominant_zone_family,
  plu.zone_code AS plu_zone_code,
  COALESCE(plu.vocation, 'residentiel') AS zone_vocation,

  COALESCE(plu.max_height, %(default_max_height_u)s::numeric) AS max_height_est,
  COALESCE(plu.ces, %(default_max_footprint_u)s::numeric) AS max_footprint_ratio_est,
  COALESCE(plu.ces, %(default_max_footprint_u)s::numeric) AS ces_applied,
  COALESCE(plu.green_ratio, %(default_green_ratio_u)s::numeric) AS min_green_ratio_est,

  -- Pénalité de recul : on calcule la réduction d'emprise due aux prospects
  -- Approche simplifiée : on considère la parcelle carrée de côté sqrt(area)
  -- et on déduit les reculs (front + 2×side)
  CASE
    WHEN COALESCE(plu.setback_front, 0) + COALESCE(plu.setback_side, 0) = 0 THEN 1.0
    ELSE GREATEST(0.5,
      (GREATEST(0, SQRT(p.area_m2) - COALESCE(plu.setback_front, 0) - COALESCE(plu.setback_side, 0))
       * GREATEST(0, SQRT(p.area_m2) - 2 * COALESCE(plu.setback_side, 0)))
      / NULLIF(p.area_m2, 0)
    )
  END AS setback_penalty_est,

  COALESCE(plu.setback_front, 0) AS setback_front_m,
  COALESCE(plu.setback_side, 0) AS setback_side_m,

  1.0 AS parking_penalty_est,  -- Plus de pénalité forfaitaire, on calcule le vrai coût parking dans les scores

  -- Emprise constructible = min(area × CES, area × (1 - green_ratio)) × setback_penalty
  buildable.footprint AS buildable_footprint_est,

  buildable.floors AS floors_est,

  buildable.gfa AS estimated_gfa,

  GREATEST(0, buildable.gfa - COALESCE(bs.existing_gfa_est, 0)) AS residual_potential_est,

  CASE
    WHEN buildable.gfa > 0
    THEN GREATEST(0, 1 - (COALESCE(bs.existing_gfa_est, 0) / buildable.gfa))
    ELSE 0
  END AS underuse_ratio,

  now() AS updated_at

FROM public.parcels p
LEFT JOIN public.parcel_building_stats bs
  ON bs.parcel_id = p.parcel_id
-- Jointure PLU : on cherche d'abord la sous-zone, sinon fallback
LEFT JOIN public.plu_zone_rules plu
  ON plu.zone_code = COALESCE(
    -- TODO: quand on aura le zonage PLU géographique, utiliser une jointure spatiale ici
    -- Pour l'instant on utilise une heuristique basée sur la couverture + surface
    CASE
      WHEN COALESCE(bs.coverage_ratio, 0) > 0.60 THEN 'UA'  -- très dense → centre-ville
      WHEN COALESCE(bs.coverage_ratio, 0) > 0.35 THEN 'UB'  -- dense → collectif
      WHEN p.area_m2 < 500 AND COALESCE(bs.coverage_ratio, 0) > 0.15 THEN 'UC'  -- petit → pavillonnaire
      WHEN p.area_m2 >= 2000 AND COALESCE(bs.coverage_ratio, 0) < 0.10 THEN 'UE' -- grand vide → éco
      ELSE 'UC'  -- défaut pavillonnaire
    END, 'UC'
  )
  AND plu.epci_code = 'BNS'
-- Calcul intermédiaire emprise, étages, GFA
CROSS JOIN LATERAL (
  SELECT
    -- Emprise constructible
    LEAST(
      p.area_m2 * COALESCE(plu.ces, %(default_max_footprint_u)s::numeric),
      p.area_m2 * (1 - COALESCE(plu.green_ratio, %(default_green_ratio_u)s::numeric))
    )
    -- × pénalité de recul
    * CASE
        WHEN COALESCE(plu.setback_front, 0) + COALESCE(plu.setback_side, 0) = 0 THEN 1.0
        ELSE GREATEST(0.5,
          (GREATEST(0, SQRT(p.area_m2) - COALESCE(plu.setback_front, 0) - COALESCE(plu.setback_side, 0))
           * GREATEST(0, SQRT(p.area_m2) - 2 * COALESCE(plu.setback_side, 0)))
          / NULLIF(p.area_m2, 0)
        )
      END
    AS footprint,

    -- Nombre d'étages (3.0m par étage courant, RDC = 3.5m → on utilise 3.0 en moyenne)
    GREATEST(1, FLOOR(COALESCE(plu.max_height, %(default_max_height_u)s::numeric) / 3.0))::int
    AS floors,

    -- GFA = emprise × étages (pas de parking_penalty forfaitaire)
    LEAST(
      p.area_m2 * COALESCE(plu.ces, %(default_max_footprint_u)s::numeric),
      p.area_m2 * (1 - COALESCE(plu.green_ratio, %(default_green_ratio_u)s::numeric))
    )
    * CASE
        WHEN COALESCE(plu.setback_front, 0) + COALESCE(plu.setback_side, 0) = 0 THEN 1.0
        ELSE GREATEST(0.5,
          (GREATEST(0, SQRT(p.area_m2) - COALESCE(plu.setback_front, 0) - COALESCE(plu.setback_side, 0))
           * GREATEST(0, SQRT(p.area_m2) - 2 * COALESCE(plu.setback_side, 0)))
          / NULLIF(p.area_m2, 0)
        )
      END
    * GREATEST(1, FLOOR(COALESCE(plu.max_height, %(default_max_height_u)s::numeric) / 3.0))
    AS gfa
) buildable
WHERE (%(insee_code)s IS NULL OR p.insee_code = %(insee_code)s)
ON CONFLICT (parcel_id) DO UPDATE SET
  dominant_zone_family = EXCLUDED.dominant_zone_family,
  plu_zone_code = EXCLUDED.plu_zone_code,
  zone_vocation = EXCLUDED.zone_vocation,
  max_height_est = EXCLUDED.max_height_est,
  max_footprint_ratio_est = EXCLUDED.max_footprint_ratio_est,
  ces_applied = EXCLUDED.ces_applied,
  min_green_ratio_est = EXCLUDED.min_green_ratio_est,
  setback_penalty_est = EXCLUDED.setback_penalty_est,
  setback_front_m = EXCLUDED.setback_front_m,
  setback_side_m = EXCLUDED.setback_side_m,
  parking_penalty_est = EXCLUDED.parking_penalty_est,
  buildable_footprint_est = EXCLUDED.buildable_footprint_est,
  floors_est = EXCLUDED.floors_est,
  estimated_gfa = EXCLUDED.estimated_gfa,
  residual_potential_est = EXCLUDED.residual_potential_est,
  underuse_ratio = EXCLUDED.underuse_ratio,
  updated_at = now();
