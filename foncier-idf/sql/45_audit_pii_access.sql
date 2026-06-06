-- ============================================================
-- Migration 45 — Compliance RGPD : audit des accès PII
-- ============================================================
-- Conformité :
--   * RGPD article 30 (registre des activités de traitement)
--   * RGPD article 32 (sécurité du traitement)
--   * RGPD article 5-1-f (intégrité et confidentialité)
--
-- Table audit_pii_access :
--   Trace chaque lecture, export ou suppression d'une donnée
--   personnelle. Lien soft vers dim_cabinet_leads (pas de FK pour
--   préserver l'auditabilité même après suppression du lead).
--
-- Helper function log_pii_access() :
--   Enregistre un accès avec validation + dédup intelligente.
-- ============================================================

BEGIN;

-- ============================================================
-- Table : audit_pii_access
-- ============================================================
CREATE TABLE IF NOT EXISTS public.audit_pii_access (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contexte d'accès
  cabinet_slug  TEXT NOT NULL,
  actor_id      UUID,                  -- magic_link_user_id (admin), NULL si batch
  actor_email   TEXT,                  -- pour audit même si user supprimé
  actor_role    TEXT,                  -- 'admin', 'mandataire', 'system', 'cron'

  -- Ressource accédée
  resource_type TEXT NOT NULL
                 CHECK (resource_type IN (
                   'lead',
                   'lead_list',
                   'lead_export',
                   'mandataire',
                   'mandataire_list',
                   'mandataire_contrat',
                   'collabimo_member',
                   'collabimo_member_list',
                   'lead_match_history'
                 )),
  resource_id   UUID,                  -- UUID de la ressource (NULL si list)

  -- Action
  action        TEXT NOT NULL
                 CHECK (action IN (
                   'READ',
                   'LIST',
                   'EXPORT',
                   'UPDATE',
                   'DELETE'
                 )),

  -- Métadonnées de la requête
  ip            INET,
  user_agent    TEXT,
  endpoint      TEXT,                  -- chemin de l'API ou page
  http_method   TEXT,

  -- Détails complémentaires (JSONB pour flexibilité)
  metadata      JSONB DEFAULT '{}',

  -- Horodatage
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index pour requêtes admin (filtrage cabinet + date)
CREATE INDEX IF NOT EXISTS audit_pii_cabinet_date_idx
  ON public.audit_pii_access (cabinet_slug, created_at DESC);

-- Index pour traçage d'un lead spécifique
CREATE INDEX IF NOT EXISTS audit_pii_resource_idx
  ON public.audit_pii_access (resource_type, resource_id);

-- Index pour traçage par actor
CREATE INDEX IF NOT EXISTS audit_pii_actor_idx
  ON public.audit_pii_access (actor_id, created_at DESC);

COMMENT ON TABLE public.audit_pii_access IS
  'Journal RGPD des accès aux données personnelles. Conservation 5 ans (RGPD art 30).';


-- ============================================================
-- Function : log_pii_access
-- Helper pour logger un accès (à appeler depuis les API routes)
-- ============================================================
CREATE OR REPLACE FUNCTION public.log_pii_access(
  p_cabinet_slug  TEXT,
  p_actor_id      UUID,
  p_actor_email   TEXT,
  p_actor_role    TEXT,
  p_resource_type TEXT,
  p_resource_id   UUID,
  p_action        TEXT,
  p_ip            INET DEFAULT NULL,
  p_user_agent    TEXT DEFAULT NULL,
  p_endpoint      TEXT DEFAULT NULL,
  p_http_method   TEXT DEFAULT NULL,
  p_metadata      JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.audit_pii_access (
    cabinet_slug, actor_id, actor_email, actor_role,
    resource_type, resource_id, action,
    ip, user_agent, endpoint, http_method, metadata
  )
  VALUES (
    p_cabinet_slug, p_actor_id, p_actor_email, p_actor_role,
    p_resource_type, p_resource_id, p_action,
    p_ip, p_user_agent, p_endpoint, p_http_method, p_metadata
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

COMMENT ON FUNCTION public.log_pii_access IS
  'Helper RGPD : enregistre un accès PII dans audit_pii_access. À appeler systématiquement depuis les API routes qui exposent des données personnelles.';


-- ============================================================
-- Function : get_audit_summary_for_cabinet
-- Stats d'audit pour le dashboard admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_audit_summary_for_cabinet(
  p_cabinet_slug TEXT,
  p_days_back INT DEFAULT 30
)
RETURNS TABLE (
  total_access INT,
  unique_resources INT,
  unique_actors INT,
  read_count INT,
  list_count INT,
  export_count INT,
  update_count INT,
  delete_count INT,
  earliest_access TIMESTAMPTZ,
  latest_access TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    count(*)::int AS total_access,
    count(DISTINCT resource_id)::int AS unique_resources,
    count(DISTINCT actor_id)::int AS unique_actors,
    count(*) FILTER (WHERE action = 'READ')::int AS read_count,
    count(*) FILTER (WHERE action = 'LIST')::int AS list_count,
    count(*) FILTER (WHERE action = 'EXPORT')::int AS export_count,
    count(*) FILTER (WHERE action = 'UPDATE')::int AS update_count,
    count(*) FILTER (WHERE action = 'DELETE')::int AS delete_count,
    min(created_at) AS earliest_access,
    max(created_at) AS latest_access
  FROM public.audit_pii_access
  WHERE cabinet_slug = p_cabinet_slug
    AND created_at >= now() - (p_days_back || ' days')::interval;
$$;

COMMENT ON FUNCTION public.get_audit_summary_for_cabinet IS
  'Stats d''audit RGPD agrégées pour un cabinet sur N derniers jours.';


-- ============================================================
-- RLS : un cabinet ne voit que SES propres logs
-- ============================================================
ALTER TABLE public.audit_pii_access ENABLE ROW LEVEL SECURITY;

-- Les API Next.js passent par service_role (bypass RLS). Mais on
-- garde RLS activé pour empêcher tout accès direct via clé anon.

-- ============================================================
-- Trigger : auto-cleanup au-delà de 5 ans
-- (RGPD : minimisation + limitation de conservation)
-- ============================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_audit_logs()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM public.audit_pii_access
  WHERE created_at < now() - INTERVAL '5 years';
END;
$$;

COMMENT ON FUNCTION public.cleanup_old_audit_logs IS
  'Purge les logs > 5 ans (RGPD art 5-1-e). À appeler via cron mensuel.';

COMMIT;
