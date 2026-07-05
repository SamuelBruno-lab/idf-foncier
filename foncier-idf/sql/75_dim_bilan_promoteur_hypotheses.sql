-- ============================================================
-- Migration 75 : dim_bilan_promoteur_hypotheses
-- Miroir du pattern dim_rendement_hypotheses (sql/17_fact_rendement.sql) --
-- table singleton d'hypotheses par defaut, modifiable par l'admin en SQL
-- direct (pas de route d'ecriture, coherent avec dim_rendement_hypotheses
-- qui n'en a pas non plus).
--
-- Reprend les constantes du prototype Python (estimation_auto.py, cascade
-- validee sur le 109 Vitry) et AJOUTE les deux lignes qui en etaient
-- absentes (demolition, depollution) ainsi que la distinction vente en
-- bloc / vente a la decoupe (marge cible differente).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dim_bilan_promoteur_hypotheses (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton global
  ratio_shab_sdp NUMERIC NOT NULL DEFAULT 0.80,
  cout_construction_eur_m2_defaut NUMERIC NOT NULL DEFAULT 2000,
  cout_vrd_eur_m2_terrain NUMERIC NOT NULL DEFAULT 100,
  -- NOUVEAU -- absent du prototype Python, indispensable pour le scenario
  -- demolition-reconstruction.
  cout_demolition_eur_m2_emprise NUMERIC NOT NULL DEFAULT 150,
  -- NOUVEAU -- NULL par defaut : jamais une estimation inventee. Doit etre
  -- saisi manuellement (par ligne de scenario, pas ici) si le terrain est
  -- identifie a risque (ex: ancien site industriel).
  cout_depollution_eur_m2_defaut NUMERIC,
  taux_commercialisation_pct NUMERIC NOT NULL DEFAULT 3,
  taux_frais_financiers_taxe_pct NUMERIC NOT NULL DEFAULT 6,
  -- Vente en bloc (marchand de biens) vs vente a la decoupe (promoteur
  -- classique) -- le prototype n'avait qu'une seule marge generique (8%),
  -- ici distinguee car la decoupe porte un risque de commercialisation
  -- plus long, donc une marge cible plus elevee.
  taux_marge_promoteur_bloc_pct NUMERIC NOT NULL DEFAULT 8,
  taux_marge_promoteur_decoupe_pct NUMERIC NOT NULL DEFAULT 12,
  coefficient_rendement_net_investisseur NUMERIC NOT NULL DEFAULT 0.68,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.dim_bilan_promoteur_hypotheses (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.dim_bilan_promoteur_hypotheses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "dim_bilan_promoteur_hypotheses_public_read" ON public.dim_bilan_promoteur_hypotheses;
CREATE POLICY "dim_bilan_promoteur_hypotheses_public_read"
  ON public.dim_bilan_promoteur_hypotheses FOR SELECT USING (true);
-- Pas de policy INSERT/UPDATE publique : modification admin uniquement via
-- SQL direct (Supabase SQL editor), coherent avec dim_rendement_hypotheses.

-- ============================================================
-- Verification (a executer manuellement) :
--   SELECT * FROM public.dim_bilan_promoteur_hypotheses WHERE id = 1;
--   -- 1 ligne, toutes les valeurs par defaut documentees ci-dessus.
-- ============================================================
