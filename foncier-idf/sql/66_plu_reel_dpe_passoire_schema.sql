-- =========================================
-- DATAMERRY — Sous-densité réelle (PLU + DPE passoire)
-- Tables additives : aucune fonction/vue existante n'est modifiée ici.
-- =========================================
--
-- Contexte : score_commune_parcels() utilise aujourd'hui des constantes
-- generiques (v_h=12m, v_fp=0.40 CES) identiques pour toute l'IDF. Ces
-- tables stockent les VRAIES regles PLU extraites par commune x zone
-- (prototype Python : section_finder.py + plu_extract.py, regex gratuit
-- sur PLUi tabulaires + repli LLM Groq sur formats libres) et les flags
-- DPE passoire thermique par batiment (copropriete ou maison), pour
-- corriger le scoring a la source (cf. migration 67) sans rien casser
-- pour les communes non encore extraites (repli garanti).

-- =========================
-- 1) REGLES PLU REELLES PAR COMMUNE x ZONE
-- =========================
-- Distincte de plu_zone_rules (archetypes generiques BNS, INCHANGEE, reste
-- le vocabulaire de repli conceptuel). Cle (insee_code, zone_libelle) car
-- zone_libelle seul collisionne entre communes (ex. "UH" existe partout).
-- Si une zone de PLUi couvre plusieurs communes, on duplique une ligne par
-- commune a l'import (plus simple a joindre qu'une cle multi-communes).
CREATE TABLE IF NOT EXISTS public.plu_zone_rules_reel (
  id BIGSERIAL PRIMARY KEY,
  insee_code TEXT NOT NULL,
  zone_libelle TEXT NOT NULL,             -- libelle BRUT du reglement (ex: 'UH', 'UBb')
  zone_family TEXT,                       -- U/AU/A/N si deductible, sinon NULL
  vocation TEXT,                          -- residentiel/economique/mixte si deductible
  ces NUMERIC,                            -- coefficient emprise au sol reel (0-1), NULL si non reglemente
  hauteur_max_m NUMERIC,                  -- hauteur max reelle (m), NULL si non reglementee
  bande_constructible_m NUMERIC,          -- profondeur de bande constructible depuis alignement (m)
  recul_voie_m NUMERIC,                   -- recul/retrait obligatoire vs voie (m)
  destinations_autorisees TEXT[],         -- nomenclature CNIG (ex: {logement, commerce_detail})
  destinations_interdites TEXT[],
  source_extrait TEXT,                    -- extrait brut du reglement (tracabilite/audit)
  source_document TEXT,                   -- reference du PLU/PLUi (nom fichier, URL GPU...)
  methode_extraction TEXT NOT NULL DEFAULT 'llm_groq'
    CHECK (methode_extraction IN ('llm_groq', 'regex_pluid', 'saisie_manuelle')),
  a_verifier BOOLEAN NOT NULL DEFAULT true,  -- true tant qu'un humain n'a pas valide
  confidence NUMERIC,                     -- score de confiance optionnel (0-1)
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_plu_zone_rules_reel_insee_zone
  ON public.plu_zone_rules_reel (insee_code, zone_libelle);
CREATE INDEX IF NOT EXISTS idx_plu_zone_rules_reel_insee
  ON public.plu_zone_rules_reel (insee_code);

-- =========================
-- 2) ZONAGE GEOMETRIQUE REEL (GPU zone-urba)
-- =========================
-- Meme SRID que parcels.geom (Lambert93/2154) pour un ST_Contains direct
-- du centroide parcelle, sans reprojection a la volee dans le scoring.
CREATE TABLE IF NOT EXISTS public.plu_zone_urba_geom (
  id BIGSERIAL PRIMARY KEY,
  insee_code TEXT NOT NULL,
  zone_libelle TEXT NOT NULL,             -- doit correspondre a plu_zone_rules_reel.zone_libelle
  gpu_partition TEXT,                     -- identifiant de partition GPU d'origine (tracabilite)
  geom geometry(MultiPolygon, 2154) NOT NULL,
  source_millesime DATE,                  -- date de publication de la donnee GPU utilisee
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plu_zone_urba_geom_geom
  ON public.plu_zone_urba_geom USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_plu_zone_urba_geom_insee
  ON public.plu_zone_urba_geom (insee_code);

-- =========================
-- 3) DPE PASSOIRE PAR GROUPE-BATIMENT (grain natif du prototype Python)
-- =========================
-- IMPORTANT : la table public.buildings (BD TOPO) n'expose AUCUN identifiant
-- comparable au DPE ADEME (pas de id_rnb/cleabs) -- verifie avant d'ecrire
-- cette migration. Le rattachement au foncier se fait donc DIRECTEMENT
-- point-groupe-DPE -> parcelle (cf. fonction aggregate_parcel_dpe_stats,
-- migration 69), PAS via une jointure a buildings.building_id.
-- building_key = id_rnb, sinon numero_dpe_immeuble_associe, sinon adresse
-- normalisee (ordre de preference valide sur Vitry : 5% / 82% / 100% de
-- remplissage constate).
CREATE TABLE IF NOT EXISTS public.dpe_batiment_groupes (
  building_key TEXT NOT NULL,
  insee_code TEXT NOT NULL,
  lon DOUBLE PRECISION,
  lat DOUBLE PRECISION,
  dpe_total_count INTEGER NOT NULL DEFAULT 0,
  dpe_fg_count INTEGER NOT NULL DEFAULT 0,
  dpe_fg_ratio NUMERIC,
  copropriete_probable BOOLEAN NOT NULL DEFAULT false,  -- >= 2 logements distincts groupes
  nb_logements_estime INTEGER,
  dpe_passoire BOOLEAN NOT NULL DEFAULT false,          -- >= 50% des etiquettes du groupe en F/G
  dpe_passoire_copro BOOLEAN NOT NULL DEFAULT false,    -- passoire ET copropriete_probable
  dpe_passoire_maison BOOLEAN NOT NULL DEFAULT false,   -- passoire ET NOT copropriete_probable
  matching_method TEXT,                                 -- 'id_rnb' | 'numero_dpe_immeuble' | 'adresse'
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (insee_code, building_key)
);

