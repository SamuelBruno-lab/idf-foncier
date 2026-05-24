/**
 * Pipeline de géocodage réutilisable :
 *   1. Cache check (address_geocode_cache)
 *   2. Appel BAN
 *   3. Si score < seuil → rerank Groq/Cerebras, sinon BAN brut
 *   4. Upsert cache
 *
 * Partagé entre /api/address/search et /api/estimate (et le futur /api/chat).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

import { searchBan, type BanResult } from "./ban";
import { rerankCandidates } from "./llm-providers";

export const CONFIDENCE_THRESHOLD = 0.85;
export const MAX_LIMIT = 10;

export type GeocodeMeta = {
  cache_hit: boolean;
  rerank_used: boolean;
  rerank_provider: "groq" | "cerebras" | "degraded" | null;
  ban_top_score: number | null;
};

export type GeocodedAddress = BanResult & { source: string };

export type GeocodeResponse = {
  results: GeocodedAddress[];
  meta: GeocodeMeta;
};

export function normalizeQuery(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, " ");
}

function hashQuery(q: string): string {
  return createHash("md5").update(q).digest("hex");
}

export async function geocodeAddress(
  q: string,
  supabase: SupabaseClient,
): Promise<GeocodeResponse> {
  const normalized = normalizeQuery(q);
  const queryHash = hashQuery(normalized);

  // ── 1. Cache check (tolérant si table absente) ──────────────────────
  type CacheRow = {
    result_json: unknown;
    rerank_provider: string | null;
    hit_count: number | null;
  };
  let cacheRow: CacheRow | null = null;
  try {
    const res = await supabase
      .from("address_geocode_cache")
      .select("result_json, rerank_provider, hit_count")
      .eq("query_hash", queryHash)
      .maybeSingle();
    if (res.data && !res.error) {
      cacheRow = res.data as unknown as CacheRow;
    }
  } catch (err) {
    console.warn("[cache] check failed (table missing?):", err);
  }

  if (cacheRow) {
    try {
      await supabase
        .from("address_geocode_cache")
        .update({
          hit_count: (cacheRow.hit_count ?? 0) + 1,
          last_used_at: new Date().toISOString(),
        })
        .eq("query_hash", queryHash);
    } catch (err) {
      console.warn("[cache] hit_count update failed:", err);
    }

    const cachedResults = cacheRow.result_json as GeocodedAddress[];
    const cachedProvider = cacheRow.rerank_provider as
      | "groq"
      | "cerebras"
      | null;
    return {
      results: cachedResults,
      meta: {
        cache_hit: true,
        rerank_used: cachedProvider != null,
        rerank_provider: cachedProvider,
        ban_top_score: cachedResults[0]?.score ?? null,
      },
    };
  }

  // ── 2. Appel BAN ─────────────────────────────────────────────────────
  const banResults = await searchBan(normalized, MAX_LIMIT);

  if (banResults.length === 0) {
    return {
      results: [],
      meta: {
        cache_hit: false,
        rerank_used: false,
        rerank_provider: null,
        ban_top_score: null,
      },
    };
  }

  const banTopScore = banResults[0].score;

  // ── 3. Rerank si confiance basse ────────────────────────────────────
  let ordered: BanResult[];
  let source: string;
  let rerankProvider: GeocodeMeta["rerank_provider"] = null;

  if (banTopScore >= CONFIDENCE_THRESHOLD) {
    ordered = banResults;
    source = "ban";
  } else {
    const rerank = await rerankCandidates(normalized, banResults);
    ordered = rerank.results;
    rerankProvider = rerank.provider;
    source =
      rerank.provider === "degraded"
        ? "ban-degraded"
        : `ban+rerank-${rerank.provider}`;
  }

  const results: GeocodedAddress[] = ordered.map((r) => ({ ...r, source }));

  // ── 4. Upsert cache (best-effort) ───────────────────────────────────
  const cachedProvider =
    rerankProvider === "groq" || rerankProvider === "cerebras"
      ? rerankProvider
      : null;
  try {
    await supabase
      .from("address_geocode_cache")
      .upsert({
        query_hash: queryHash,
        query_normalized: normalized,
        result_json: results,
        rerank_provider: cachedProvider,
        hit_count: 0,
        last_used_at: new Date().toISOString(),
      });
  } catch (err) {
    console.warn("[cache] upsert failed:", err);
  }

  return {
    results,
    meta: {
      cache_hit: false,
      rerank_used: cachedProvider != null,
      rerank_provider: rerankProvider,
      ban_top_score: banTopScore,
    },
  };
}
