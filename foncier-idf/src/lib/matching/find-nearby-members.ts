/**
 * Lead routing geo-spatial — Collabimo / DATAMERRY
 *
 * Module métier qui trouve les membres Collabimo proches d'un lead,
 * avec rayon adaptatif si pas assez de matches.
 *
 * Aucun appel direct à Supabase ici — uniquement la logique métier.
 * Les callers (API routes) passent une instance du client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Types
// ============================================================

export type MemberType =
  | "vendeur"
  | "acheteur"
  | "mandataire"
  | "apporteur";

export interface MatchingConfig {
  cabinet_slug: string;
  radius_mandataire_km: number;
  radius_apporteur_km: number;
  radius_vendeur_km: number;
  radius_acheteur_km: number;
  radius_paris_km: number;
  radius_metro_km: number;
  radius_default_km: number;
  min_matches: number;
  max_matches: number;
  adaptive_mode: boolean;
  adaptive_target_matches: number;
  adaptive_max_radius_km: number;
  show_no_match_message: string;
}

export interface NearbyMember {
  member_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  member_type: MemberType;
  city: string | null;
  postal_code: string | null;
  specialty: string | null;
  distance_km: number;
  avg_deals_per_year: number | null;
}

export interface MatchingResult {
  matches: NearbyMember[];
  radius_km_used: number;
  total_matches_found: number;
  adaptive_iterations: number;
  no_match_message?: string;
}

// ============================================================
// Densité de zone (Paris vs Métropoles vs Province)
// ============================================================

const PARIS_BBOX = {
  // Paris intra-muros (approx)
  lat_min: 48.815,
  lat_max: 48.902,
  lng_min: 2.224,
  lng_max: 2.469,
};

const METRO_CITIES = [
  // Centres approximatifs des grandes métropoles françaises
  { name: "Lyon", lat: 45.764, lng: 4.836, radius_km: 25 },
  { name: "Marseille", lat: 43.296, lng: 5.369, radius_km: 30 },
  { name: "Toulouse", lat: 43.604, lng: 1.443, radius_km: 25 },
  { name: "Bordeaux", lat: 44.838, lng: -0.578, radius_km: 25 },
  { name: "Nice", lat: 43.710, lng: 7.262, radius_km: 25 },
  { name: "Nantes", lat: 47.218, lng: -1.553, radius_km: 25 },
  { name: "Strasbourg", lat: 48.583, lng: 7.745, radius_km: 20 },
  { name: "Lille", lat: 50.629, lng: 3.057, radius_km: 25 },
  { name: "Rennes", lat: 48.117, lng: -1.677, radius_km: 20 },
  { name: "Montpellier", lat: 43.611, lng: 3.876, radius_km: 20 },
];

export type ZoneType = "paris" | "metro" | "default";

export function detectZoneType(lat: number, lng: number): ZoneType {
  if (
    lat >= PARIS_BBOX.lat_min &&
    lat <= PARIS_BBOX.lat_max &&
    lng >= PARIS_BBOX.lng_min &&
    lng <= PARIS_BBOX.lng_max
  ) {
    return "paris";
  }

  for (const city of METRO_CITIES) {
    const dist = haversineDistanceKm(lat, lng, city.lat, city.lng);
    if (dist <= city.radius_km) return "metro";
  }

  return "default";
}

// ============================================================
// Distance Haversine (km)
// ============================================================

export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ============================================================
// Calcul du rayon initial selon config + zone + type de membre
// ============================================================

export function computeInitialRadius(
  config: MatchingConfig,
  zoneType: ZoneType,
  memberTypes: MemberType[],
): number {
  // Rayon par type (max parmi les types demandés)
  let radiusByType = 0;
  for (const type of memberTypes) {
    let r = 0;
    if (type === "mandataire") r = config.radius_mandataire_km;
    else if (type === "apporteur") r = config.radius_apporteur_km;
    else if (type === "vendeur") r = config.radius_vendeur_km;
    else if (type === "acheteur") r = config.radius_acheteur_km;
    radiusByType = Math.max(radiusByType, r);
  }

  // Rayon par zone (cap selon densité)
  let radiusByZone = config.radius_default_km;
  if (zoneType === "paris") radiusByZone = config.radius_paris_km;
  else if (zoneType === "metro") radiusByZone = config.radius_metro_km;

  // On prend le MIN des 2 (le plus restrictif)
  return Math.min(radiusByType, radiusByZone);
}

// ============================================================
// Recherche des membres proches (utilise RPC Postgres)
// ============================================================

async function queryNearbyMembers(
  supabase: SupabaseClient,
  cabinetSlug: string,
  lat: number,
  lng: number,
  radiusKm: number,
  memberTypes: MemberType[],
  maxResults: number,
): Promise<NearbyMember[]> {
  const { data, error } = await supabase.rpc(
    "find_nearby_collabimo_members",
    {
      p_cabinet_slug: cabinetSlug,
      p_lead_lat: lat,
      p_lead_lng: lng,
      p_radius_km: radiusKm,
      p_member_types: memberTypes,
      p_max_results: maxResults,
    },
  );
  if (error) {
    throw new Error(`Matching query failed: ${error.message}`);
  }
  return (data ?? []) as NearbyMember[];
}

// ============================================================
// Récupération config matching
// ============================================================

export async function getMatchingConfig(
  supabase: SupabaseClient,
  cabinetSlug: string,
): Promise<MatchingConfig> {
  const { data, error } = await supabase
    .from("matching_config")
    .select("*")
    .eq("cabinet_slug", cabinetSlug)
    .single();

  if (error || !data) {
    // Fallback : config par défaut
    return {
      cabinet_slug: cabinetSlug,
      radius_mandataire_km: 30,
      radius_apporteur_km: 100,
      radius_vendeur_km: 50,
      radius_acheteur_km: 25,
      radius_paris_km: 5,
      radius_metro_km: 15,
      radius_default_km: 50,
      min_matches: 1,
      max_matches: 10,
      adaptive_mode: true,
      adaptive_target_matches: 5,
      adaptive_max_radius_km: 500,
      show_no_match_message:
        "Aucun membre Collabimo trouvé proche du bien. Le lead sera traité directement par notre équipe.",
    };
  }
  return data as MatchingConfig;
}

// ============================================================
// Fonction principale : findNearbyMembers
// ============================================================

export interface FindNearbyArgs {
  supabase: SupabaseClient;
  cabinetSlug: string;
  leadLat: number;
  leadLng: number;
  memberTypes?: MemberType[];
}

export async function findNearbyMembers({
  supabase,
  cabinetSlug,
  leadLat,
  leadLng,
  memberTypes = ["vendeur", "acheteur", "mandataire", "apporteur"],
}: FindNearbyArgs): Promise<MatchingResult> {
  const config = await getMatchingConfig(supabase, cabinetSlug);
  const zoneType = detectZoneType(leadLat, leadLng);

  // 1. Calcul du rayon initial
  let radius = computeInitialRadius(config, zoneType, memberTypes);

  // 2. Première requête
  let matches = await queryNearbyMembers(
    supabase,
    cabinetSlug,
    leadLat,
    leadLng,
    radius,
    memberTypes,
    config.max_matches,
  );

  let iterations = 0;

  // 3. Mode adaptatif : élargit progressivement jusqu'à atteindre la cible
  if (
    config.adaptive_mode &&
    matches.length < config.adaptive_target_matches
  ) {
    while (
      matches.length < config.adaptive_target_matches &&
      radius < config.adaptive_max_radius_km
    ) {
      iterations++;
      radius = Math.min(
        Math.round(radius * 1.5),
        config.adaptive_max_radius_km,
      );
      matches = await queryNearbyMembers(
        supabase,
        cabinetSlug,
        leadLat,
        leadLng,
        radius,
        memberTypes,
        config.max_matches,
      );
    }
  }

  return {
    matches,
    radius_km_used: radius,
    total_matches_found: matches.length,
    adaptive_iterations: iterations,
    no_match_message:
      matches.length === 0 ? config.show_no_match_message : undefined,
  };
}
