-- DATAMERRY — Référentiel officiel des gares (RER, Transilien, SNCF, Métro, Tram)
--
-- Source primaire : SNCF Open Data « Liste des gares »
--   https://ressources.data.sncf.com/explore/dataset/liste-des-gares/
--   ~3000 entrées France entière (TER, Transilien, RER, TGV, Intercités).
--   Inclut code UIC, géoloc, statut voyageurs, fret.
--
-- Source complémentaire : IDF Mobilités « Emplacement des gares IDF »
--   https://data.iledefrance-mobilites.fr/explore/dataset/emplacement-des-gares-idf/
--   Couvre les stations 100% RATP (métro Paris, RER A/B portions RATP)
--   non listées dans le référentiel SNCF.
--
-- Usage : enrichissement PDF rapport lead (« Première gare à proximité »
-- + distance/temps trajet jusqu'à Paris). Lookup spatial via Haversine.

CREATE TABLE IF NOT EXISTS public.dim_gares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifiants officiels (peuvent être null selon la source)
  code_uic TEXT,                       -- 8 chiffres SNCF/UIC (ex: '87113001' = Paris Gare du Nord)
  code_idfm TEXT,                      -- StopArea IDFM (ex: 'IDFM:71359')

  -- Identité
  nom TEXT NOT NULL,                   -- "Paris Gare du Nord", "Pantin", "Châtelet-Les-Halles"
  type TEXT NOT NULL,                  -- 'sncf' | 'transilien' | 'rer' | 'metro' | 'tram' | 'autre'
  reseau TEXT,                         -- 'SNCF', 'RATP', 'IDFM', etc.
  lignes TEXT[],                       -- ['RER B', 'RER D', 'Métro 4', 'Transilien H']

  -- Géo
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  code_insee_commune TEXT,             -- '75010' pour Gare du Nord
  code_postal TEXT,
  dept TEXT,                           -- '75', '93', etc.

  -- Statut
  voyageurs BOOLEAN NOT NULL DEFAULT true,
  active BOOLEAN NOT NULL DEFAULT true,

  -- Audit
  source TEXT NOT NULL,                -- 'sncf-opendata' | 'idfm' | 'manuel'
  source_id TEXT,                      -- ID dans la source (record id ODS, etc.)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Contraintes
  CONSTRAINT dim_gares_type_check CHECK (type IN ('sncf', 'transilien', 'rer', 'metro', 'tram', 'autre')),
  CONSTRAINT dim_gares_unique_uic UNIQUE (code_uic)
);

COMMENT ON TABLE public.dim_gares IS
  'Référentiel officiel des gares (RER / Transilien / SNCF / Métro / Tram). Source SNCF Open Data + IDF Mobilités. Pour enrichissement rapport lead et requêtes "première gare la plus proche".';

COMMENT ON COLUMN public.dim_gares.code_uic IS
  'Identifiant officiel UIC à 8 chiffres (pour gares SNCF). Null pour les stations 100% RATP.';

COMMENT ON COLUMN public.dim_gares.lignes IS
  'Liste des lignes desservies (ex: [''RER B'', ''Transilien H'']). Permet d''afficher "Paris-Nord (RER B, Transilien H)".';

COMMENT ON COLUMN public.dim_gares.type IS
  'Type principal : rer prioritaire si plusieurs (ex: gare RER + Transilien => type = rer).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Index pour requêtes spatiales rapides
-- ─────────────────────────────────────────────────────────────────────────────

-- Index B-tree sur lat / lon — utile pour les bounding box pré-filtres
CREATE INDEX IF NOT EXISTS idx_gares_lat ON public.dim_gares (lat) WHERE active = true AND voyageurs = true;
CREATE INDEX IF NOT EXISTS idx_gares_lon ON public.dim_gares (lon) WHERE active = true AND voyageurs = true;

-- Index sur dept pour filtrer rapidement IDF
CREATE INDEX IF NOT EXISTS idx_gares_dept ON public.dim_gares (dept) WHERE active = true;

-- Index sur type pour prioriser RER > Transilien > métro
CREATE INDEX IF NOT EXISTS idx_gares_type ON public.dim_gares (type) WHERE active = true AND voyageurs = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — anon read autorisé (donnée publique, pas sensible)
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.dim_gares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_gares" ON public.dim_gares;
CREATE POLICY "anon_read_gares"
  ON public.dim_gares FOR SELECT
  USING (active = true AND voyageurs = true);

