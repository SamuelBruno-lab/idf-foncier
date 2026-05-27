-- DATAMERRY — Référentiel France entière des Points d'Intérêts notables
-- (monuments historiques + musées + sites touristiques + parcs majeurs).
--
-- Pourquoi cette table :
--   - Overpass API non fiable (timeouts fréquents, cache empoisonné)
--   - Wikidata + Mérimée = données officielles France, sub-5ms en DB
--   - Mise à jour annuelle suffit (les monuments bougent peu)
--
-- Sources ingérées par pipeline_poi.py :
--   1. Mérimée — data.gouv.fr "Immeubles protégés au titre des MH"
--      → ~45 000 monuments classés/inscrits France entière
--   2. Wikidata SPARQL — musées + sites touristiques + parcs + lieux
--      notables avec article Wikipedia
--   3. (Optionnel) IDF Mobilités — ZdE remarquables (ex: Tour Eiffel)
--
-- Total cible : ~80-100k POI France, dont ~15k en IDF.

CREATE TABLE IF NOT EXISTS public.dim_poi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifiants externes
  wikidata_id TEXT,                    -- ex: 'Q243' (Tour Eiffel)
  merimee_id TEXT,                     -- ex: 'PA00086250' (Monument Historique)
  osm_id BIGINT,                       -- ex: 5013364 (relation OSM)

  -- Identité
  nom TEXT NOT NULL,                   -- ex: 'Tour Eiffel', 'Place des Vosges'
  type TEXT NOT NULL,                  -- monument, musee, parc, eglise, chateau, ...
  categorie TEXT,                      -- subdivision : 'monument_historique', 'jardin_remarquable', ...

  -- Géo
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  code_insee_commune TEXT,
  dept TEXT,                           -- '75', '93', etc.

  -- Liens
  wikipedia_url TEXT,                  -- https://fr.wikipedia.org/wiki/Tour_Eiffel
  description TEXT,                    -- abstract Wikipedia ou tags OSM

  -- Notabilité — heuristique pour prioriser (présence Wikipedia = 50,
  -- monument historique classé = +30, sitelinks Wikidata = +5 chacun, etc.)
  notabilite_score INTEGER DEFAULT 0,

  -- Audit
  source TEXT NOT NULL,                -- 'wikidata' | 'merimee' | 'osm'
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT dim_poi_type_check CHECK (type IN (
    'monument', 'musee', 'parc', 'eglise', 'chateau', 'site_archeologique',
    'pont', 'fontaine', 'place', 'theatre', 'opera', 'site_naturel',
    'autre'
  ))
);

COMMENT ON TABLE public.dim_poi IS
  'Référentiel France entière des points d''intérêts notables (Mérimée + Wikidata + OSM curated).';

-- Index spatial + filtre courant
CREATE INDEX IF NOT EXISTS idx_poi_lat ON public.dim_poi (lat) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_poi_lon ON public.dim_poi (lon) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_poi_dept ON public.dim_poi (dept) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_poi_notabilite ON public.dim_poi (notabilite_score DESC) WHERE active = true;

-- Unicité par source externe (évite les doublons d'ingestion)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_poi_wikidata
  ON public.dim_poi (wikidata_id)
  WHERE wikidata_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_poi_merimee
  ON public.dim_poi (merimee_id)
  WHERE merimee_id IS NOT NULL;

ALTER TABLE public.dim_poi ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_poi" ON public.dim_poi;
CREATE POLICY "anon_read_poi"
  ON public.dim_poi FOR SELECT USING (active = true);

DROP POLICY IF EXISTS "service_role_full_poi" ON public.dim_poi;
CREATE POLICY "service_role_full_poi"
  ON public.dim_poi FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE OR REPLACE FUNCTION public.touch_poi_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_poi_updated ON public.dim_poi;
CREATE TRIGGER trg_poi_updated
  BEFORE UPDATE ON public.dim_poi
  FOR EACH ROW EXECUTE FUNCTION public.touch_poi_updated();

-- ─────────────────────────────────────────────────────────────────────────────
-- Fonction : trouve les POI les plus proches + notables d'un point GPS
--   - Bounding box pre-filter
--   - Haversine exact
--   - Score combiné = (distance pénalisée) - (notabilite_score boost)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.find_nearby_poi(
  p_lat DOUBLE PRECISION,
  p_lon DOUBLE PRECISION,
  p_max_distance_m INTEGER DEFAULT 2000,
  p_limit INTEGER DEFAULT 5
)
RETURNS TABLE (
  id UUID,
  nom TEXT,
  type TEXT,
  categorie TEXT,
  wikipedia_url TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  distance_m INTEGER,
  notabilite_score INTEGER
)
LANGUAGE plpgsql
STABLE AS $$
DECLARE
  v_max_km NUMERIC := p_max_distance_m / 1000.0;
  v_lat_delta NUMERIC := v_max_km / 110.0;
  v_lon_delta NUMERIC := v_max_km / (111.0 * cos(radians(p_lat)));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT
      p.id, p.nom, p.type, p.categorie, p.wikipedia_url,
      p.lat, p.lon, p.notabilite_score,
      ( 6371000 * 2 * asin( sqrt(
          power(sin(radians(p.lat - p_lat) / 2), 2) +
          cos(radians(p_lat)) * cos(radians(p.lat)) *
          power(sin(radians(p.lon - p_lon) / 2), 2)
        ))
      )::INTEGER AS dist_m
    FROM public.dim_poi p
    WHERE p.active = true
      AND p.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
      AND p.lon BETWEEN (p_lon - v_lon_delta) AND (p_lon + v_lon_delta)
  )
  SELECT
    c.id, c.nom, c.type, c.categorie, c.wikipedia_url,
    c.lat, c.lon, c.dist_m AS distance_m, c.notabilite_score
  FROM candidates c
  WHERE c.dist_m <= p_max_distance_m
  -- Tri : on combine distance et notabilité.
  -- Un POI à 500m + score 100 sera préféré à un POI à 200m + score 10.
  ORDER BY (c.dist_m::NUMERIC - c.notabilite_score * 5) ASC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.find_nearby_poi IS
  'Trouve les POI notables proches d''un point en combinant distance + score de notabilité (Wikipedia, Mérimée). Bounding box + Haversine + tri combiné.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Vérification finale
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_name='dim_poi') AS table_ok,
  (SELECT COUNT(*) FROM public.dim_poi) AS row_count;
