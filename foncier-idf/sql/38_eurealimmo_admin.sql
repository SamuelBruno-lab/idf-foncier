-- ============================================================================
-- 38_eurealimmo_admin.sql
--
-- Tables pour le back-office Eurealimmo Réseau (migration depuis Botble admin).
--
-- Architecture :
--   - Stack identique à DATAMERRY (Next.js + Supabase)
--   - Réutilise les tables locations DATAMERRY (INSEE déjà rempli France)
--   - Authentification via Supabase Auth (pas de hash password en clair)
--   - RLS service_role pour l'admin, RLS lecture publique pour le front
--
-- Modules couverts (basés sur 9 captures Botble admin) :
--   1. eurealimmo_mandataires (= Accounts Real Estate Botble)
--   2. eurealimmo_categories  (taxonomies biens, hiérarchique)
--   3. eurealimmo_features    (caractéristiques biens : balcon, parking…)
--   4. eurealimmo_properties  (biens en mandat)
--   5. eurealimmo_pages       (CMS pages)
--   6. eurealimmo_property_features (table de jonction many-to-many)
--   7. eurealimmo_property_images   (galerie photos par bien)
--
-- NON couverts (Y2) : Projects, Reviews, Invoices, Reports, Blog, Newsletters.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Mandataires (= Accounts Real Estate Botble + extensions DATAMERRY)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eurealimmo_mandataires (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identité (Botble Accounts standard)
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  username TEXT UNIQUE NOT NULL,
  permalink TEXT UNIQUE NOT NULL,  -- slug URL public : /agents/{permalink}
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  date_of_birth DATE,
  description TEXT,                -- bio public

  -- Société de rattachement
  company_name TEXT,

  -- Localisation principale
  country_code TEXT DEFAULT 'FR',
  state_name TEXT,                 -- région (Île-de-France, etc.)
  city_name TEXT,

  -- Média
  profile_picture_url TEXT,

  -- Flags Botble
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_blocked BOOLEAN NOT NULL DEFAULT false,
  block_reason TEXT,
  is_public_profile BOOLEAN NOT NULL DEFAULT true,

  -- Champs DATAMERRY/Eurealimmo (loi Hoguet + contrat Option D)
  carte_t TEXT,                     -- N° CPI 7501... (si titulaire)
  carte_t_rco_via_titulaire TEXT,   -- N° RCO (si rattaché à un autre titulaire)
  garantie_financiere_compagnie TEXT,
  garantie_financiere_montant_eur NUMERIC(12, 0),

  -- Contrat Eurealimmo Réseau
  contract_signed_at TIMESTAMPTZ,
  contract_end_at TIMESTAMPTZ,
  contract_lock_until TIMESTAMPTZ,  -- Option D : lock 36 mois
  monthly_subscription_eur NUMERIC(8, 2),  -- 39€ ou 59€
  free_months_remaining INTEGER DEFAULT 0,  -- 6 mois gratuits Option D
  commission_eurealimmo_pct NUMERIC(5, 2),  -- % sur com mandataire (5% Option D)
  referral_pct NUMERIC(5, 2),               -- 18% si recruté via HNWI referral

  -- Spécialité
  specialty TEXT
    CHECK (specialty IN ('hnwi', 'standard', 'commercial', 'location', NULL)),

  -- Statut activité
  is_active BOOLEAN NOT NULL DEFAULT true,
  credits INTEGER NOT NULL DEFAULT 0,   -- crédits pour publication biens
  active_properties_count INTEGER NOT NULL DEFAULT 0,

  -- Lien Supabase Auth (password géré par Supabase Auth, pas ici)
  auth_user_id UUID UNIQUE,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT mandataires_email_lower_ck CHECK (email = lower(email))
);

CREATE INDEX IF NOT EXISTS idx_mandataires_active
  ON public.eurealimmo_mandataires (is_active, is_blocked);
