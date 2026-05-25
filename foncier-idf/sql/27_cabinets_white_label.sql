-- DATAMERRY — Cabinets en white-label (pages hébergées chez DATAMERRY au branding du cabinet)
--
-- Permet à un cabinet immobilier d'utiliser DATAMERRY SANS INTÉGRER de code sur son
-- site. Le cabinet ajoute juste un LIEN vers datamerry.com/cabinets/{slug}/estimer
-- qui affiche une page entièrement brandée à ses couleurs.
--
-- Cas d'usage Collabimmo (pilote 2026-05-25) :
--   1. Diara ajoute un bouton "Estimer mon bien" sur collabimmo.fr (5 min, n'importe quel CMS)
--   2. Le bouton pointe vers https://datamerry.com/cabinets/collabimmo/estimer
--   3. Le visiteur voit une page Collabimmo (logo, orange, contact) — propulsé par DATAMERRY

CREATE TABLE IF NOT EXISTS public.dim_cabinets_white_label (
  slug TEXT PRIMARY KEY,                         -- ex: 'collabimmo' (URL-safe, lowercase)
  cabinet_name TEXT NOT NULL,                    -- "Collabimmo"

  -- Branding
  primary_color TEXT NOT NULL DEFAULT '#1f3a8a', -- couleur dominante (hex)
  secondary_color TEXT,                          -- couleur d'accent (hex, optionnel)
  logo_url TEXT,                                 -- URL https publique du logo
  font_family TEXT,                              -- override police (ex: "Inter, sans-serif")

  -- Contact / CTA
  cta_contact_url TEXT NOT NULL,                 -- URL formulaire de contact du cabinet
  cta_contact_label TEXT NOT NULL DEFAULT 'Demander un rendez-vous gratuit',
  contact_email TEXT,                            -- email visible du cabinet
  contact_phone TEXT,                            -- téléphone visible (optionnel)

  -- Mentions légales / footer
  legal_mention TEXT,                            -- ex: "Cabinet titulaire carte T n° CPI..."

  -- Lien clé widget (pour suivi usage + comptage Stripe)
  api_key_id UUID REFERENCES public.dim_api_keys(id) ON DELETE SET NULL,

  -- Activation
  active BOOLEAN NOT NULL DEFAULT true,

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Notes internes (jamais affichées)
  notes TEXT
);

COMMENT ON TABLE public.dim_cabinets_white_label IS
  'Cabinets utilisant les pages white-label DATAMERRY (datamerry.com/cabinets/{slug}/...).';
COMMENT ON COLUMN public.dim_cabinets_white_label.slug IS
  'Identifiant URL-safe lowercase, ex "collabimmo". Utilisé dans /cabinets/{slug}/...';
COMMENT ON COLUMN public.dim_cabinets_white_label.api_key_id IS
  'Référence à la clé widget pour comptabilisation de l''usage côté Stripe.';

CREATE INDEX IF NOT EXISTS idx_cabinets_active
  ON public.dim_cabinets_white_label (active) WHERE active = true;

-- RLS : public.read autorisé (la page est servie en SSR, anon peut lire le branding)
ALTER TABLE public.dim_cabinets_white_label ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_cabinets_active" ON public.dim_cabinets_white_label;
CREATE POLICY "anon_read_cabinets_active"
  ON public.dim_cabinets_white_label FOR SELECT
  USING (active = true);

DROP POLICY IF EXISTS "service_role_full_cabinets" ON public.dim_cabinets_white_label;
CREATE POLICY "service_role_full_cabinets"
  ON public.dim_cabinets_white_label FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at automatique
CREATE OR REPLACE FUNCTION public.touch_cabinets_white_label_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cabinets_white_label_updated ON public.dim_cabinets_white_label;
CREATE TRIGGER trg_cabinets_white_label_updated
  BEFORE UPDATE ON public.dim_cabinets_white_label
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_cabinets_white_label_updated();
