-- DATAMERRY — Référentiel des grands projets d'infrastructure (anticipation prix)
--
-- KILLER FEATURE vs PriceHubble/Immo Data : ils sont backward-looking (comparables
-- DVF passés). DATAMERRY ajoute le FORWARD-LOOKING : Grand Paris Express, LGV,
-- canaux, ZAC. Effet anticipation : +5 à +30% selon proximité + état d'avancement.
--
-- Sources ingérées :
--   1. Société des Grands Projets (ex-SGP) → 66 gares GPE + 4 lignes neuves IDF
--   2. SNCF Réseau → LGV GPSO (Bordeaux-Toulouse), LNPCA (Marseille-Nice)
--   3. VNF → Canal Seine-Nord Europe, mise à grand gabarit Dunkerque-Escaut
--   4. data.gouv.fr → ZAC majeures (Saclay, Confluence, Euroméditerranée, etc.)
--   5. DREAL régionales → opérations d'intérêt national (OIN)
--
-- Phrase éditoriale type dans le rapport vendeur :
--   "À 600m de la future gare Saint-Denis Pleyel (Grand Paris Express, livraison
--    fin 2025) : ligne 14 directe vers Châtelet en 11 min. +12% anticipation
--    sur le marché local."

CREATE TABLE IF NOT EXISTS public.dim_grands_projets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identification
  nom TEXT NOT NULL,                       -- "Gare Saint-Denis Pleyel"
  type TEXT NOT NULL,                      -- gare_futur, ligne_metro, lgv, canal,
                                           -- zac, oin, gigafactory, gare_tgv
  importance TEXT NOT NULL,                -- 'nationale', 'regionale',
                                           -- 'metropolitaine', 'communale'

  -- Géo (centroïde — V2 PostGIS pour LINESTRING/POLYGON)
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  code_insee_commune TEXT,
  dept TEXT,
  region_code TEXT,                        -- '11' IDF, '84' Auv-Rhône-Alpes, etc.

  -- Temporalité — clé pour l'effet anticipation
  etat TEXT NOT NULL,                      -- concertation, dup, financement_acquis,
                                           -- travaux_en_cours, livre_partiel,
                                           -- livre_total, annule
  date_livraison_estimee DATE,
  date_livraison_actualisee DATE,

  -- Impact économique anticipé sur l'immobilier proche
  impact_prix_pct_min INTEGER,             -- ex: +5 (en %)
  impact_prix_pct_max INTEGER,             -- ex: +15
  rayon_impact_m INTEGER NOT NULL DEFAULT 1000,
                                           -- ex: 800 gare, 2000 ZAC, 30000 massif

  -- Métadonnées
  maitre_ouvrage TEXT,                     -- "Société des Grands Projets", "VNF"
  budget_meur INTEGER,                     -- 1 800 (M€)
  url_officiel TEXT,
  description TEXT,                        -- 250 chars max, phrase éditoriale brute

  -- Audit
  source TEXT NOT NULL,                    -- 'sgp', 'vnf', 'sncf_reseau', 'data_gouv'
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT dim_gp_type_check CHECK (type IN (
    'gare_futur', 'ligne_metro', 'tramway',
    'gare_tgv', 'lgv', 'rer_extension',
    'canal_futur', 'canal_existant', 'voie_navigable_modernisee',
    'zac', 'oin', 'gigafactory',
    'aeroport_extension', 'port_extension',
    'autre'
  )),

  CONSTRAINT dim_gp_etat_check CHECK (etat IN (
    'concertation', 'dup', 'financement_acquis',
    'travaux_en_cours', 'livre_partiel', 'livre_total', 'annule'
  )),

  CONSTRAINT dim_gp_importance_check CHECK (importance IN (
    'nationale', 'regionale', 'metropolitaine', 'communale'
  )),

  -- Unicité (nom + type + lat/lon arrondi) pour éviter doublons d'ingestion
  CONSTRAINT uniq_gp_nom_type UNIQUE (nom, type)
);

COMMENT ON TABLE public.dim_grands_projets IS
  'Grands projets d''infrastructure (futurs ou en cours) impactant la valeur immobilière. GPE + LGV + canaux + ZAC + gigafactories. Source killer feature DATAMERRY (forward-looking vs PriceHubble backward-looking).';

-- Index
CREATE INDEX IF NOT EXISTS idx_gp_lat ON public.dim_grands_projets (lat) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_gp_lon ON public.dim_grands_projets (lon) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_gp_dept ON public.dim_grands_projets (dept) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_gp_type ON public.dim_grands_projets (type) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_gp_etat ON public.dim_grands_projets (etat) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_gp_livraison ON public.dim_grands_projets (date_livraison_estimee) WHERE active = true;

