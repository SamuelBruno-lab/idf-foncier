-- ============================================================
-- Migration 71 : hauteur reelle (m) + classification des cotes de parcelle
-- (facade / lateral / fond) par ADJACENCE cadastrale + reculs PLU (eventail)
--
-- Phase 2a du plan "prefaisabilite complete" -- suite de la Phase 1
-- (migrations 66/67/70). Purement additif : aucune table/vue/fonction
-- existante n'est modifiee en profondeur, score_commune_parcels() n'est
-- PAS touche par cette migration (contrainte du plan).
--
-- Contexte : le comparatif "existant vs PLU" demande de savoir, pour
-- chaque parcelle, la hauteur reelle du bati (m, pas juste levels_est en
-- niveaux) et le recul reel du bati vis-a-vis de CHAQUE cote de la
-- parcelle -- pas une distance generique uniforme. Or "quel cote donne sur
-- la rue" n'est pas une donnee vectorisee en open data (BD TOPO
-- troncon_de_route n'est pas ingeree). Solution retenue : classifier les
-- cotes d'une parcelle par ADJACENCE aux parcelles cadastrales voisines
-- (deja en base, aucune nouvelle ingestion necessaire) -- un cote qui ne
-- touche AUCUNE parcelle voisine borde forcement le domaine public (rue,
-- place), une parcelle d'angle produit naturellement plusieurs cotes
-- "facade".
-- ============================================================

-- =========================
-- 1) HAUTEUR REELLE (m) -- buildings
-- =========================
-- La hauteur BD TOPO (f.properties.hauteur, mesure LiDAR) est deja
-- recuperee par pipeline/route.ts (computeLevels()) mais jamais persistee
-- telle quelle, seulement convertie en levels_est (niveaux). Colonnes
-- additives, NULL par defaut -- aucun impact sur les lectures existantes
-- de buildings.
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS height_m NUMERIC,
  ADD COLUMN IF NOT EXISTS height_source TEXT
    CHECK (height_source IN ('bdtopo_lidar', 'estimation_niveaux') OR height_source IS NULL);

ALTER TABLE public.parcel_building_stats
  ADD COLUMN IF NOT EXISTS height_existing_m NUMERIC,
  ADD COLUMN IF NOT EXISTS height_existing_source TEXT;

-- Fonction de rafraichissement (separee de score_commune_parcels, qui
-- reste intouche) -- agrege MAX(buildings.height_m) sur les batiments
-- intersectant chaque parcelle de la commune. Idempotente, rejouable
-- apres un nouveau pipeline BD TOPO ou pour le backfill des communes deja
-- pipelinees (cf. sql/scripts/backfill_height_and_setbacks.sql).
CREATE OR REPLACE FUNCTION public.refresh_building_height_stats(p_insee TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE public.parcel_building_stats bs
  SET height_existing_m = h.height_max_m,
      height_existing_source = 'bdtopo_lidar',
      updated_at = now()
  FROM (
    SELECT p.parcel_id, MAX(b.height_m) AS height_max_m
    FROM public.parcels p
    JOIN public.buildings b ON ST_Intersects(p.geom, b.geom)
    WHERE p.insee_code = p_insee AND b.height_m IS NOT NULL
    GROUP BY p.parcel_id
  ) h
  WHERE bs.parcel_id = h.parcel_id;

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;

-- =========================
-- 2) CLASSIFICATION DES COTES DE PARCELLE PAR ADJACENCE
-- =========================
-- Grain : un segment du contour exterieur de la parcelle = un "cote".
-- edge_type :
--   'facade'  -- aucune parcelle cadastrale voisine ne touche ce segment
--               (hypothese : borde le domaine public -- rue, place. Peut
--               se tromper sur un terrain bordant un espace non cadastre
--               tel qu'un parc ou un cours d'eau -- limite documentee,
--               cf. Phase 2d optionnelle si besoin confirme en usage reel)
--   'lateral' -- segment adjacent a une parcelle voisine
--   'fond'    -- parmi les segments adjacents, le(s) plus eloigne(s) des
--               segments 'facade' (heuristique simple : le fond de
--               parcelle est structurellement oppose a la rue)
-- existing_setback_m : distance reelle (ST_Distance) entre ce segment et
-- le bati de la meme parcelle -- recul EXISTANT par cote, pas une moyenne
-- globale.
CREATE TABLE IF NOT EXISTS public.parcel_edge_classification (
  parcel_id TEXT NOT NULL REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
  edge_index INTEGER NOT NULL,
  edge_geom geometry(LineString, 2154) NOT NULL,
  edge_type TEXT NOT NULL CHECK (edge_type IN ('facade', 'lateral', 'fond')),
  length_m NUMERIC NOT NULL,
  existing_setback_m NUMERIC,  -- NULL si aucun bati sur la parcelle
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (parcel_id, edge_index)
);

