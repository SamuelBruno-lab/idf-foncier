/**
 * DATAMERRY — Récupération d'une vue Streetview pour une adresse.
 *
 * Stratégie "Walmart-friendly" :
 *   1. Cache Supabase (TTL 30 jours) — hit = 0€
 *   2. Mapillary (open-source, gratuit illimité) — couverture France ~70%
 *   3. Google Streetview Static API (fallback) — 28k images/mo gratuites,
 *      puis 7$/1000 ≈ 0.0065€/image
 *
 * Le coût marginal moyen pour 100 cabinets en régime de croisière est
 * estimé à < 30€/mo (≤ 0.30€/cabinet) grâce au cache + Mapillary first.
 *
 * Cache strategy :
 *   - Une adresse hashée (lat,lon arrondis 4 décimales ≈ 11m) → 1 ligne cache
 *   - On stocke l'URL signée Google (valide 30j) ou l'URL Mapillary stable
 *   - On NE stocke PAS le blob d'image (économise du storage Supabase),
 *     juste l'URL. Le navigateur du cabinet la consomme directement.
 */

import { createHash } from "crypto";
import { getSupabaseServerClient } from "./supabase-server";

const CACHE_TTL_DAYS = 30;
const MAPILLARY_RADIUS_M = 50; // cherche une image à ≤50m de l'adresse
const GOOGLE_HEADING = 0; // 0 = nord ; certains acteurs préfèrent calculer
const GOOGLE_SIZE = "640x400";
const GOOGLE_FOV = 90;

export type StreetviewResult = {
  available: boolean;
  source: "mapillary" | "google" | "none";
  image_url: string | null;
  attribution: string;
  copyright: string | null;
  captured_at: string | null;
  /** True si la donnée vient du cache (donc gratuite cette fois-ci). */
  cached: boolean;
  /** Coût estimé en € (0 si Mapillary ou cache). */
  cost_eur: number;
};

/**
 * Hash stable d'une coordonnée GPS arrondie à 4 décimales (~11m).
 * Permet de hit le cache même si l'adresse est tapée différemment.
 */
export function addressHashFromLatLon(lat: number, lon: number): string {
  const rounded = `${lat.toFixed(4)}:${lon.toFixed(4)}`;
  return createHash("sha256").update(rounded).digest("hex");
}

// ──────────────────────────────────────────────────────────────────────────────
// Cache Supabase
// ──────────────────────────────────────────────────────────────────────────────

async function readFromCache(
  addressHash: string,
): Promise<StreetviewResult | null> {
  const sb = getSupabaseServerClient();
  const { data, error } = await sb
    .from("property_report_cache")
    .select("payload, source, fetched_at, expires_at")
    .eq("address_hash", addressHash)
    .eq("dataset_key", "streetview")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;

  const payload = data.payload as Omit<StreetviewResult, "cached" | "cost_eur">;
  return { ...payload, cached: true, cost_eur: 0 };
}

