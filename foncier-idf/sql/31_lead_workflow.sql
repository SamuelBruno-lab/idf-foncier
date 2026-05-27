-- DATAMERRY — Workflow leads cabinet + magic link admin
--
-- Phase 2 du module white-label : transformer chaque cabinet en CRM
-- minimaliste avec pipeline 5 étapes (Reçu → Contacté → RDV → Mandat
-- signé → Vendu/Perdu) + auth magic link pour Diara & cabinets futurs.
--
-- Objectif business : faire du registre des mandats DATAMERRY le
-- registre carte T officiel du cabinet. À terme on génère les
-- documents légaux à partir de cette table (mandat de vente, compromis).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enrichir le CHECK constraint sur dim_cabinet_leads.status
--    Statuts métier immo standards (alignés Apimo / Hubsell).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.dim_cabinet_leads
  DROP CONSTRAINT IF EXISTS dim_cabinet_leads_status_check;

ALTER TABLE public.dim_cabinet_leads
  ADD CONSTRAINT dim_cabinet_leads_status_check
  CHECK (status IN (
    'new',          -- Reçu (lead fraîchement capturé)
    'contacted',    -- Contacté (1er échange réalisé)
    'rdv_planifie', -- RDV planifié (visite ou call planifiée)
    'mandat_signe', -- Mandat signé (le bien rentre au registre carte T)
    'vendu',        -- Vendu (transaction conclue)
    'non_vendu',    -- Non vendu (mandat échu sans vente)
    'lost'          -- Perdu (jamais converti, pas intéressé)
  ));

COMMENT ON COLUMN public.dim_cabinet_leads.status IS
  '7 statuts pipeline cabinet : new → contacted → rdv_planifie → mandat_signe → vendu / non_vendu / lost. Source du registre des mandats (mandat_signe + vendu).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Historique des transitions de statuts (traçabilité légale)
--    Chaque change_status crée une ligne ici → audit trail complet.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dim_lead_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.dim_cabinet_leads(id) ON DELETE CASCADE,
  from_status TEXT,                  -- null si création (statut initial)
  to_status TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by_email TEXT,             -- email de l'utilisateur cabinet qui a fait l'action
  note TEXT                          -- annotation libre du cabinet
);

CREATE INDEX IF NOT EXISTS idx_lead_status_history_lead
  ON public.dim_lead_status_history (lead_id, changed_at DESC);

ALTER TABLE public.dim_lead_status_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_status_history" ON public.dim_lead_status_history;
CREATE POLICY "service_role_full_status_history"
  ON public.dim_lead_status_history FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Tokens magic link pour auth admin cabinet
