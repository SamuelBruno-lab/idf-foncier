-- =========================================
-- DATAMERRY — Surface habitable cascade
-- Ajoute surface habitable reelle (DPE / DVF)
-- avec fallback sur estimation BD TOPO
-- =========================================

-- 1) Nouvelle table pour stocker les surfaces habitable reelles par parcelle
CREATE TABLE IF NOT EXISTS public.parcel_surface_habitable (
  parcel_id TEXT PRIMARY KEY REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
  -- Surface habitable reelle (m²) — provenant de DPE ou DVF
  surface_habitable_reelle NUMERIC,
  -- Source: 'dpe', 'dvf', 'estimation'
  surface_hab_source TEXT NOT NULL DEFAULT 'estimation',
  -- Nombre de DPE trouves pour la parcelle
  dpe_count INTEGER DEFAULT 0,
  -- Date du DPE le plus recent
  dpe_date_dernier DATE,
  -- Surface DVF (surface_reelle_bati de la derniere transaction)
  surface_dvf NUMERIC,
  -- Date derniere transaction DVF
  dvf_date_derniere DATE,
  -- Surface estimee BD TOPO (emprise × niveaux × 0.85)
  surface_estimation NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcel_surface_hab_source
  ON public.parcel_surface_habitable (surface_hab_source);

-- RLS
ALTER TABLE public.parcel_surface_habitable ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "parcel_surface_habitable_public_read"
  ON public.parcel_surface_habitable FOR SELECT USING (true);

-- 2) Mettre a jour la vue v_parcel_foncier pour inclure la surface habitable
CREATE OR REPLACE VIEW public.v_parcel_foncier AS
SELECT
  p.parcel_id,
  p.insee_code,
  p.section,
  p.number,
  p.area_m2,
  p.city_name,
  pcs.mutability_score,
  pcs.best_use,
  pcs.land_value_est,
  pcs.program_value_est,
  pcs.explanation_json,
  pc.dominant_zone_family,
  pc.estimated_gfa,
  pc.residual_potential_est,
  pc.underuse_ratio,
  pms.median_price_m2,
  pms.hdbscan_zone_id,
  COALESCE(pbs.coverage_ratio, 0) AS coverage_ratio,
  -- Bati existant
  COALESCE(pbs.existing_gfa_est, 0) AS existing_gfa_est,
  COALESCE(pbs.built_footprint_m2, 0) AS built_footprint_m2,
  COALESCE(pbs.building_count, 0) AS building_count,
  -- PLU (from constructibility)
  pc.plu_zone_code,
  pc.ces_applied,
  pc.max_height_est,
  pc.setback_front_m,
  pc.setback_side_m,
  -- Vocation & parking (from scores)
  pcs.zone_vocation,
  pcs.nb_logements_est,
  pcs.nb_parking_places,
  pcs.parking_cost,
  pcs.parking_surface_m2,
  pcs.taxe_amenagement,
  pcs.taxe_amenagement_taux,
  -- Surface habitable cascade
  psh.surface_habitable_reelle,
  psh.surface_hab_source,
  psh.dpe_count,
  psh.surface_dvf,
  psh.surface_estimation,
  p.geom
FROM public.parcels p
LEFT JOIN public.parcel_scores pcs ON pcs.parcel_id = p.parcel_id
LEFT JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id = p.parcel_id
LEFT JOIN public.parcel_building_stats pbs ON pbs.parcel_id = p.parcel_id
LEFT JOIN public.parcel_surface_habitable psh ON psh.parcel_id = p.parcel_id;

-- 3) Fonction RPC pour obtenir les centroides des parcelles en WGS84
--    Utilisee par l'enrichissement DPE pour le geo-matching
CREATE OR REPLACE FUNCTION public.parcels_centroids_wgs84(code_insee TEXT)
RETURNS TABLE (
  parcel_id TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  existing_gfa_est NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    p.parcel_id,
    ST_Y(ST_Centroid(ST_Transform(p.geom, 4326))) AS lat,
    ST_X(ST_Centroid(ST_Transform(p.geom, 4326))) AS lon,
    COALESCE(pbs.existing_gfa_est, 0) AS existing_gfa_est
  FROM public.parcels p
  LEFT JOIN public.parcel_building_stats pbs ON pbs.parcel_id = p.parcel_id
  WHERE p.insee_code = code_insee;
$$;