CREATE INDEX IF NOT EXISTS idx_parcel_edge_classification_parcel
  ON public.parcel_edge_classification (parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_edge_classification_type
  ON public.parcel_edge_classification (edge_type);

-- Fonction batch, meme convention d'appel que score_commune_parcels(p_insee) :
-- traite toutes les parcelles d'UNE commune, rejouable (DELETE+INSERT).
-- Note de tolerance : ST_DWithin(..., 0.5) absorbe les imprecisions de
-- vectorisation cadastrale (deux parcelles "collees" mais separees par
-- quelques centimetres dans le cadastre vectoriel restent detectees comme
-- adjacentes).
CREATE OR REPLACE FUNCTION public.classify_commune_parcel_edges(p_insee TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_count INTEGER;
BEGIN
  DELETE FROM public.parcel_edge_classification pec
  USING public.parcels p
  WHERE pec.parcel_id = p.parcel_id AND p.insee_code = p_insee;

  WITH largest_ring AS (
    -- Un parcel.geom peut etre un MultiPolygon a plusieurs parties (rare) :
    -- on ne classifie que le plus grand polygone. Limite documentee, cas
    -- marginal (parcelles scindees en plusieurs ilots disjoints).
    SELECT DISTINCT ON (p.parcel_id)
      p.parcel_id,
      ST_ExteriorRing(dp.geom) AS ring
    FROM public.parcels p
    CROSS JOIN LATERAL ST_Dump(p.geom) AS dp
    WHERE p.insee_code = p_insee
    ORDER BY p.parcel_id, ST_Area(dp.geom) DESC
  ),
  pts AS (
    SELECT
      lr.parcel_id,
      (dpt).path[1] AS pt_order,
      (dpt).geom AS pt_geom
    FROM largest_ring lr
    CROSS JOIN LATERAL ST_DumpPoints(lr.ring) AS dpt
  ),
  segments AS (
    SELECT
      parcel_id,
      pt_order AS edge_index,
      ST_MakeLine(pt_geom, LEAD(pt_geom) OVER (PARTITION BY parcel_id ORDER BY pt_order)) AS edge_geom
    FROM pts
  ),
  segments_valid AS (
    SELECT * FROM segments WHERE edge_geom IS NOT NULL AND ST_Length(edge_geom) > 0
  ),
  with_adjacency AS (
    SELECT
      s.parcel_id,
      s.edge_index,
      s.edge_geom,
      ST_Length(s.edge_geom) AS length_m,
      EXISTS (
        SELECT 1
        FROM public.parcels nb
        WHERE nb.insee_code = p_insee
          AND nb.parcel_id <> s.parcel_id
          AND ST_DWithin(nb.geom, s.edge_geom, 0.5)
      ) AS has_neighbor
    FROM segments_valid s
  ),
  facade_edges AS (
    SELECT parcel_id, edge_index, edge_geom
    FROM with_adjacency
    WHERE NOT has_neighbor
  ),
  non_facade_with_dist AS (
    SELECT
      w.parcel_id,
      w.edge_index,
      w.edge_geom,
      w.length_m,
      (
        SELECT MIN(ST_Distance(w.edge_geom, f.edge_geom))
        FROM facade_edges f
        WHERE f.parcel_id = w.parcel_id
      ) AS dist_to_facade
    FROM with_adjacency w
    WHERE w.has_neighbor
  ),
  fond_flagged AS (
    SELECT
      parcel_id,
      edge_index,
      -- Si aucun cote 'facade' n'a ete trouve sur cette parcelle (rare :
      -- parcelle entierement enclavee), aucun 'fond' ne peut etre distingue
      -- -- tous les cotes adjacents restent 'lateral' (limite documentee).
      (dist_to_facade IS NOT NULL
        AND dist_to_facade = MAX(dist_to_facade) OVER (PARTITION BY parcel_id)
      ) AS is_fond
    FROM non_facade_with_dist
  ),
  classified AS (
    SELECT w.parcel_id, w.edge_index, w.edge_geom, w.length_m,
      CASE
        WHEN NOT w.has_neighbor THEN 'facade'
        WHEN ff.is_fond THEN 'fond'
        ELSE 'lateral'
      END AS edge_type
    FROM with_adjacency w
    LEFT JOIN fond_flagged ff
      ON ff.parcel_id = w.parcel_id AND ff.edge_index = w.edge_index
  )
  INSERT INTO public.parcel_edge_classification
    (parcel_id, edge_index, edge_geom, edge_type, length_m, existing_setback_m)
  SELECT
    c.parcel_id,
    c.edge_index,
    c.edge_geom,
    c.edge_type,
    c.length_m,
    (
      SELECT MIN(ST_Distance(c.edge_geom, b.geom))
      FROM public.buildings b
      JOIN public.parcels p ON p.parcel_id = c.parcel_id
      WHERE ST_Intersects(b.geom, p.geom)
    ) AS existing_setback_m
  FROM classified c;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

-- =========================
-- 3) RECULS PLU REELS (eventail par zone/indice reglementaire)
-- =========================
-- Distincte de plu_zone_rules_reel.recul_voie_m (deja pose en migration 66,
-- reste la reference facade cote PLU). Reste structurellement un eventail :
-- l'indice reglementaire exact d'une parcelle (A, B, C... sur plan
-- graphique PLU) n'est PAS vectorise en open data -- jamais une valeur
-- unique garantie par parcelle. Le gating de scenarios (Phase 2b) doit
-- utiliser le pire cas (le plus restrictif) de l'eventail.
CREATE TABLE IF NOT EXISTS public.plu_zone_rules_reel_prospect (
  id BIGSERIAL PRIMARY KEY,
  insee_code TEXT NOT NULL,
  zone_libelle TEXT NOT NULL,
  indice_reglementaire TEXT,              -- ex: 'A', 'B' -- NULL si pas d'indice dans le reglement
  setback_side_min_m NUMERIC,
  setback_side_max_m NUMERIC,
  setback_rear_min_m NUMERIC,
  setback_rear_max_m NUMERIC,
  is_range BOOLEAN NOT NULL DEFAULT true,  -- true = eventail (cas quasi systematique)
  source_extrait TEXT,
  methode_extraction TEXT NOT NULL DEFAULT 'regex_pluid'
    CHECK (methode_extraction IN ('llm_groq', 'regex_pluid', 'saisie_manuelle')),
  a_verifier BOOLEAN NOT NULL DEFAULT true,
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Pas de UNIQUE(insee_code, zone_libelle) : une zone peut avoir plusieurs
-- indices (A, B, C...) donc plusieurs lignes valides pour la meme zone.
CREATE INDEX IF NOT EXISTS idx_plu_zone_rules_reel_prospect_insee_zone
  ON public.plu_zone_rules_reel_prospect (insee_code, zone_libelle);

-- =========================
-- 4) RLS -- lecture publique, coherent avec le reste du schema foncier
-- =========================
ALTER TABLE public.parcel_edge_classification ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plu_zone_rules_reel_prospect ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parcel_edge_classification_public_read" ON public.parcel_edge_classification;
CREATE POLICY "parcel_edge_classification_public_read"
  ON public.parcel_edge_classification FOR SELECT USING (true);