DROP POLICY IF EXISTS "service_role_full_gares" ON public.dim_gares;
CREATE POLICY "service_role_full_gares"
  ON public.dim_gares FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger updated_at
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_gares_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_gares_updated ON public.dim_gares;
CREATE TRIGGER trg_gares_updated
  BEFORE UPDATE ON public.dim_gares
  FOR EACH ROW EXECUTE FUNCTION public.touch_gares_updated();

-- ─────────────────────────────────────────────────────────────────────────────
-- Fonction : trouve la gare la plus proche d'un point (lat, lon)
-- Approche : pré-filtre par bounding box puis tri Haversine exact.
-- Bénéfice : O(log n) au lieu de O(n) sur 3000 lignes.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.find_nearest_gare(
  p_lat DOUBLE PRECISION,
  p_lon DOUBLE PRECISION,
  p_max_distance_km NUMERIC DEFAULT 20,
  p_prefer_type TEXT[] DEFAULT ARRAY['rer', 'transilien', 'metro', 'sncf', 'tram']
)
RETURNS TABLE (
  id UUID,
  nom TEXT,
  type TEXT,
  lignes TEXT[],
  reseau TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  code_insee_commune TEXT,
  distance_km NUMERIC,
  walk_minutes INTEGER
)
LANGUAGE plpgsql
STABLE AS $$
DECLARE
  -- 1° latitude ≈ 111 km, 1° longitude ≈ 111 * cos(lat) km
  -- On élargit la bounding box pour avoir une marge de sécurité
  v_lat_delta NUMERIC := p_max_distance_km / 110.0;
  v_lon_delta NUMERIC := p_max_distance_km / (111.0 * cos(radians(p_lat)));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT
      g.id, g.nom, g.type, g.lignes, g.reseau,
      g.lat, g.lon, g.code_insee_commune,
      -- Haversine en km
      ( 6371 * 2 * asin( sqrt(
          power(sin(radians(g.lat - p_lat) / 2), 2) +
          cos(radians(p_lat)) * cos(radians(g.lat)) *
          power(sin(radians(g.lon - p_lon) / 2), 2)
        ))
      )::NUMERIC AS dist_km,
      -- Score de priorité du type (0 = meilleur)
      array_position(p_prefer_type, g.type) AS type_priority
    FROM public.dim_gares g
    WHERE g.active = true
      AND g.voyageurs = true
      AND g.lat BETWEEN (p_lat - v_lat_delta) AND (p_lat + v_lat_delta)
      AND g.lon BETWEEN (p_lon - v_lon_delta) AND (p_lon + v_lon_delta)
  )
  SELECT
    c.id, c.nom, c.type, c.lignes, c.reseau,
    c.lat, c.lon, c.code_insee_commune,
    round(c.dist_km, 2) AS distance_km,
    -- Estimation marche à 4 km/h = 67 m/min = 15 min/km
    ceil(c.dist_km * 15)::INTEGER AS walk_minutes
  FROM candidates c
  WHERE c.dist_km <= p_max_distance_km
  ORDER BY
    COALESCE(c.type_priority, 99),  -- priorité type d'abord
    c.dist_km                        -- puis distance
  LIMIT 1;
END;
$$;

COMMENT ON FUNCTION public.find_nearest_gare(DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC, TEXT[]) IS
  'Trouve la gare la plus proche d''un point (lat, lon) en privilégiant RER > Transilien > Métro > SNCF > Tram. Bounding box pré-filtre + Haversine exact. p_max_distance_km = 20 par défaut.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Vue : gares IDF actives (pratique pour debug et UI futures)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_gares_idf AS
SELECT id, code_uic, nom, type, lignes, reseau, lat, lon,
       code_insee_commune, dept, source
FROM public.dim_gares
WHERE active = true
  AND voyageurs = true
  AND dept IN ('75', '77', '78', '91', '92', '93', '94', '95');

COMMENT ON VIEW public.v_gares_idf IS
  'Toutes les gares actives en Île-de-France (8 départements). Pratique pour cartographie et debug.';
