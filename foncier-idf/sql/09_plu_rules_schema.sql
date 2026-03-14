-- =========================================
-- DATAMERRY — Module PLU & Bilan Promoteur
-- Table de référence PLU, champs parking/taxe
-- =========================================

-- =========================
-- 1) TABLE RÉFÉRENCE PLU PAR SOUS-ZONE
-- =========================
CREATE TABLE IF NOT EXISTS public.plu_zone_rules (
  zone_code TEXT NOT NULL,
  epci_code TEXT NOT NULL DEFAULT 'BNS',  -- EPT ou EPCI (ex: BNS = Boucle Nord de Seine)
  zone_family TEXT NOT NULL,              -- U, AU, A, N
  vocation TEXT NOT NULL DEFAULT 'mixte', -- residentiel, economique, mixte
  max_height NUMERIC NOT NULL,            -- hauteur max en mètres
  ces NUMERIC NOT NULL,                   -- coefficient emprise au sol (0-1)
  cos NUMERIC,                            -- coefficient occupation sols (NULL si non plafonné)
  green_ratio NUMERIC NOT NULL DEFAULT 0.20,
  setback_front NUMERIC NOT NULL DEFAULT 5.0,  -- recul / voie (m)
  setback_side NUMERIC NOT NULL DEFAULT 3.0,   -- prospect latéral (m)
  parking_logement_t1 NUMERIC DEFAULT 1,
  parking_logement_t2 NUMERIC DEFAULT 1.5,
  parking_logement_t3 NUMERIC DEFAULT 1.5,
  parking_logement_t4 NUMERIC DEFAULT 1.5,
  parking_logement_t5 NUMERIC DEFAULT 2,
  parking_per_100m2_eco NUMERIC DEFAULT 1.0,   -- places / 100m² SDP éco
  description TEXT,
  PRIMARY KEY (zone_code, epci_code)
);

-- Insertion des règles PLU-i EPT Boucle Nord de Seine
INSERT INTO public.plu_zone_rules (zone_code, epci_code, zone_family, vocation, max_height, ces, green_ratio, setback_front, setback_side, parking_per_100m2_eco, description)
VALUES
  ('UA', 'BNS', 'U', 'mixte',        25.0, 0.80, 0.10, 0.0,  0.0,  1.0, 'Centre-ville dense, alignement sur voie, mixité fonctionnelle'),
  ('UB', 'BNS', 'U', 'residentiel',  18.0, 0.60, 0.20, 3.0,  3.0,  1.0, 'Résidentiel collectif, tissu urbain constitué'),
  ('UC', 'BNS', 'U', 'residentiel',  12.0, 0.40, 0.30, 5.0,  3.0,  1.0, 'Résidentiel pavillonnaire / petit collectif'),
  ('UD', 'BNS', 'U', 'residentiel',   9.0, 0.30, 0.40, 5.0,  4.0,  1.0, 'Résidentiel individuel / faible densité'),
  ('UE', 'BNS', 'U', 'economique',   15.0, 0.60, 0.15, 5.0,  5.0,  2.0, 'Activités économiques, bureaux, commerces'),
  ('UX', 'BNS', 'U', 'economique',   20.0, 0.65, 0.15, 5.0,  5.0,  2.5, 'Zone d''activité industrielle / logistique'),
  ('UP', 'BNS', 'U', 'mixte',        50.0, 0.70, 0.15, 0.0,  0.0,  1.5, 'Zone de projet / secteur de renouvellement urbain (OAP)'),
  ('AU', 'BNS', 'AU', 'mixte',       15.0, 0.50, 0.25, 5.0,  4.0,  1.0, 'Zone à urbaniser, constructible sous conditions'),
  ('A',  'BNS', 'A',  'residentiel',  7.0, 0.10, 0.70, 10.0, 5.0,  0.5, 'Zone agricole, construction très limitée'),
  ('N',  'BNS', 'N',  'residentiel',  7.0, 0.05, 0.80, 10.0, 10.0, 0.0, 'Zone naturelle, inconstructible sauf exceptions')
ON CONFLICT (zone_code, epci_code) DO NOTHING;

-- =========================
-- 2) AJOUT COLONNES parcel_constructibility
-- =========================
ALTER TABLE public.parcel_constructibility
  ADD COLUMN IF NOT EXISTS plu_zone_code TEXT,
  ADD COLUMN IF NOT EXISTS zone_vocation TEXT DEFAULT 'residentiel',
  ADD COLUMN IF NOT EXISTS ces_applied NUMERIC,
  ADD COLUMN IF NOT EXISTS setback_front_m NUMERIC,
  ADD COLUMN IF NOT EXISTS setback_side_m NUMERIC;

-- =========================
-- 3) AJOUT COLONNES parcel_scores (parking + taxe)
-- =========================
ALTER TABLE public.parcel_scores
  ADD COLUMN IF NOT EXISTS nb_logements_est INTEGER,
  ADD COLUMN IF NOT EXISTS nb_parking_places INTEGER,
  ADD COLUMN IF NOT EXISTS parking_cost NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS parking_surface_m2 NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxe_amenagement NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxe_amenagement_taux NUMERIC DEFAULT 0.05,
  ADD COLUMN IF NOT EXISTS zone_vocation TEXT DEFAULT 'residentiel',
  ADD COLUMN IF NOT EXISTS plu_zone_code TEXT;

-- =========================
-- 4) MISE À JOUR VIEW FRONT
-- =========================
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
  pc.plu_zone_code,
  pc.zone_vocation,
  pc.ces_applied,
  pc.max_height_est,
  pc.setback_front_m,
  pc.setback_side_m,
  pms.median_price_m2,
  pms.hdbscan_zone_id,
  COALESCE(pbs.coverage_ratio, 0) AS coverage_ratio,
  pcs.nb_logements_est,
  pcs.nb_parking_places,
  pcs.parking_cost,
  pcs.parking_surface_m2,
  pcs.taxe_amenagement,
  pcs.taxe_amenagement_taux,
  p.geom
FROM public.parcels p
LEFT JOIN public.parcel_scores pcs ON pcs.parcel_id = p.parcel_id
LEFT JOIN public.parcel_constructibility pc ON pc.parcel_id = p.parcel_id
LEFT JOIN public.parcel_market_stats pms ON pms.parcel_id = p.parcel_id
LEFT JOIN public.parcel_building_stats pbs ON pbs.parcel_id = p.parcel_id;

-- =========================
-- 5) RLS pour plu_zone_rules
-- =========================
ALTER TABLE public.plu_zone_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "plu_zone_rules_public_read" ON public.plu_zone_rules FOR SELECT USING (true);
