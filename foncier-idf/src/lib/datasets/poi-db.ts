/**
 * DATAMERRY — Lecture des POI depuis la table dim_poi Supabase.
 *
 * Source de vérité officielle : Mérimée (Monuments Historiques classés) +
 * Wikidata (musées + parcs + places + églises + châteaux + opéras + théâtres
 * + sites archéologiques avec article Wikipedia).
 *
 * Alimentée par pipeline_poi.py (ingestion annuelle). ~80-100k POI France.
 *
 * Utilise la fonction Postgres find_nearby_poi(lat, lon, max_distance_m, limit)
 * qui combine distance Haversine + score notabilité (Wikipedia, statut MH).
 *
 * Sub-5ms grâce aux index B-tree lat/lon + dept.
 */

import { createClient } from "@supabase/supabase-js";

export type PoiDbRow = {
  id: string;
  nom: string;
  type: string;
  categorie: string | null;
  wikipedia_url: string | null;
  lat: number;
  lon: number;
  distance_m: number;
  notabilite_score: number;
};

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Renvoie les POI les plus proches + notables d'un point GPS.
 *
 * @param lat - Latitude WGS84
 * @param lon - Longitude WGS84
 * @param max_distance_m - Distance max en mètres (défaut 2 km)
 * @param limit - Nb de résultats max (défaut 5)
 * @returns liste de POI triés par (distance pénalisée - notabilité × 5) croissant
 */
export async function findNearbyPoiFromDb(
  lat: number,
  lon: number,
  max_distance_m = 2000,
  limit = 5,
): Promise<PoiDbRow[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("find_nearby_poi", {
      p_lat: lat,
      p_lon: lon,
      p_max_distance_m: max_distance_m,
      p_limit: limit,
    });
    if (error) {
      console.warn("[poi-db] RPC error:", error.message);
      return [];
    }
    if (!data || !Array.isArray(data)) return [];
    return data as PoiDbRow[];
  } catch (err) {
    console.warn("[poi-db] exception:", err);
    return [];
  }
}
