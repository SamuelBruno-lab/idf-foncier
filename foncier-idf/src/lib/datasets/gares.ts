/**
 * DATAMERRY — Référentiel officiel des gares (SNCF + IDFM).
 *
 * Source : table public.dim_gares (alimentée par pipeline_gares_idf.py).
 *
 * Avantage vs Overpass OSM :
 *   - source officielle déterministe (SNCF + IDF Mobilités)
 *   - latence < 5ms (DB Supabase indexée)
 *   - couverture 100% RER + Transilien + Métro Paris + Tram + SNCF mainline
 *   - filtrage par dept / type / voyageurs intégré
 *
 * Utilisé par paris-distance.computeParisDistance pour identifier la
 * "première gare" avec garantie d'exactitude.
 */

import { createClient } from "@supabase/supabase-js";

export type Gare = {
  id: string;
  nom: string;
  type: "rer" | "transilien" | "metro" | "sncf" | "tram" | "autre";
  lignes: string[] | null;
  reseau: string | null;
  lat: number;
  lon: number;
  code_insee_commune: string | null;
  distance_km: number;
  walk_minutes: number;
};

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Trouve la gare la plus proche d'un point GPS, en priorisant les types
 * majeurs (RER > Transilien > Métro > SNCF > Tram).
 *
 * Utilise la fonction Postgres `find_nearest_gare` qui fait :
 *   1. Pre-filter par bounding box (rapide grâce aux index B-tree)
 *   2. Tri Haversine exact
 *   3. Priorisation par type
 *
 * @param lat - Latitude du point
 * @param lon - Longitude du point
 * @param maxDistanceKm - Distance maximale de recherche (défaut 20 km)
 * @returns La gare la plus proche, ou null si rien dans le rayon
 */
export async function findNearestGare(
  lat: number,
  lon: number,
  maxDistanceKm = 20,
): Promise<Gare | null> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("find_nearest_gare", {
      p_lat: lat,
      p_lon: lon,
      p_max_distance_km: maxDistanceKm,
    });

    if (error) {
      // Probable cause : table pas encore créée ou pipeline pas tournée.
      // On log mais on ne throw pas → l'appelant doit avoir un fallback OSM.
      console.warn("[gares] find_nearest_gare RPC error:", error.message);
      return null;
    }
    if (!data || data.length === 0) return null;

    const row = data[0] as Gare;
    return {
      id: row.id,
      nom: row.nom,
      type: row.type,
      lignes: row.lignes,
      reseau: row.reseau,
      lat: row.lat,
      lon: row.lon,
      code_insee_commune: row.code_insee_commune,
      distance_km: Number(row.distance_km),
      walk_minutes: Number(row.walk_minutes),
    };
  } catch (err) {
    console.warn("[gares] findNearestGare exception:", err);
    return null;
  }
}