--    Token aléatoire 32 bytes hex, expire 7 jours, single-use.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.dim_cabinet_admin_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,   -- sha256 du token (jamais en clair en DB)
  cabinet_slug TEXT NOT NULL REFERENCES public.dim_cabinets_white_label(slug) ON DELETE CASCADE,
  email TEXT NOT NULL,               -- email de la personne qui demande l'accès
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,               -- timestamp d'utilisation (single-use)
  ip_hash TEXT,                      -- traçabilité anti-abus
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_tokens_slug
  ON public.dim_cabinet_admin_tokens (cabinet_slug, expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_tokens_lookup
  ON public.dim_cabinet_admin_tokens (token_hash)
  WHERE used_at IS NULL;

ALTER TABLE public.dim_cabinet_admin_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_full_admin_tokens" ON public.dim_cabinet_admin_tokens;
CREATE POLICY "service_role_full_admin_tokens"
  ON public.dim_cabinet_admin_tokens FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

COMMENT ON TABLE public.dim_cabinet_admin_tokens IS
  'Tokens magic link pour l''accès au dashboard admin cabinet. Token jamais stocké en clair (sha256 hash). Expire 7 jours, single-use.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Vue v_cabinet_registre_mandats
--    Filtre les leads en statut "Mandat signé" ou "Vendu" — c'est le registre
--    des mandats officiel du cabinet (devoir de tenue par carte T).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.v_cabinet_registre_mandats AS
SELECT
  l.id,
  l.cabinet_slug,
  c.cabinet_name,
  l.visitor_name,
  l.visitor_email,
  l.visitor_phone,
  l.address,
  l.type_bien,
  l.surface,
  l.prix_total_median AS estimation_datamerry,
  l.status,
  -- Date de signature du mandat = première transition vers mandat_signe
  (SELECT changed_at
   FROM public.dim_lead_status_history h
   WHERE h.lead_id = l.id AND h.to_status = 'mandat_signe'
   ORDER BY changed_at ASC LIMIT 1) AS mandat_signe_at,
  -- Date de vente = transition vers vendu
  (SELECT changed_at
   FROM public.dim_lead_status_history h
   WHERE h.lead_id = l.id AND h.to_status = 'vendu'
   ORDER BY changed_at ASC LIMIT 1) AS vendu_at,
  l.created_at,
  l.updated_at
FROM public.dim_cabinet_leads l
JOIN public.dim_cabinets_white_label c ON c.slug = l.cabinet_slug
WHERE l.status IN ('mandat_signe', 'vendu')
ORDER BY l.created_at DESC;

COMMENT ON VIEW public.v_cabinet_registre_mandats IS
  'Registre des mandats par cabinet : leads passés en statut mandat_signe ou vendu, avec date de signature et date de vente. Source pour rapports activité carte T.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Fonction utilitaire : transition de statut avec log automatique
--    Évite que les API endpoints oublient de logger dans status_history.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.change_lead_status(
  p_lead_id UUID,
  p_new_status TEXT,
  p_changed_by_email TEXT DEFAULT NULL,
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE (
  lead_id UUID,
  old_status TEXT,
  new_status TEXT,
  changed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_status TEXT;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Récupère le statut actuel
  SELECT status INTO v_old_status
  FROM public.dim_cabinet_leads
  WHERE id = p_lead_id;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Lead % introuvable', p_lead_id;
  END IF;

  IF v_old_status = p_new_status THEN
    -- Pas de changement, on log quand même pour traçabilité de la note
    INSERT INTO public.dim_lead_status_history
      (lead_id, from_status, to_status, changed_at, changed_by_email, note)
    VALUES (p_lead_id, v_old_status, p_new_status, v_now, p_changed_by_email, p_note);

    RETURN QUERY SELECT p_lead_id, v_old_status, p_new_status, v_now;
    RETURN;
  END IF;

  -- Update + history en une transaction
  UPDATE public.dim_cabinet_leads
  SET status = p_new_status, updated_at = v_now
  WHERE id = p_lead_id;

  INSERT INTO public.dim_lead_status_history
    (lead_id, from_status, to_status, changed_at, changed_by_email, note)
  VALUES (p_lead_id, v_old_status, p_new_status, v_now, p_changed_by_email, p_note);

  RETURN QUERY SELECT p_lead_id, v_old_status, p_new_status, v_now;
END;
$$;

COMMENT ON FUNCTION public.change_lead_status IS
  'Change le statut d''un lead avec log automatique dans dim_lead_status_history. À utiliser depuis les endpoints admin du cabinet.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Trigger : à la création d'un lead, crée la 1ère ligne d'historique
--    Permet de connaître la date de réception initiale (status 'new').
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.log_initial_lead_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.dim_lead_status_history (lead_id, from_status, to_status, changed_at)
  VALUES (NEW.id, NULL, NEW.status, NEW.created_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_initial_lead_status ON public.dim_cabinet_leads;
CREATE TRIGGER trg_log_initial_lead_status
  AFTER INSERT ON public.dim_cabinet_leads
  FOR EACH ROW EXECUTE FUNCTION public.log_initial_lead_status();

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Vérification finale
-- ─────────────────────────────────────────────────────────────────────────────

SELECT
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_name='dim_lead_status_history') AS history_table_ok,
  (SELECT COUNT(*) FROM information_schema.tables
   WHERE table_schema='public' AND table_name='dim_cabinet_admin_tokens') AS admin_tokens_table_ok,
  (SELECT COUNT(*) FROM information_schema.views
   WHERE table_schema='public' AND table_name='v_cabinet_registre_mandats') AS registre_view_ok;