-- RLS
ALTER TABLE public.dim_grands_projets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_grands_projets" ON public.dim_grands_projets;
CREATE POLICY "anon_read_grands_projets"
  ON public.dim_grands_projets FOR SELECT USING (active = true);

DROP POLICY IF EXISTS "service_role_full_grands_projets" ON public.dim_grands_projets;
CREATE POLICY "service_role_full_grands_projets"
  ON public.dim_grands_projets FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_gp_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_gp_updated ON public.dim_grands_projets;
CREATE TRIGGER trg_gp_updated
  BEFORE UPDATE ON public.dim_grands_projets
  FOR EACH ROW EXECUTE FUNCTION public.touch_gp_updated();

-- ─────────────────────────────────────────────────────────────────────────────
-- Fonction : trouve les grands projets impactant un point GPS
--
-- Spécifique vs find_nearby_poi :
--   - Filtre les projets ANNULÉS et LIVRÉS COMPLÈTEMENT (effet anticipation nul)
--   - Utilise le rayon_impact_m PROPRE à chaque projet (gare 800m, ZAC 2000m,
--     massif 30000m, gigafactory 5000m)
--   - Tri : importance nationale > régionale > métropolitaine > communale,
--           puis par proximité
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.find_nearby_grands_projets(
  p_lat NUMERIC,
  p_lon NUMERIC,
  p_max_distance_m INTEGER DEFAULT 3000,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  nom TEXT,
  type TEXT,
  importance TEXT,
  etat TEXT,
  date_livraison_estimee DATE,
  impact_prix_pct_min INTEGER,
  impact_prix_pct_max INTEGER,
  description TEXT,
  url_officiel TEXT,
  distance_m INTEGER
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_lat DOUBLE PRECISION := p_lat::DOUBLE PRECISION;
  v_lon DOUBLE PRECISION := p_lon::DOUBLE PRECISION;
  v_max_km NUMERIC := p_max_distance_m / 1000.0;
  v_lat_delta NUMERIC := v_max_km / 110.0;
  v_lon_delta NUMERIC := v_max_km / (111.0 * cos(radians(v_lat)));
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT
      g.id, g.nom, g.type, g.importance, g.etat,
      g.date_livraison_estimee,
      g.impact_prix_pct_min, g.impact_prix_pct_max,
      g.description, g.url_officiel,
      g.rayon_impact_m,
      ( 6371000 * 2 * asin( sqrt(
          power(sin(radians(g.lat - v_lat) / 2), 2) +
          cos(radians(v_lat)) * cos(radians(g.lat)) *
          power(sin(radians(g.lon - v_lon) / 2), 2)
        ))
      )::INTEGER AS dist_m
    FROM public.dim_grands_projets g
    WHERE g.active = true
      -- Seulement les projets avec effet d'anticipation actif
      AND g.etat IN (
        'concertation', 'dup', 'financement_acquis',
        'travaux_en_cours', 'livre_partiel'
      )
      AND g.lat BETWEEN (v_lat - v_lat_delta) AND (v_lat + v_lat_delta)
      AND g.lon BETWEEN (v_lon - v_lon_delta) AND (v_lon + v_lon_delta)
  )
  SELECT
    c.id, c.nom, c.type, c.importance, c.etat,
    c.date_livraison_estimee, c.impact_prix_pct_min, c.impact_prix_pct_max,
    c.description, c.url_officiel, c.dist_m AS distance_m
  FROM candidates c
  -- Filtre par le rayon d'impact PROPRE de chaque projet
  WHERE c.dist_m <= LEAST(p_max_distance_m, c.rayon_impact_m)
  ORDER BY
    CASE c.importance
      WHEN 'nationale' THEN 1
      WHEN 'regionale' THEN 2
      WHEN 'metropolitaine' THEN 3
      WHEN 'communale' THEN 4
    END,
    c.dist_m ASC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION public.find_nearby_grands_projets IS
  'Trouve les grands projets d''infrastructure à proximité d''un point (anticipation prix). Filtre par rayon_impact propre à chaque projet + état actif (concertation/DUP/travaux).';

-- ─────────────────────────────────────────────────────────────────────────────
-- Vérification
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_name='dim_grands_projets') AS table_ok,
  (SELECT COUNT(*) FROM public.dim_grands_projets) AS row_count;