CREATE INDEX IF NOT EXISTS idx_dpe_batiment_groupes_insee ON public.dpe_batiment_groupes (insee_code);
CREATE INDEX IF NOT EXISTS idx_dpe_batiment_groupes_passoire
  ON public.dpe_batiment_groupes (dpe_passoire) WHERE dpe_passoire = true;

-- Table de consommation (grain parcelle, cf. get_mvt_tile/v_parcel_sous_densite) :
-- agregee depuis dpe_batiment_groupes par proximite spatiale (pas de FK a
-- buildings, pas de FK a parcels non plus car le rattachement est fuzzy/tolerance
-- et peut echouer -- coherent avec le taux de rattachement observe de 62% sur Vitry).
CREATE TABLE IF NOT EXISTS public.parcel_dpe_stats (
  parcel_id TEXT PRIMARY KEY REFERENCES public.parcels(parcel_id) ON DELETE CASCADE,
  dpe_passoire_any BOOLEAN NOT NULL DEFAULT false,
  dpe_passoire_copro BOOLEAN NOT NULL DEFAULT false,
  dpe_passoire_maison BOOLEAN NOT NULL DEFAULT false,
  nb_groupes_passoire INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================
-- 4) COLONNE DE TRACABILITE DU SCORING (reel vs generique)
-- =========================
ALTER TABLE public.parcel_constructibility
  ADD COLUMN IF NOT EXISTS ces_source TEXT NOT NULL DEFAULT 'generique'
    CHECK (ces_source IN ('reel', 'generique'));

-- =========================
-- 5) RLS -- lecture publique, coherent avec le reste du schema foncier
--    (dej deja toutes en lecture publique : parcels, parcel_scores, etc.)
--    L'acces a la FONCTIONNALITE "sous-densite" est filtre cote route API
--    applicative (session + abonnement), pas via RLS -- cf. migration 70+.
-- =========================
ALTER TABLE public.plu_zone_rules_reel ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plu_zone_urba_geom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dpe_batiment_groupes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parcel_dpe_stats ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY IF NOT EXISTS n'existe pas en PostgreSQL (contrairement a
-- CREATE TABLE) -- DROP POLICY IF EXISTS + CREATE POLICY pour rejouabilite.
DROP POLICY IF EXISTS "plu_zone_rules_reel_public_read" ON public.plu_zone_rules_reel;
CREATE POLICY "plu_zone_rules_reel_public_read" ON public.plu_zone_rules_reel FOR SELECT USING (true);
DROP POLICY IF EXISTS "plu_zone_urba_geom_public_read" ON public.plu_zone_urba_geom;
CREATE POLICY "plu_zone_urba_geom_public_read" ON public.plu_zone_urba_geom FOR SELECT USING (true);
DROP POLICY IF EXISTS "dpe_batiment_groupes_public_read" ON public.dpe_batiment_groupes;
CREATE POLICY "dpe_batiment_groupes_public_read" ON public.dpe_batiment_groupes FOR SELECT USING (true);
DROP POLICY IF EXISTS "parcel_dpe_stats_public_read" ON public.parcel_dpe_stats;
CREATE POLICY "parcel_dpe_stats_public_read" ON public.parcel_dpe_stats FOR SELECT USING (true);
