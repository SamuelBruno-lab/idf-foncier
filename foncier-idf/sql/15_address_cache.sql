-- ============================================================
-- datamerry — Phase 1.5 : cache du géocodage d'adresse
-- À exécuter dans Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS address_geocode_cache (
  query_hash       TEXT PRIMARY KEY,        -- MD5 de la requête normalisée
  query_normalized TEXT NOT NULL,           -- requête lowercased, espaces dédupliqués
  result_json      JSONB NOT NULL,          -- réponse complète (results[])
  hit_count        INTEGER DEFAULT 0,       -- nb de hits successifs
  rerank_provider  TEXT,                    -- 'groq' | 'cerebras' | NULL si pas de rerank
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  last_used_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_geocode_cache_last_used
  ON address_geocode_cache (last_used_at);

COMMENT ON TABLE address_geocode_cache IS
  'Cache du géocodage BAN + rerank LLM. Évite re-géocodage et re-LLM sur adresses récurrentes.';
