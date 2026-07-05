-- ============================================================
-- Migration 73 : catalogue des scenarios de redeveloppement + instances
-- persistees par parcelle.
--
-- Phase 2b du plan "prefaisabilite complete" -- suite de la Phase 2a
-- (migrations 71/72). Purement additif.
-- ============================================================

-- =========================
-- 1) CATALOGUE DES TYPES DE SCENARIOS (reference, quasi-statique)
-- =========================
CREATE TABLE IF NOT EXISTS public.dim_scenario_types (
  scenario_type TEXT PRIMARY KEY CHECK (scenario_type IN (
    'demolition_reconstruction',
    'surelevation',
    'construction_neuve_meme_parcelle',
    'changement_usage',
    'strategie_mixte'
  )),
  label_fr TEXT NOT NULL,
  description TEXT,
  requiert_demolition BOOLEAN NOT NULL DEFAULT false,
  requiert_permis_construire BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO public.dim_scenario_types (scenario_type, label_fr, description, requiert_demolition) VALUES
  ('demolition_reconstruction', 'Demolition-reconstruction', 'Demolir l''existant, reconstruire au maximum autorise par le PLU', true),
  ('surelevation', 'Surelevation', 'Ajouter des niveaux sur le batiment existant, conserver le rez-de-chaussee et les etages actuels', false),
  ('construction_neuve_meme_parcelle', 'Construction d''un 2e batiment', 'Construire sur la partie non batie de la parcelle, conserver l''existant', false),
  ('changement_usage', 'Changement d''usage', 'Reconvertir l''existant (ex: bureau vers logement) sans construire', false),
  ('strategie_mixte', 'Strategie mixte', 'Conserver la location existante et ajouter une operation de promotion (surelevation ou construction neuve) sur la meme parcelle', false)
ON CONFLICT (scenario_type) DO NOTHING;

ALTER TABLE public.dim_scenario_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dim_scenario_types_public_read" ON public.dim_scenario_types;
CREATE POLICY "dim_scenario_types_public_read" ON public.dim_scenario_types FOR SELECT USING (true);

-- =========================
-- 2) INSTANCES DE SCENARIOS PAR PARCELLE
-- =========================
-- Persistance necessaire car le simulateur (Phase 2c) est interactif :
-- l'utilisateur doit pouvoir revenir sur "ses" scenarios sauvegardes, pas
-- juste un calcul volatile cote client.
CREATE TABLE IF NOT EXISTS public.parcel_scenarios (
  id BIGSERIAL PRIMARY KEY,
  parcel_id TEXT NOT NULL REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
  scenario_type TEXT NOT NULL REFERENCES public.dim_scenario_types(scenario_type),
  cabinet_slug TEXT,               -- NULL si simulation anonyme, sinon rattachee a un cabinet
  created_by_session TEXT,         -- identifiant de session admin cabinet si applicable
  profil TEXT NOT NULL DEFAULT 'promoteur' CHECK (profil IN ('promoteur', 'investisseur', 'mixte')),
  -- Snapshot des conditions PLU au moment du calcul (tracabilite/audit) --
  -- rejoue check_scenario_gating() et fige le resultat, ne recalcule pas
  -- a la volee a chaque lecture (le PLU/l'extraction peut evoluer).
  gating_ok BOOLEAN NOT NULL,
  gating_reasons JSONB,
  -- Hypotheses utilisateur (tout ce qui est modifiable dans le simulateur,
  -- Phase 2c) : prix neuf, cout construction, mode vente, demolition, etc.
  hypotheses_json JSONB NOT NULL,
  -- Resultat du moteur financier (bilan-promoteur.ts / cashflow-investisseur.ts),
  -- persiste pour eviter de recalculer a chaque affichage.
  resultat_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_parcel_scenarios_parcel ON public.parcel_scenarios (parcel_id);
CREATE INDEX IF NOT EXISTS idx_parcel_scenarios_cabinet ON public.parcel_scenarios (cabinet_slug) WHERE cabinet_slug IS NOT NULL;

-- RLS : PAS de lecture publique (contrairement au reste du schema foncier) --
-- ce sont des hypotheses/resultats potentiellement lies a un cabinet
-- payant. Acces exclusivement via service role depuis les routes API
-- (meme logique d'ecriture que dpe_batiment_groupes/parcel_dpe_stats cote
-- pipeline, mais ici sans policy SELECT publique du tout).
ALTER TABLE public.parcel_scenarios ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Verification (a executer manuellement) :
--   SELECT * FROM public.dim_scenario_types ORDER BY scenario_type;
--   -- 5 lignes attendues.
--   INSERT INTO public.parcel_scenarios (parcel_id, scenario_type, profil, gating_ok, hypotheses_json)
--   VALUES ('<parcel_id_test>', 'surelevation', 'promoteur', true, '{}'::jsonb);
--   SELECT * FROM public.parcel_scenarios WHERE parcel_id = '<parcel_id_test>';
-- ============================================================