CREATE INDEX IF NOT EXISTS idx_mandataires_featured
  ON public.eurealimmo_mandataires (is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_mandataires_city
  ON public.eurealimmo_mandataires (country_code, state_name, city_name);

COMMENT ON TABLE public.eurealimmo_mandataires IS
  'Mandataires du réseau Eurealimmo : agents commerciaux loués sous notre carte T (RCO) ou titulaires propres. Source du CRM réseau Y1.';
COMMENT ON COLUMN public.eurealimmo_mandataires.carte_t IS
  'Numéro carte T propre (CPI 7501...). NULL si mandataire rattaché via RCO à notre carte T Eurealimmo.';
COMMENT ON COLUMN public.eurealimmo_mandataires.referral_pct IS
  'Pourcentage de commission reversée à celui qui a apporté ce mandataire (ex: 18% Diara HNWI). 0 si pas de referral.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Catégories de biens (hiérarchique avec parent_id)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eurealimmo_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID REFERENCES public.eurealimmo_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'draft', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,  -- pour le drag & drop
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_categories_parent
  ON public.eurealimmo_categories (parent_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_categories_status
  ON public.eurealimmo_categories (status) WHERE status = 'published';

-- Seed des catégories standards FR (au lieu de Apartment / Villa / Condo US)
INSERT INTO public.eurealimmo_categories (name, slug, is_default, sort_order)
VALUES
  ('Appartement', 'appartement', true, 1),
  ('Maison', 'maison', false, 2),
  ('Hôtel particulier', 'hotel-particulier', false, 3),
  ('Loft / Atelier', 'loft-atelier', false, 4),
  ('Château / Domaine', 'chateau-domaine', false, 5),
  ('Pied-à-terre', 'pied-a-terre', false, 6),
  ('Immeuble', 'immeuble', false, 7),
  ('Terrain', 'terrain', false, 8),
  ('Local commercial', 'local-commercial', false, 9),
  ('Bureau', 'bureau', false, 10)
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Features (caractéristiques biens, ex: Balcon / Parking / Vue)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eurealimmo_features (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon_name TEXT,                  -- nom d'icône Lucide / Heroicons
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'draft', 'archived')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed des features FR HNWI (au lieu de "Spa & Massage" ×18)
INSERT INTO public.eurealimmo_features (name, slug, icon_name, sort_order)
VALUES
  ('Balcon', 'balcon', 'square', 1),
  ('Terrasse', 'terrasse', 'sun', 2),
  ('Loggia', 'loggia', 'square', 3),
  ('Jardin', 'jardin', 'tree', 4),
  ('Piscine', 'piscine', 'droplet', 5),
  ('Parking', 'parking', 'car', 10),
  ('Garage', 'garage', 'car', 11),
  ('Cave', 'cave', 'archive', 12),
  ('Cellier', 'cellier', 'package', 13),
  ('Cheminée', 'cheminee', 'flame', 20),
  ('Climatisation', 'climatisation', 'wind', 21),
  ('Ascenseur', 'ascenseur', 'arrow-up-down', 22),
  ('Gardien', 'gardien', 'shield', 23),
  ('Vue dégagée', 'vue-degagee', 'eye', 30),
  ('Pied dans l''eau', 'pied-dans-eau', 'waves', 31),
  ('Calme', 'calme', 'volume-x', 32),
  ('Lumineux', 'lumineux', 'sun', 33),
  ('Exposition Sud', 'exposition-sud', 'sun', 34),
  ('Standing', 'standing', 'crown', 40),
  ('Récent', 'recent', 'sparkles', 41),
  ('Rénové', 'renove', 'wrench', 42),
  ('À rénover', 'a-renover', 'hammer', 43),
  ('Neuf', 'neuf', 'sparkles', 44),
  ('Cuisine équipée', 'cuisine-equipee', 'utensils', 50),
  ('Dressing', 'dressing', 'shirt', 51),
  ('Bureau', 'bureau', 'briefcase', 52),
  ('Suite parentale', 'suite-parentale', 'bed', 53),
  ('Studio possible', 'studio-possible', 'home', 60),
  ('Bail commercial', 'bail-commercial', 'file-text', 61),
  ('Vide de tout occupant', 'vide-occupant', 'check-circle', 62)
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Properties (biens en mandat — champs inspirés Botble + loi Hoguet)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eurealimmo_properties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Relations
  mandataire_id UUID NOT NULL REFERENCES public.eurealimmo_mandataires(id) ON DELETE RESTRICT,
  category_id UUID REFERENCES public.eurealimmo_categories(id) ON DELETE SET NULL,

  -- Identité bien
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  unique_id TEXT UNIQUE,           -- Référence Eurealimmo : EUR-AAAA-NNNNN
  description TEXT,
  short_description TEXT,

  -- Localisation
  address TEXT NOT NULL,
  city_name TEXT,
  postal_code TEXT,
  insee_commune TEXT,              -- FK vers DATAMERRY (zone HDBSCAN)
  lat NUMERIC(10, 7),
  lon NUMERIC(10, 7),

  -- Caractéristiques physiques
  surface_habitable_m2 NUMERIC(8, 2),
  surface_carrez_m2 NUMERIC(8, 2),
  surface_terrain_m2 NUMERIC(10, 2),
  nb_pieces INTEGER,
  nb_chambres INTEGER,
  nb_salles_bain INTEGER,
  etage INTEGER,                   -- 0 = RDC
  etage_max INTEGER,
  annee_construction INTEGER,

  -- DPE / GES
  dpe_classe TEXT CHECK (dpe_classe IN ('A','B','C','D','E','F','G') OR dpe_classe IS NULL),
  dpe_kwh NUMERIC(7, 2),
  ges_classe TEXT CHECK (ges_classe IN ('A','B','C','D','E','F','G') OR ges_classe IS NULL),
  ges_kgco2 NUMERIC(7, 2),
  dpe_realise_date DATE,

  -- Prix + transaction
  operation TEXT NOT NULL DEFAULT 'vente'
    CHECK (operation IN ('vente', 'location', 'viager', 'recherche')),
  prix_net_vendeur NUMERIC(12, 0),
  prix_presentation_public NUMERIC(12, 0),
  commission_pct NUMERIC(5, 2),
  prix_loyer_mensuel NUMERIC(10, 0),  -- si location
  charges_mensuelles NUMERIC(8, 0),
  taxe_fonciere NUMERIC(8, 0),

  -- Copropriété (loi Hoguet)
  is_copropriete BOOLEAN NOT NULL DEFAULT false,
  copropriete_nb_lots INTEGER,
  copropriete_quote_part_tantièmes INTEGER,
  copropriete_charges_annuelles NUMERIC(8, 0),
  copropriete_procedures_en_cours TEXT,  -- nature des procédures (art. 18-3 loi 65-557)

  -- Références cadastrales
  references_cadastrales TEXT,         -- ex: "Section AB n° 123"

  -- État éditorial
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'pending_review', 'sold', 'rented', 'archived')),
  moderation_status TEXT
    CHECK (moderation_status IN ('pending', 'approved', 'rejected') OR moderation_status IS NULL),
  is_featured BOOLEAN NOT NULL DEFAULT false,
  publication_expires_at DATE,         -- mandat échoit (équivalent expire_date Botble)
  mandat_date_signature DATE,
  mandat_duree_mois INTEGER,

  -- Compteurs
  views_count INTEGER NOT NULL DEFAULT 0,
  contacts_count INTEGER NOT NULL DEFAULT 0,

  -- SEO
  seo_title TEXT,
  seo_description TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_properties_mandataire
  ON public.eurealimmo_properties (mandataire_id, status);
