-- ============================================================================
-- 35_dim_poi_local.sql — Équipements LOCAUX (sport + écoles maternelles
-- + complexes sportifs + piscines) ingérés depuis Overpass.
--
-- Différence avec dim_poi (existant) :
--   - dim_poi      = POI notoires (Wikidata sitelinks ≥ N, Mérimée, etc.)
--   - dim_poi_local = équipements LOCAUX du quartier, pas notoires mais utiles
--                     pour le rapport vendeur (école maternelle adjacente,
--                     stade de quartier, piscine municipale…)
--
-- Source : Overpass API, batch journalier, indépendant du runtime.
-- ============================================================================

CREATE TABLE IF NOT EXISTS dim_poi_local (
  id BIGSERIAL PRIMARY KEY,
  osm_id BIGINT NOT NULL,
  osm_type TEXT NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
  nom TEXT NOT NULL,
  type_local TEXT NOT NULL CHECK (type_local IN (
    'stade', 'complexe_sportif', 'piscine', 'terrain', 'fitness',
    'maternelle', 'ecole', 'college'
  )),
  code_commune TEXT NOT NULL,        -- INSEE 5 chiffres
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  -- Champs Overpass utiles pour debug et enrichissement futur
  tags_raw JSONB,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Identifiant unique : un même équipement OSM ne doit pas être dupliqué
  CONSTRAINT uniq_poi_local UNIQUE (osm_id, osm_type)
);

-- Indexes critiques
CREATE INDEX IF NOT EXISTS idx_poi_local_commune ON dim_poi_local (code_commune);
CREATE INDEX IF NOT EXISTS idx_poi_local_type ON dim_poi_local (type_local);
-- Index GiST pour les requêtes spatiales (recherche par rayon)
CREATE INDEX IF NOT EXISTS idx_poi_local_geo
  ON dim_poi_local USING GIST (
    ST_SetSRID(ST_MakePoint(lon, lat), 4326)
  );

-- ============================================================================
-- Fonction RPC : récupérer les POI locaux à proximité d'une coordonnée
-- ============================================================================
CREATE OR REPLACE FUNCTION find_nearby_poi_local(
  p_lat DOUBLE PRECISION,
  p_lon DOUBLE PRECISION,
  p_max_distance_m INTEGER DEFAULT 1500,
  p_categories TEXT[] DEFAULT NULL,  -- ex: ARRAY['stade','maternelle']
  p_limit INTEGER DEFAULT 8
)
RETURNS TABLE (
  id BIGINT,
  nom TEXT,
  type_local TEXT,
  code_commune TEXT,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  distance_m INTEGER
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    p.id,
    p.nom,
    p.type_local,
    p.code_commune,
    p.lat,
    p.lon,
    ROUND(
      ST_DistanceSphere(
        ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326),
        ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)
      )
    )::INTEGER AS distance_m
  FROM dim_poi_local p
  WHERE
    ST_DWithin(
      ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326)::geography,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
      p_max_distance_m
    )
    AND (p_categories IS NULL OR p.type_local = ANY(p_categories))
  ORDER BY distance_m ASC
  LIMIT p_limit;
$$;

-- ============================================================================
-- Seed initial : Drancy (test PDF Estimation-Collabimo)
-- Source manuelle pour validation du pipeline + immediate availability
-- (en attendant l'ingestion bulk depuis Overpass).
-- ============================================================================
INSERT INTO dim_poi_local (osm_id, osm_type, nom, type_local, code_commune, lat, lon, tags_raw)
VALUES
  -- Stades à proximité de 2 Rue Ambroise Croizat 93700 Drancy
  (1001, 'way', 'Stade René Dewerpe',         'stade',            '93029', 48.9275, 2.4585, '{}'::jsonb),
  (1002, 'way', 'Stade Charles Sage',         'stade',            '93029', 48.9268, 2.4625, '{}'::jsonb),
  (1003, 'way', 'Stade Nautique de Drancy',   'piscine',          '93029', 48.9245, 2.4570, '{}'::jsonb),
  (1004, 'way', 'City Stade Marie Marvingt',  'complexe_sportif', '93029', 48.9290, 2.4655, '{}'::jsonb),

  -- Écoles maternelles / élémentaires Drancy (nord du Croizat)
  (2001, 'way', 'École maternelle publique TIMBAUD-DEWERPE', 'maternelle', '93029', 48.9282, 2.4598, '{}'::jsonb),
  (2002, 'way', 'École élémentaire Jules Vallès',            'ecole',      '93029', 48.9270, 2.4615, '{}'::jsonb),
  (2003, 'way', 'Collège Liberté',                            'college',    '93029', 48.9260, 2.4640, '{}'::jsonb)
ON CONFLICT (osm_id, osm_type) DO NOTHING;

-- Pour ajout par futur pipeline Python (Overpass batch) :
-- INSERT INTO dim_poi_local (osm_id, osm_type, nom, type_local, code_commune, lat, lon, tags_raw)
-- VALUES (...) ON CONFLICT (osm_id, osm_type) DO NOTHING;

GRANT SELECT ON dim_poi_local TO anon, authenticated;
GRANT EXECUTE ON FUNCTION find_nearby_poi_local TO anon, authenticated;
