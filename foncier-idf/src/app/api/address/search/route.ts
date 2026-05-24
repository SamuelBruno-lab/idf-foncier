/**
 * GET /api/address/search?q=...&limit=5
 *
 * Pipeline :
 *   1. Cache check (address_geocode_cache)
 *   2. Appel BAN
 *   3. Si top score ≥ CONFIDENCE_THRESHOLD → renvoie direct
 *   4. Sinon rerank via Groq → Cerebras → dégradation BAN brute
 *   5. Persistance en cache
 *
 * Pas d'auth (MVP). Rate-limit basique par IP via la table cache (la même requête
 * répétée tape le cache, pas BAN). Pour limiter le scraping, voir TODO en bas.
 */

import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { searchBan, type BanResult } from "@/lib/ban";
import { rerankCandidates } from "@/lib/llm-providers";
import { getSupabaseServerClient } from "@/lib/supabase-server";

const CONFIDENCE_THRESHOLD = 0.85;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MIN_QUERY_LENGTH = 3;

type ApiResult = BanResult & { source: string };

type ApiResponse = {
  results: ApiResult[];
  meta: {
    cache_hit: boolean;
    rerank_used: boolean;
    rerank_provider: "groq" | "cerebras" | "degraded" | null;
    ban_top_score: number | null;
  };
};

function normalize(q: string): string {
  return q.toLowerCase().trim().replace(/\s+/g, " ");
}

function hashQuery(q: string): string {
  return createHash("md5").update(q).digest("hex");
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(limitParam) || DEFAULT_LIMIT),
  );

  if (q.length < MIN_QUERY_LENGTH) {
    return NextResponse.json(
      { error: `Requête trop courte (min ${MIN_QUERY_LENGTH} caractères)` },
      { status: 400 },
    );
  }

  const normalized = normalize(q);
  const queryHash = hashQuery(normalized);
  const supabase = getSupabaseServerClient();

  // ── 1. Cache check (tolérant si la table n'existe pas encore) ────────
  const cached = await supabase
    .from("address_geocode_cache")
    .select("result_json, rerank_provider, hit_count")
    .eq("query_hash", queryHash)
    .maybeSingle()
    .catch(() => ({ data: null, error: { message: "cache table missing" } }));

  if (cached.data && !cached.error) {
    // En Vercel serverless, la fonction se termine au return → on await.
    // L'overhead est ~50ms et reste sous le budget de la requête.
    // Toléré si la table n'existe pas : le hit_count est juste perdu.
    await supabase
      .from("address_geocode_cache")
      .update({
        hit_count: (cached.data.hit_count ?? 0) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq("query_hash", queryHash)
      .then(() => {})
      .catch((err) => console.warn("[cache] hit_count update failed:", err));

    const cachedResults = cached.data.result_json as ApiResult[];
    const cachedProvider = cached.data.rerank_provider as
      | "groq"
      | "cerebras"
      | null;
    return NextResponse.json({
      results: cachedResults.slice(0, limit),
      meta: {
        cache_hit: true,
        rerank_used: cachedProvider != null,
        rerank_provider: cachedProvider,
        ban_top_score: cachedResults[0]?.score ?? null,
      },
    } satisfies ApiResponse);
  }

  // ── 2. Appel BAN ──────────────────────────────────────────────────────
  let banResults: BanResult[];
  try {
    banResults = await searchBan(normalized, MAX_LIMIT);
  } catch (err) {
    console.error("[/api/address/search] BAN down:", err);
    return NextResponse.json(
      { error: "Service de géocodage indisponible" },
      { status: 503 },
    );
  }

  if (banResults.length === 0) {
    return NextResponse.json({
      results: [],
      meta: { cache_hit: false, rerank_used: false, rerank_provider: null, ban_top_score: null },
    } satisfies ApiResponse);
  }

  const banTopScore = banResults[0].score;

  // ── 3. Si confiance haute → on garde l'ordre BAN ─────────────────────
  let ordered: BanResult[];
  let source: ApiResult["source"];
  let rerankProvider: ApiResponse["meta"]["rerank_provider"] = null;

  if (banTopScore >= CONFIDENCE_THRESHOLD) {
    ordered = banResults;
    source = "ban";
  } else {
    // ── 4. Sinon rerank LLM (Groq → Cerebras → dégradation) ───────────
    const rerank = await rerankCandidates(normalized, banResults);
    ordered = rerank.results;
    rerankProvider = rerank.provider;
    source = rerank.provider === "degraded" ? "ban-degraded" : `ban+rerank-${rerank.provider}`;
  }

  const results: ApiResult[] = ordered.map((r) => ({ ...r, source }));

  // ── 5. Persistance cache (await — voir cache hit branch) ──────────────
  // "degraded" n'est pas un vrai usage de LLM → on ne persiste pas comme tel.
  const cachedProvider =
    rerankProvider === "groq" || rerankProvider === "cerebras"
      ? rerankProvider
      : null;
  await supabase
    .from("address_geocode_cache")
    .upsert({
      query_hash: queryHash,
      query_normalized: normalized,
      result_json: results,
      rerank_provider: cachedProvider,
      hit_count: 0,
      last_used_at: new Date().toISOString(),
    })
    .then(() => {})
    .catch((err) => console.warn("[cache] upsert failed:", err));

  return NextResponse.json({
    results: results.slice(0, limit),
    meta: {
      cache_hit: false,
      // "degraded" = LLM échoué, donc rerank_used = false (seul "groq"/"cerebras" comptent)
      rerank_used: cachedProvider != null,
      rerank_provider: rerankProvider,
      ban_top_score: banTopScore,
    },
  } satisfies ApiResponse);
}

// TODO Phase 2 : rate-limit IP via Vercel KV (60 req/min/IP) pour éviter le scraping.
