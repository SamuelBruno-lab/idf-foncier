-- ============================================================
-- Migration 44 — Lead Routing géo-spatial pour Collabimo / DATAMERRY
-- ============================================================
-- Crée :
--   • dim_collabimo_members : membres du réseau (vendeurs, acheteurs,
--     mandataires, apporteurs d'affaires) avec géolocalisation
--   • matching_config : config par cabinet du matching (rayons, mode
--     adaptatif, etc.)
--   • lead_match_history : historique des matches proposés + arbitrages
--
-- Logique métier :
--   1. Un lead capturé via widget DATAMERRY est géocodé
--   2. Le système cherche les membres dans un rayon paramétrable
--   3. Mode adaptatif : élargit le rayon si pas assez de matches
--   4. L'admin cabinet (Diara) arbitre : garder, attribuer, matcher
--   5. Tout est tracé pour pilotage KPI
-- ============================================================

BEGIN;

-- ─── PostGIS ─────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================
-- Table 1 : dim_collabimo_members
-- Représente chaque inscrit sur la plateforme Collabimo (peut
-- venir d'une synchro CSV/API depuis collabimo.com Softr).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.dim_collabimo_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_slug    TEXT NOT NULL DEFAULT 'collabimo',

  -- Identité
  member_external_id TEXT,         -- id côté Softr/Collabimo
  first_name      TEXT,
  last_name       TEXT,
  email           TEXT NOT NULL,
  phone           TEXT,

  -- Type de membre (clé pour le matching)
  member_type     TEXT NOT NULL
                   CHECK (member_type IN (
                     'vendeur',
                     'acheteur',
                     'mandataire',
                     'apporteur'
                   )),

  -- Géolocalisation
  address_text    TEXT,
  city            TEXT,
  postal_code     TEXT,
  geo_point       GEOGRAPHY(POINT, 4326),   -- WGS84 lat/lng

  -- Caractéristiques marché
  specialty       TEXT,                       -- 'hnwi', 'standard', 'commercial'…
  ticket_min_eur  BIGINT,
  ticket_max_eur  BIGINT,
  avg_deals_per_year INT,                     -- track-record

  -- État
  is_active       BOOLEAN DEFAULT true,
  last_activity_at TIMESTAMPTZ,
  joined_at       TIMESTAMPTZ DEFAULT now(),

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dim_collabimo_members_email_key
  ON public.dim_collabimo_members (cabinet_slug, email);

CREATE INDEX IF NOT EXISTS dim_collabimo_members_geo_gix
  ON public.dim_collabimo_members USING GIST (geo_point);

CREATE INDEX IF NOT EXISTS dim_collabimo_members_type_active
  ON public.dim_collabimo_members (cabinet_slug, member_type, is_active);

COMMENT ON TABLE public.dim_collabimo_members IS
  'Membres du réseau Collabimo (vendeurs, acheteurs, mandataires, apporteurs) avec géolocalisation pour matching.';

-- ============================================================
-- Table 2 : matching_config
-- Paramètres de matching par cabinet (Diara contrôle tout depuis
-- son admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.matching_config (
  cabinet_slug    TEXT PRIMARY KEY,

  -- Rayons par type de membre (km)
  radius_mandataire_km  INT DEFAULT 30,
  radius_apporteur_km   INT DEFAULT 100,
  radius_vendeur_km     INT DEFAULT 50,
  radius_acheteur_km    INT DEFAULT 25,

  -- Rayons par densité de zone (override le rayon par type si plus restrictif)
  radius_paris_km       INT DEFAULT 5,
  radius_metro_km       INT DEFAULT 15,
  radius_default_km     INT DEFAULT 50,

  -- Bornes du système
  min_matches           INT DEFAULT 1,
  max_matches           INT DEFAULT 10,

  -- Mode adaptatif (élargit progressivement le rayon si pas assez de matches)
  adaptive_mode         BOOLEAN DEFAULT true,
  adaptive_target_matches INT DEFAULT 5,
  adaptive_max_radius_km INT DEFAULT 500,    -- borne sup absolue

  -- Préférences UX
  show_no_match_message TEXT DEFAULT 'Aucun membre Collabimo trouvé proche du bien. Le lead sera traité directement par notre équipe.',

  updated_at      TIMESTAMPTZ DEFAULT now(),
  updated_by      UUID
);

-- Seed valeurs par défaut pour Collabimo
INSERT INTO public.matching_config (cabinet_slug) VALUES ('collabimo')
ON CONFLICT (cabinet_slug) DO NOTHING;

-- Idem pour collabimo-test (env de test)
INSERT INTO public.matching_config (cabinet_slug) VALUES ('collabimo-test')
ON CONFLICT (cabinet_slug) DO NOTHING;

-- Idem pour eurealimmo (au cas où il veut utiliser le routing pour lui-même)
INSERT INTO public.matching_config (cabinet_slug) VALUES ('eurealimmo')
ON CONFLICT (cabinet_slug) DO NOTHING;

COMMENT ON TABLE public.matching_config IS
  'Paramètres de matching géo-spatial par cabinet (rayons, mode adaptatif, etc.). Modifiable depuis dashboard admin.';

-- ============================================================
-- Table 3 : lead_match_history
-- Historique des arbitrages (qui a routé quel lead vers qui, quand)
-- Sert au KPI matching + à l'audit
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lead_match_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_slug    TEXT NOT NULL,

  lead_id         UUID NOT NULL,            -- FK logique vers dim_cabinet_leads
  lead_type       TEXT NOT NULL
                   CHECK (lead_type IN ('vendeur', 'acheteur')),

  lead_geo_point  GEOGRAPHY(POINT, 4326),

  -- Résultat de la recherche
  radius_km_used  INT NOT NULL,
  total_matches_found INT NOT NULL,
  adaptive_iterations INT DEFAULT 0,   -- nb de fois où on a élargi
  match_ids       UUID[] DEFAULT '{}',  -- ids des membres trouvés

  -- Arbitrage (rempli par l'admin)
  decision        TEXT
                   CHECK (decision IN (
                     'pending',
                     'kept_self',          -- gardé pour le cabinet (mandat direct)
                     'assigned_member',    -- attribué à un membre Collabimo
                     'matched_buyer',      -- matché avec un acheteur Collabimo
                     'skipped'             -- ignoré (lead jugé non qualifié)
                   )) DEFAULT 'pending',

  decided_member_id UUID,              -- id du membre choisi si decision = 'assigned_member' ou 'matched_buyer'
  decided_by      UUID,                -- user_id de l'admin qui a décidé
  decided_at      TIMESTAMPTZ,

  -- Notes admin
  notes           TEXT,

  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_match_history_cabinet_date
  ON public.lead_match_history (cabinet_slug, created_at DESC);

CREATE INDEX IF NOT EXISTS lead_match_history_lead_id
  ON public.lead_match_history (lead_id);

CREATE INDEX IF NOT EXISTS lead_match_history_decision
  ON public.lead_match_history (cabinet_slug, decision);

COMMENT ON TABLE public.lead_match_history IS
  'Historique des matches proposés et arbitrages admin pour pilotage KPI lead routing.';

-- ============================================================
-- Function : find_nearby_collabimo_members
-- Trouve les membres dans un rayon donné, triés par distance
-- ============================================================
CREATE OR REPLACE FUNCTION public.find_nearby_collabimo_members(
  p_cabinet_slug TEXT,
  p_lead_lat NUMERIC,
  p_lead_lng NUMERIC,
  p_radius_km INT,
  p_member_types TEXT[] DEFAULT ARRAY['vendeur', 'acheteur', 'mandataire', 'apporteur'],
  p_max_results INT DEFAULT 10
)
RETURNS TABLE (
  member_id UUID,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  member_type TEXT,
  city TEXT,
  postal_code TEXT,
  specialty TEXT,
  distance_km NUMERIC,
  avg_deals_per_year INT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    m.id AS member_id,
    m.first_name,
    m.last_name,
    m.email,
    m.member_type,
    m.city,
    m.postal_code,
    m.specialty,
    ROUND(
      (ST_Distance(
        m.geo_point,
        ST_SetSRID(ST_MakePoint(p_lead_lng, p_lead_lat), 4326)::geography
      ) / 1000)::numeric,
      2
    ) AS distance_km,
    m.avg_deals_per_year
  FROM public.dim_collabimo_members m
  WHERE m.cabinet_slug = p_cabinet_slug
    AND m.is_active = true
    AND m.member_type = ANY(p_member_types)
    AND m.geo_point IS NOT NULL
    AND ST_DWithin(
      m.geo_point,
      ST_SetSRID(ST_MakePoint(p_lead_lng, p_lead_lat), 4326)::geography,
      p_radius_km * 1000     -- conversion km → mètres pour PostGIS
    )
  ORDER BY m.geo_point <-> ST_SetSRID(ST_MakePoint(p_lead_lng, p_lead_lat), 4326)::geography
  LIMIT p_max_results;
$$;

COMMENT ON FUNCTION public.find_nearby_collabimo_members IS
  'Recherche les membres Collabimo dans un rayon (km) du lead. Retourne triés par distance croissante. Utilise PostGIS GIST pour performance.';

-- ============================================================
-- RLS : un cabinet ne voit que SES propres données
-- ============================================================
ALTER TABLE public.dim_collabimo_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matching_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_match_history ENABLE ROW LEVEL SECURITY;

-- Policies : accès via service_role (backend) — RLS bloque le client direct
-- Les UI passent par notre API Next.js avec service_role

COMMIT;

-- ============================================================
-- Seed Diara comme premier "mandataire" Collabimo (cohérence onboarding)
-- ============================================================
DO $seed$
DECLARE
  v_count INT;
BEGIN
  SELECT count(*) INTO v_count FROM public.dim_collabimo_members WHERE cabinet_slug = 'collabimo';
  IF v_count = 0 THEN
    INSERT INTO public.dim_collabimo_members (
      cabinet_slug, first_name, last_name, email, member_type,
      city, postal_code, geo_point, specialty,
      ticket_min_eur, ticket_max_eur, avg_deals_per_year
    ) VALUES (
      'collabimo', 'Diara', 'CAMARA', 'diara.camara@collabimo.com',
      'mandataire',
      'Paris', '75017',
      ST_SetSRID(ST_MakePoint(2.310, 48.886), 4326)::geography,   -- Paris 17e
      'hnwi',
      500000, 5000000, 5
    );
    RAISE NOTICE 'Seed : Diara CAMARA ajoutée comme mandataire HNWI Collabimo Paris 17e';
  END IF;
END $seed$;
