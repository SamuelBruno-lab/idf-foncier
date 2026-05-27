/**
 * DATAMERRY — Helper de cache mutualisé pour les datasets externes du
 * /api/property-report. S'appuie sur la table `property_report_cache`
 * (sql/23_property_report_cache.sql).
 *
 * Pourquoi un helper :
 *   - tous les datasets (écoles, transports, services, permis, INSEE, cadastre)
 *     ont besoin du même pattern : check cache → fetch source → upsert cache
 *   - chacun a son propre TTL et son propre fetcher
 *   - on évite la duplication de 6 fois le même boilerplate
 */

import { createHash } from "crypto";
import { getSupabaseServerClient } from "../supabase-server";

export type DatasetKey =
  | "streetview"
  | "cadastre"
  | "permis"
  | "ecoles"
  | "transports"
  | "services_proximite"
  | "insee_iris"
  | "dpe"
  | "idfm_journey"
  | "price_evolution"
  | "lycees_bac";

/**
 * Hash stable d'une coordonnée GPS arrondie à 4 décimales (~11m).
 * Identique à addressHashFromLatLon de streetview.ts — exposé ici pour
 * mutualisation. Tous les datasets utilisent le même hash → un seul fetch
 * par adresse réutilisé par tous les datasets.
 */
export function addressHash(lat: number, lon: number): string {
  return createHash("sha256")
    .update(`${lat.toFixed(4)}:${lon.toFixed(4)}`)
    .digest("hex");
}

/**
 * Variante pour les datasets keyés sur une commune INSEE (permis, INSEE
 * socio-démo). Préfixé pour éviter collision avec les hashes lat/lon.
 */
export function communeHash(codeInsee: string): string {
  return createHash("sha256")
    .update(`insee:${codeInsee.trim()}`)
    .digest("hex");
}

export type CachedDatasetResult<T> = {
  data: T;
  cached: boolean;
  /** Coût marginal estimé en €. 0 pour cache hit ou source gratuite. */
  cost_eur: number;
};

/**
 * Pipeline standard : check cache → fetch si miss → upsert.
 *
 * @param hash   Clé d'adresse (lat/lon) ou de commune (INSEE)
 * @param latLon Coordonnées (pour stockage debug / index spatial)
 * @param key    Identifiant du dataset
 * @param ttlDays TTL en jours (24h = 1, 30j = 30)
 * @param fetcher Fonction qui va chercher la donnée si miss cache
 * @param costEurEstimated Coût marginal de l'appel source (0 si gratuit)
 */
export async function fetchWithCache<T>(
  hash: string,
  latLon: { lat: number; lon: number },
  key: DatasetKey,
  ttlDays: number,
  fetcher: () => Promise<T>,
  costEurEstimated = 0,
): Promise<CachedDatasetResult<T>> {
  const sb = getSupabaseServerClient();

  // 1) Cache hit ?
  try {
    const { data: cached } = await sb
      .from("property_report_cache")
      .select("payload, fetched_at, expires_at")
      .eq("address_hash", hash)
      .eq("dataset_key", key)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (cached) {
      return {
        data: cached.payload as T,
        cached: true,
        cost_eur: 0,
      };
    }
  } catch (err) {
    console.warn(`[dataset cache ${key}] read failed:`, err);
    // on continue vers le fetch — pas de blocage si la table est down
  }

  // 2) Fetch source
  let data: T;
  try {
    data = await fetcher();
  } catch (err) {
    console.error(`[dataset ${key}] fetch failed:`, err);
    throw err;
  }

  // 3) Upsert cache (fire-and-forget — on log mais on ne bloque pas la réponse)
  void (async () => {
    try {
      const expires = new Date(Date.now() + ttlDays * 86_400_000);
      await sb.from("property_report_cache").upsert(
        {
          address_hash: hash,
          lat: latLon.lat,
          lon: latLon.lon,
          dataset_key: key,
          payload: data as unknown,
          fetched_at: new Date().toISOString(),
          expires_at: expires.toISOString(),
          source: key,
          source_cost_eur: costEurEstimated,
        },
        { onConflict: "address_hash,dataset_key" },
      );
    } catch (err) {
      console.warn(`[dataset cache ${key}] write failed:`, err);
    }
  })();

  return { data, cached: false, cost_eur: costEurEstimated };
}

/**
 * Distance Haversine en mètres entre 2 points GPS — réutilisé par plusieurs
 * datasets (écoles, transports, services) pour le calcul de rayon.
 */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
