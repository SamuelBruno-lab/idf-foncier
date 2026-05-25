-- DATAMERRY — Cache des rapports propriété
--
-- /api/property-report agrège jusqu'à 7 datasets externes (cadastre, permis,
-- écoles, transports, services, INSEE, streetview). Beaucoup de ces appels
-- sont lents (Overpass OSM peut prendre 3-5s) ou facturés (Google Streetview
-- à 0,007$/img au-delà du free tier).
--
-- Stratégie cache :
--   - Cache par (address_hash, dataset_key) avec TTL personnalisé par dataset
--   - TTL court (24h) pour data volatile (permis récents)
--   - TTL long (30j) pour data stable (streetview, INSEE, cadastre)
--   - Hit cache = non billable côté Stripe (on a déjà encaissé la 1ère fois)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. property_report_cache
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.property_report_cache (
  id BIGSERIAL PRIMARY KEY,

  -- Identifiant d'adresse (SHA-256 de "lat:lon" arrondi 4 décimales ≈ 11m)
  -- Permet de hit le cache même si l'adresse est exprimée différemment
  -- ("10 rue Rivoli 75001 Paris" vs "10 Rue de Rivoli, 75001 Paris").
  address_hash TEXT NOT NULL,

  -- Aussi indexé sur lat/lon pour debug / requêtes spatiales éventuelles
  lat NUMERIC(10, 6) NOT NULL,
  lon NUMERIC(10, 6) NOT NULL,

  -- Clé du dataset : 'streetview' | 'cadastre' | 'permis' | 'ecoles' |
  -- 'transports' | 'services_proximite' | 'insee_iris'
  dataset_key TEXT NOT NULL,

  -- Payload JSON renvoyé par la source. Pas de validation de schéma : chaque
  -- dataset a sa propre structure.
  payload JSONB NOT NULL,

  -- Streetview en particulier peut stocker un blob binaire (image)
  -- pour éviter un round-trip Google sur les hits cache.
  image_bytes BYTEA,
  image_content_type TEXT,

  -- TTL
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,

  -- Source d'origine (pour analytics : combien d'appels Mapillary vs Google ?)
  source TEXT,
  source_cost_eur NUMERIC(10, 6),

  UNIQUE (address_hash, dataset_key)
);

CREATE INDEX IF NOT EXISTS idx_property_report_cache_lookup
  ON public.property_report_cache (address_hash, dataset_key, expires_at);
-- Index sur expires_at (sans WHERE clause car now() est STABLE, pas IMMUTABLE,
-- et Postgres refuse les fonctions non-immutables dans un index predicate)
CREATE INDEX IF NOT EXISTS idx_property_report_cache_expires_at
  ON public.property_report_cache (expires_at);
CREATE INDEX IF NOT EXISTS idx_property_report_cache_geo
  ON public.property_report_cache (lat, lon);

COMMENT ON TABLE public.property_report_cache IS
  'Cache mutualisé des datasets externes pour /api/property-report. Hit cache = non billable.';

-- ============================================================================
-- 2. Job de purge (cron quotidien — purge les lignes expirées > 7j)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.purge_property_report_cache()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM public.property_report_cache
  WHERE expires_at < now() - interval '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

COMMENT ON FUNCTION public.purge_property_report_cache IS
  'À appeler en cron quotidien — purge les lignes expirées depuis > 7j.';

-- ============================================================================
-- 3. RLS — service_role only (cache mutualisé entre tous les cabinets)
-- ============================================================================
ALTER TABLE public.property_report_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_access_property_cache"
  ON public.property_report_cache;
CREATE POLICY "service_role_full_access_property_cache"
  ON public.property_report_cache FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
