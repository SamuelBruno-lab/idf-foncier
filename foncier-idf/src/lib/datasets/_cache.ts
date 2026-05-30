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
  // v2 : fallback radius 400m si polygon HDBSCAN trop étroit
  | "price_evolution_v2"
  // v3 : fallback ULTIME radius_only quand aucun cluster HDBSCAN ne matche
  // (élimine 'no_cluster_in_commune', 'no_match', 'no_points_in_cluster',
  // 'no_year_with_min_ventes' qui bascullaient à commune-only)
  | "price_evolution_v3"
  | "lycees_bac"
  | "lycees_bac_5km"
  | "points_interet"
  // ecoles_v2 : bump pour purger les caches négatifs accumulés (timeouts
  // antérieurs sur data.education.gouv.fr) et activer shouldCache.
  | "ecoles_v2"
  // ecoles_v3 : rayon élargi 1.5km → 2.5km pour capturer le lycée en banlieue
  | "ecoles_v3"
  // Ajouts pour les 3 nouveaux helpers (commit 242843b)
  | "price_ceiling"
  // v2 du plafond commune : invalidation cache après refonte logique
  // (P95 bucket + P95 global croisés, capping même en confiance low)
  | "price_ceiling_v2"
  | "surface_adjustment"
  | "proximite_locale"
  // v2 : Overpass cascade 3 mirrors + fallback nom + timeout 20s
  | "proximite_locale_v2"
  // v3 : DB dim_poi_local en priorité + shouldCache (purge caches vides)
  | "proximite_locale_v3";

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
  /**
   * Callback optionnel : si fourni et qu'il renvoie false sur le résultat du
   * fetch, on SKIP la mise en cache. Évite que des résultats "vides" (ex:
   * Overpass timeout → count: 0) empoisonnent le cache pour 30 jours.
   * Si non fourni, on cache toujours (comportement legacy).
   */
  shouldCache?: (data: T) => boolean,
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
  }

  // 2) Fetch source
  let data: T;
  try {
    data = await fetcher();
  } catch (err) {
    console.error(`[dataset ${key}] fetch failed:`, err);
    throw err;
  }

  // 3) Upsert cache (fire-and-forget) — SAUF si shouldCache() refuse
  const wantCache = shouldCache ? shouldCache(data) : true;
  if (wantCache) {
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
  } else {
    console.log(`[dataset ${key}] result empty/unavailable — skipping cache write`);
  }

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
