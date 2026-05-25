-- DATAMERRY — Leads capturés depuis les pages white-label cabinet
--
-- Chaque fois qu'un visiteur d'un cabinet white-label (ex: collabimo) finit
-- le chatbot et soumet le mini-form (nom + email + téléphone), on enregistre
-- ici tout le contexte (réponses du wizard, estimation calculée, identité
-- visiteur). Un email avec rapport PDF est envoyé au cabinet ET au visiteur.
--
-- Différent de la table `leads` historique (qui est pour la carte IDF
-- publique datamerry.com), ici on tracke le périmètre cabinet pour Stripe
-- billing futur (39€/mo + comptage par lead capturé).

CREATE TABLE IF NOT EXISTS public.dim_cabinet_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cabinet d'origine
  cabinet_slug TEXT NOT NULL REFERENCES public.dim_cabinets_white_label(slug)
    ON DELETE CASCADE,

  -- Identité visiteur (collectée à la dernière étape du chatbot)
  visitor_name TEXT NOT NULL,
  visitor_email TEXT NOT NULL,
  visitor_phone TEXT,
  consentement BOOLEAN NOT NULL DEFAULT false,

  -- Contexte estimation (issu du wizard)
  intent TEXT,                              -- vendeur / acheteur / curieux
  type_bien TEXT,                           -- Appartement / Maison / Commerce / ...
  address TEXT NOT NULL,
  surface NUMERIC,
  wizard_answers JSONB NOT NULL DEFAULT '{}'::jsonb, -- toutes les réponses (DPE, état, etc.)

  -- Résultat de l'estimation au moment du lead
  prix_m2_median NUMERIC,
  prix_m2_p10 NUMERIC,
  prix_m2_p90 NUMERIC,
  prix_total_median INTEGER,
  nb_ventes INTEGER,

  -- Suivi opérationnel
  email_to_cabinet_sent BOOLEAN NOT NULL DEFAULT false,
  email_to_visitor_sent BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'new',       -- new / contacted / converted / lost
  cabinet_notes TEXT,                       -- annotations futures du cabinet

  -- Audit
  ip_hash TEXT,                             -- pour anti-spam / RGPD
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.dim_cabinet_leads IS
  'Leads captures sur pages white-label /cabinets/{slug}/estimer. 1 ligne = 1 estimation finalisée avec identité visiteur.';
COMMENT ON COLUMN public.dim_cabinet_leads.cabinet_slug IS
  'Cabinet propriétaire du lead. FK vers dim_cabinets_white_label.';
COMMENT ON COLUMN public.dim_cabinet_leads.wizard_answers IS
  'Snapshot brut des réponses du chatbot (intent, type, étage, DPE, état, extérieurs, usage…) pour reproductibilité.';
COMMENT ON COLUMN public.dim_cabinet_leads.status IS
  'Statut commercial : new / contacted / converted / lost. Source de comptage Stripe (lead capturé = unité facturable).';

CREATE INDEX IF NOT EXISTS idx_cabinet_leads_slug
  ON public.dim_cabinet_leads (cabinet_slug, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cabinet_leads_email
  ON public.dim_cabinet_leads (visitor_email);
CREATE INDEX IF NOT EXISTS idx_cabinet_leads_status
  ON public.dim_cabinet_leads (cabinet_slug, status) WHERE status != 'lost';

-- RLS : service_role uniquement (lead = donnée commerciale sensible)
ALTER TABLE public.dim_cabinet_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_leads" ON public.dim_cabinet_leads;
CREATE POLICY "service_role_full_leads"
  ON public.dim_cabinet_leads FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.touch_cabinet_leads_updated()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cabinet_leads_updated ON public.dim_cabinet_leads;
CREATE TRIGGER trg_cabinet_leads_updated
  BEFORE UPDATE ON public.dim_cabinet_leads
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_cabinet_leads_updated();

-- Vue agrégée par cabinet : usage du mois courant (pour facturation Stripe)
CREATE OR REPLACE VIEW public.v_cabinet_leads_current_month AS
SELECT
  cabinet_slug,
  COUNT(*) AS nb_leads_total,
  COUNT(*) FILTER (WHERE status = 'new') AS nb_leads_new,
  COUNT(*) FILTER (WHERE status = 'contacted') AS nb_leads_contacted,
  COUNT(*) FILTER (WHERE status = 'converted') AS nb_leads_converted,
  MIN(created_at) AS first_lead_at,
  MAX(created_at) AS last_lead_at
FROM public.dim_cabinet_leads
WHERE created_at >= date_trunc('month', now())
GROUP BY cabinet_slug;

COMMENT ON VIEW public.v_cabinet_leads_current_month IS
  'Compteur de leads par cabinet pour le mois en cours — base de facturation Stripe.';
