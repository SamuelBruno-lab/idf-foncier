/**
 * GET /api/address/search?q=...&limit=5
 *
 * Wrapper HTTP autour de geocodeAddress (lib partagée).
 * Pipeline complet (cache → BAN → rerank LLM → upsert) dans src/lib/geocode.ts.
 *
 * Pas d'auth (MVP). Le cache fait office de rate-limit naturel sur requêtes
 * récurrentes. TODO Phase 2 : rate-limit IP via Vercel KV.
 */

import { NextRequest, NextResponse } from "next/server";

import { geocodeAddress } from "@/lib/geocode";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { withApiKey } from "@/lib/auth/apiKey";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MIN_QUERY_LENGTH = 3;

async function handleAddressSearch(req: NextRequest): Promise<NextResponse> {
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

  const supabase = getSupabaseServerClient();

  try {
    const { results, meta } = await geocodeAddress(q, supabase);
    return NextResponse.json({ results: results.slice(0, limit), meta });
  } catch (err) {
    console.error("[/api/address/search] erreur:", err);
    return NextResponse.json(
      { error: "Service de géocodage indisponible" },
      { status: 503 },
    );
  }
}

export const GET = withApiKey(handleAddressSearch, {
  endpoint: "/api/address/search",
});