CREATE INDEX IF NOT EXISTS idx_properties_published
  ON public.eurealimmo_properties (status, created_at DESC)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_properties_city
  ON public.eurealimmo_properties (city_name);
CREATE INDEX IF NOT EXISTS idx_properties_insee
  ON public.eurealimmo_properties (insee_commune);
CREATE INDEX IF NOT EXISTS idx_properties_operation_prix
  ON public.eurealimmo_properties (operation, prix_presentation_public);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Property images (galerie photos par bien)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eurealimmo_property_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.eurealimmo_properties(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,        -- chemin Supabase Storage
  signed_url TEXT,                   -- URL signée temporaire (régénérée à chaque GET)
  caption TEXT,
  is_cover BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  width INTEGER,
  height INTEGER,
  bytes INTEGER,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_images_property
  ON public.eurealimmo_property_images (property_id, sort_order);
CREATE UNIQUE INDEX IF NOT EXISTS idx_property_images_cover_unique
  ON public.eurealimmo_property_images (property_id)
  WHERE is_cover = true;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Property features (table de jonction N:N)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eurealimmo_property_features (
  property_id UUID NOT NULL REFERENCES public.eurealimmo_properties(id) ON DELETE CASCADE,
  feature_id UUID NOT NULL REFERENCES public.eurealimmo_features(id) ON DELETE CASCADE,
  PRIMARY KEY (property_id, feature_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Pages CMS (Markdown-based, pour pages statiques de eurealimmo.com)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.eurealimmo_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  content_md TEXT NOT NULL,         -- Markdown source
  excerpt TEXT,
  is_homepage BOOLEAN NOT NULL DEFAULT false,
  template TEXT NOT NULL DEFAULT 'default'
    CHECK (template IN ('default', 'homepage', 'about', 'contact', 'legal', 'pricing')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  seo_title TEXT,
  seo_description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_homepage_unique
  ON public.eurealimmo_pages (is_homepage)
  WHERE is_homepage = true;
CREATE INDEX IF NOT EXISTS idx_pages_status
  ON public.eurealimmo_pages (status, published_at DESC);

-- Seed pages essentielles (à éditer ensuite via admin)
INSERT INTO public.eurealimmo_pages (title, slug, content_md, template, is_homepage, status)
VALUES
  ('Accueil', 'home',
   '# EUREALIMMO — Réseau de mandataires immobiliers HNWI

Bienvenue sur Eurealimmo. Notre réseau accompagne les mandataires haut de gamme
spécialisés dans les biens d''exception (HNWI, hôtels particuliers, pieds-à-terre).

## Pourquoi nous rejoindre ?

- Carte T sous notre couverture (RCO) — pas de garantie financière à souscrire
- Outils DATAMERRY® inclus : estimation data-driven + registre blockchain
- 6 mois gratuits + 59€/mois + 5% commission seulement (Option D)
- Mandataires fondateurs : commission referral 18% sur HNWI apportés

[Postuler →](/postuler)', 'homepage', true, 'published'),
  ('À propos', 'a-propos',
   '# À propos

Eurealimmo est une SARL au capital social, immatriculée au RCS de Paris sous
le SIREN 984 449 470. Titulaire de la carte professionnelle T n° CPI 7501 2024
000 219 délivrée par la CCI Paris Île-de-France.

Notre métier : structurer un réseau de mandataires HNWI avec les meilleurs
outils data du marché (DATAMERRY®).', 'about', false, 'draft'),
  ('Postuler', 'postuler',
   '# Devenir mandataire Eurealimmo

Vous êtes mandataire confirmé, spécialisé HNWI, et cherchez à rejoindre un
réseau premium ? Contactez-nous.

contact@datamerry.com', 'contact', false, 'draft'),
  ('Mentions légales', 'mentions-legales',
   '# Mentions légales

**EUREALIMMO** — SARL au capital social
SIREN 984 449 470 — RCS Paris
Carte professionnelle T n° CPI 7501 2024 000 219 (CCI Paris Île-de-France)
Siège social : 60 Rue François 1er, 75008 Paris
Représentée par Samuel BRUNO, Président
Email : contact@datamerry.com', 'legal', false, 'published')
ON CONFLICT (slug) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. Triggers updated_at
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_eurealimmo_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $func$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$func$;

DROP TRIGGER IF EXISTS trg_touch_mandataires ON public.eurealimmo_mandataires;
CREATE TRIGGER trg_touch_mandataires BEFORE UPDATE ON public.eurealimmo_mandataires
  FOR EACH ROW EXECUTE FUNCTION public.touch_eurealimmo_updated_at();

DROP TRIGGER IF EXISTS trg_touch_categories ON public.eurealimmo_categories;
CREATE TRIGGER trg_touch_categories BEFORE UPDATE ON public.eurealimmo_categories
  FOR EACH ROW EXECUTE FUNCTION public.touch_eurealimmo_updated_at();

DROP TRIGGER IF EXISTS trg_touch_features ON public.eurealimmo_features;
CREATE TRIGGER trg_touch_features BEFORE UPDATE ON public.eurealimmo_features
  FOR EACH ROW EXECUTE FUNCTION public.touch_eurealimmo_updated_at();

DROP TRIGGER IF EXISTS trg_touch_properties ON public.eurealimmo_properties;
CREATE TRIGGER trg_touch_properties BEFORE UPDATE ON public.eurealimmo_properties
  FOR EACH ROW EXECUTE FUNCTION public.touch_eurealimmo_updated_at();

DROP TRIGGER IF EXISTS trg_touch_pages ON public.eurealimmo_pages;
CREATE TRIGGER trg_touch_pages BEFORE UPDATE ON public.eurealimmo_pages
  FOR EACH ROW EXECUTE FUNCTION public.touch_eurealimmo_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. RLS — Service role only (admin), public read pour publié
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.eurealimmo_mandataires ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eurealimmo_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eurealimmo_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eurealimmo_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eurealimmo_property_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eurealimmo_property_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eurealimmo_pages ENABLE ROW LEVEL SECURITY;

-- Service role : full access (admin API server-side)
DO $$
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'eurealimmo_mandataires', 'eurealimmo_categories', 'eurealimmo_features',
      'eurealimmo_properties', 'eurealimmo_property_images',
      'eurealimmo_property_features', 'eurealimmo_pages'
    ]) AS table_name
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "service_role_full_%I" ON public.%I',
      t.table_name, t.table_name
    );
    EXECUTE format(
      'CREATE POLICY "service_role_full_%I" ON public.%I FOR ALL USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')',
      t.table_name, t.table_name
    );
  END LOOP;
END $$;

-- Public anon : lecture seule des contenus publiés
DROP POLICY IF EXISTS "public_read_mandataires" ON public.eurealimmo_mandataires;
CREATE POLICY "public_read_mandataires" ON public.eurealimmo_mandataires
  FOR SELECT USING (is_public_profile = true AND is_active = true AND is_blocked = false);

DROP POLICY IF EXISTS "public_read_categories" ON public.eurealimmo_categories;
CREATE POLICY "public_read_categories" ON public.eurealimmo_categories
  FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "public_read_features" ON public.eurealimmo_features;
CREATE POLICY "public_read_features" ON public.eurealimmo_features
  FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "public_read_properties" ON public.eurealimmo_properties;
CREATE POLICY "public_read_properties" ON public.eurealimmo_properties
  FOR SELECT USING (status = 'published');

DROP POLICY IF EXISTS "public_read_property_images" ON public.eurealimmo_property_images;
CREATE POLICY "public_read_property_images" ON public.eurealimmo_property_images
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.eurealimmo_properties p
            WHERE p.id = property_id AND p.status = 'published')
  );

DROP POLICY IF EXISTS "public_read_property_features" ON public.eurealimmo_property_features;
CREATE POLICY "public_read_property_features" ON public.eurealimmo_property_features
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.eurealimmo_properties p
            WHERE p.id = property_id AND p.status = 'published')
  );

DROP POLICY IF EXISTS "public_read_pages" ON public.eurealimmo_pages;
CREATE POLICY "public_read_pages" ON public.eurealimmo_pages
  FOR SELECT USING (status = 'published');

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Vérification finale
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE 'eurealimmo_%') AS tables_created,
  (SELECT COUNT(*) FROM public.eurealimmo_categories) AS categories_seeded,
  (SELECT COUNT(*) FROM public.eurealimmo_features) AS features_seeded,
  (SELECT COUNT(*) FROM public.eurealimmo_pages) AS pages_seeded;