async function writeToCache(
  addressHash: string,
  lat: number,
  lon: number,
  result: StreetviewResult,
): Promise<void> {
  const sb = getSupabaseServerClient();
  const expires = new Date(Date.now() + CACHE_TTL_DAYS * 86_400_000);

  // upsert
  await sb.from("property_report_cache").upsert(
    {
      address_hash: addressHash,
      lat,
      lon,
      dataset_key: "streetview",
      payload: {
        available: result.available,
        source: result.source,
        image_url: result.image_url,
        attribution: result.attribution,
        copyright: result.copyright,
        captured_at: result.captured_at,
      },
      fetched_at: new Date().toISOString(),
      expires_at: expires.toISOString(),
      source: result.source,
      source_cost_eur: result.cost_eur,
    },
    { onConflict: "address_hash,dataset_key" },
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Source 1 : Mapillary (gratuit illimité)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Mapillary Graph API v4 — recherche d'images à proximité.
 * Token gratuit illimité à demander sur https://www.mapillary.com/dashboard/developers
 * Variable env : MAPILLARY_TOKEN
 */
async function tryMapillary(
  lat: number,
  lon: number,
): Promise<StreetviewResult | null> {
  const token = process.env.MAPILLARY_TOKEN?.trim();
  if (!token) return null;

  // bbox approximative ~50m autour du point
  const dLat = MAPILLARY_RADIUS_M / 111_320;
  const dLon = MAPILLARY_RADIUS_M / (111_320 * Math.cos((lat * Math.PI) / 180));
  const bbox = `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`;

  const url =
    `https://graph.mapillary.com/images` +
    `?access_token=${token}` +
    `&fields=id,thumb_1024_url,captured_at` +
    `&bbox=${bbox}` +
    `&limit=1`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      // Mapillary peut être lent, on cap à 4s
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        thumb_1024_url?: string;
        captured_at?: number;
      }>;
    };

    const img = json.data?.[0];
    if (!img?.thumb_1024_url) return null;

    return {
      available: true,
      source: "mapillary",
      image_url: img.thumb_1024_url,
      attribution: "© Contributeurs Mapillary (CC-BY-SA)",
      copyright: "CC-BY-SA",
      captured_at: img.captured_at
        ? new Date(img.captured_at).toISOString()
        : null,
      cached: false,
      cost_eur: 0,
    };
  } catch (err) {
    console.warn("[streetview] Mapillary failed:", err);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Source 2 : Google Streetview Static API (fallback payant)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Google Streetview Static API.
 * Variable env : GOOGLE_STREETVIEW_API_KEY
 *
 * Tarif : 28 000 images/mo gratuites (crédit Google Cloud 200$), puis 7$/1000.
 * On signe pas l'URL ici (premium feature) — la clé est exposée dans l'URL
 * mais restreinte par referrer côté Google Cloud Console.
 */
async function tryGoogle(
  lat: number,
  lon: number,
): Promise<StreetviewResult | null> {
  const key = process.env.GOOGLE_STREETVIEW_API_KEY?.trim();
  if (!key) return null;

  // 1) Probe via Metadata API (gratuit, dit si l'image existe AVANT de la load)
  const metaUrl =
    `https://maps.googleapis.com/maps/api/streetview/metadata` +
    `?location=${lat},${lon}` +
    `&key=${key}`;

  try {
    const metaRes = await fetch(metaUrl, {
      signal: AbortSignal.timeout(4000),
    });
    const meta = (await metaRes.json()) as {
      status: string;
      date?: string;
      copyright?: string;
    };

    if (meta.status !== "OK") {
      return {
        available: false,
        source: "none",
        image_url: null,
        attribution: "",
        copyright: null,
        captured_at: null,
        cached: false,
        cost_eur: 0,
      };
    }

    const imageUrl =
      `https://maps.googleapis.com/maps/api/streetview` +
      `?size=${GOOGLE_SIZE}` +
      `&location=${lat},${lon}` +
      `&fov=${GOOGLE_FOV}` +
      `&heading=${GOOGLE_HEADING}` +
      `&key=${key}`;

    return {
      available: true,
      source: "google",
      image_url: imageUrl,
      attribution: meta.copyright ?? "© Google",
      copyright: meta.copyright ?? null,
      captured_at: meta.date ? `${meta.date}-01` : null,
      cached: false,
      // Estimation : 1 metadata gratuite + 1 image facturée 0.007$ ≈ 0.0065€
      // (sera 0 si on est dans les 28k premières du mois — on logge l'estim max)
      cost_eur: 0.0065,
    };
  } catch (err) {
    console.warn("[streetview] Google failed:", err);
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────────────────────

export type GetStreetviewOptions = {
  /** Si true, ignore le cache et refetch. Default false. */
  forceRefresh?: boolean;
  /** Si true, skip Google même si Mapillary échoue (mode 0-coût strict). */
  freeOnly?: boolean;
};

/**
 * Pipeline complet : cache → Mapillary → Google → "indisponible".
 */
export async function getStreetview(
  lat: number,
  lon: number,
  opts: GetStreetviewOptions = {},
): Promise<StreetviewResult> {
  const addressHash = addressHashFromLatLon(lat, lon);

  // 1) Cache
  if (!opts.forceRefresh) {
    const cached = await readFromCache(addressHash);
    if (cached) return cached;
  }

  // 2) Mapillary (gratuit)
  const mapillary = await tryMapillary(lat, lon);
  if (mapillary?.available) {
    void writeToCache(addressHash, lat, lon, mapillary);
    return mapillary;
  }

  // 3) Google (payant — sauf en mode strict)
  if (!opts.freeOnly) {
    const google = await tryGoogle(lat, lon);
    if (google) {
      // On cache même les "available:false" (économise le re-probe)
      void writeToCache(addressHash, lat, lon, google);
      return google;
    }
  }

  // 4) Aucune source disponible
  const none: StreetviewResult = {
    available: false,
    source: "none",
    image_url: null,
    attribution: "",
    copyright: null,
    captured_at: null,
    cached: false,
    cost_eur: 0,
  };
  void writeToCache(addressHash, lat, lon, none);
  return none;
}
