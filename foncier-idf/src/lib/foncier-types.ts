export type ParcelTopItem = {
  parcel_id: string;
  insee_code: string;
  area_m2: number | null;
  mutability_score: number | null;
  best_use: string | null;
  land_value_est: number | null;
  estimated_gfa: number | null;
  residual_potential_est: number | null;
};

export type ParcelDetail = {
  parcel_id: string;
  insee_code: string;
  section: string | null;
  number: string | null;
  area_m2: number | null;
  city_name: string | null;
  mutability_score: number | null;
  best_use: string | null;
  land_value_est: number | null;
  program_value_est: number | null;
  explanation_json: Record<string, unknown> | null;
  dominant_zone_family: string | null;
  estimated_gfa: number | null;
  residual_potential_est: number | null;
  underuse_ratio: number | null;
  median_price_m2: number | null;
  hdbscan_zone_id: string | null;
  coverage_ratio: number | null;
  // PLU fields
  plu_zone_code: string | null;
  zone_vocation: string | null;
  ces_applied: number | null;
  max_height_est: number | null;
  setback_front_m: number | null;
  setback_side_m: number | null;
  // Parking & taxe
  nb_logements_est: number | null;
  nb_parking_places: number | null;
  parking_cost: number | null;
  parking_surface_m2: number | null;
  taxe_amenagement: number | null;
  taxe_amenagement_taux: number | null;
};

export type ParcelBBoxItem = {
  parcel_id: string;
  insee_code: string;
  area_m2: number | null;
  mutability_score: number | null;
  best_use: string | null;
  land_value_est: number | null;
  estimated_gfa: number | null;
  geojson: Record<string, unknown>;
};