DROP POLICY IF EXISTS "plu_zone_rules_reel_prospect_public_read" ON public.plu_zone_rules_reel_prospect;
CREATE POLICY "plu_zone_rules_reel_prospect_public_read"
  ON public.plu_zone_rules_reel_prospect FOR SELECT USING (true);

-- ============================================================
-- Verification (a executer manuellement) :
--
--   -- 1. Colonnes creees :
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'buildings' AND column_name IN ('height_m', 'height_source');
--
--   -- 2. Backfill hauteur sur une commune deja pipelinee (Vitry) :
--   SELECT public.refresh_building_height_stats('94081');
--   SELECT count(*) FROM public.parcel_building_stats bs
--   JOIN public.parcels p ON p.parcel_id = bs.parcel_id
--   WHERE p.insee_code = '94081' AND bs.height_existing_m IS NOT NULL;
--   -- NB : ne renverra des lignes que si des buildings.height_m sont deja
--   -- non-NULL, ce qui suppose un re-pipeline (step 1b) apres la migration
--   -- de pipeline-functions.sql / pipeline/route.ts (cf. tache dediee).
--
--   -- 3. Classification des cotes sur Vitry :
--   SELECT public.classify_commune_parcel_edges('94081');
--   SELECT edge_type, count(*) FROM public.parcel_edge_classification pec
--   JOIN public.parcels p ON p.parcel_id = pec.parcel_id
--   WHERE p.insee_code = '94081' GROUP BY edge_type;
--   -- Sur une parcelle d'angle connue, verifier >= 2 segments 'facade' :
--   SELECT parcel_id, edge_index, edge_type, length_m, existing_setback_m
--   FROM public.parcel_edge_classification WHERE parcel_id = '<parcelle_angle_test>'
--   ORDER BY edge_index;
--
--   -- 4. Non-regression stricte (score_commune_parcels n'est PAS touche par
--   -- cette migration, mais a revalider par prudence) :
--   SELECT public.score_commune_parcels('<commune_temoin>', 4000);
--   -- mutability_score / residual_potential_est identiques a avant.
-- ============================================================
