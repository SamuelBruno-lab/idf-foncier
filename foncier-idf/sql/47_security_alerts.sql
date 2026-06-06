-- ============================================================
-- Migration 47 — Détection automatique des violations de données
-- ============================================================
-- RGPD article 33 : notification à la CNIL < 72h en cas de violation.
-- RGPD article 34 : notification aux personnes concernées si risque
--                   élevé.
--
-- Approche : table security_alerts qui agrège les anomalies détectées
-- par un cron quotidien. Notification email automatique à Samuel via
-- Resend.
-- ============================================================

BEGIN;

-- ============================================================
-- Table : security_alerts
-- ============================================================
CREATE TABLE IF NOT EXISTS public.security_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_slug    TEXT,                     -- NULL si alerte globale

  severity        TEXT NOT NULL
                   CHECK (severity IN (
                     'INFO',     -- juste informatif
                     'WARNING',  -- à surveiller
                     'CRITICAL', -- intervention immédiate
                     'BREACH'    -- violation RGPD avérée — déclencher notif 72h
                   )),

  category        TEXT NOT NULL
                   CHECK (category IN (
                     'mass_export',          -- export anormalement gros
                     'rapid_consultations',  -- nombreux READ dans peu de temps
                     'unauthorized_access',  -- échec auth répété
                     'suspicious_ip',        -- IP inhabituelle
                     'cleanup_overdue',      -- logs > 5 ans non purgés
                     'k_anonymity_violation',-- stats publiées avec k < 5
                     'other'
                   )),

  title           TEXT NOT NULL,
  description     TEXT,
  evidence        JSONB DEFAULT '{}',

  -- Workflow
  status          TEXT NOT NULL
                   CHECK (status IN (
                     'open',
                     'investigating',
                     'resolved',
                     'false_positive',
                     'notified_cnil'
                   )) DEFAULT 'open',

  -- Notifications
  notified_admin_at TIMESTAMPTZ,
  notified_cnil_at  TIMESTAMPTZ,
  notified_concerned_persons_at TIMESTAMPTZ,

  -- Suivi
  resolved_at     TIMESTAMPTZ,
  resolved_by     TEXT,
  resolution_notes TEXT,

  detected_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_alerts_status_severity_idx
  ON public.security_alerts (status, severity, detected_at DESC);

CREATE INDEX IF NOT EXISTS security_alerts_cabinet_idx
  ON public.security_alerts (cabinet_slug, detected_at DESC);

COMMENT ON TABLE public.security_alerts IS
  'Alertes de sécurité RGPD. Notifiées automatiquement par cron quotidien.';


-- ============================================================
-- Function : detect_security_anomalies
-- Lance toutes les détections + insère les alertes nouvelles
-- ============================================================
CREATE OR REPLACE FUNCTION public.detect_security_anomalies()
RETURNS TABLE (
  alerts_created INT
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INT := 0;
  v_tmp INT := 0;
  v_threshold_export INT := 500;
  v_threshold_rapid INT := 100;
  v_threshold_minutes INT := 5;
BEGIN
  -- Détection 1 : exports massifs (> 500 leads en 1 fois)
  INSERT INTO public.security_alerts (
    cabinet_slug, severity, category, title, description, evidence
  )
  SELECT
    cabinet_slug,
    CASE WHEN (metadata->>'lead_count')::int > 5000 THEN 'CRITICAL' ELSE 'WARNING' END,
    'mass_export',
    'Export massif de leads détecté',
    'Export de ' || (metadata->>'lead_count') || ' leads par ' ||
      COALESCE(actor_email, 'inconnu') || ' depuis ' || COALESCE(host(ip), 'IP inconnue'),
    jsonb_build_object(
      'log_id', id,
      'lead_count', metadata->>'lead_count',
      'actor', actor_email,
      'ip', host(ip),
      'format', metadata->>'format'
    )
  FROM public.audit_pii_access
  WHERE action = 'EXPORT'
    AND (metadata->>'lead_count')::int > v_threshold_export
    AND created_at >= now() - INTERVAL '24 hours'
    -- Évite doublons : ne crée que si pas déjà alerté pour ce log
    AND NOT EXISTS (
      SELECT 1 FROM public.security_alerts s
      WHERE (s.evidence->>'log_id')::uuid = public.audit_pii_access.id
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Détection 2 : consultations rapides (> 100 READ en 5 min par un actor)
  INSERT INTO public.security_alerts (
    cabinet_slug, severity, category, title, description, evidence
  )
  SELECT
    cabinet_slug,
    'WARNING',
    'rapid_consultations',
    'Consultations rapides anormales',
    'Plus de ' || count(*)::text || ' consultations par ' ||
      COALESCE(actor_email, 'inconnu') || ' en ' || v_threshold_minutes || ' minutes',
    jsonb_build_object(
      'consultation_count', count(*),
      'actor', actor_email,
      'window_minutes', v_threshold_minutes
    )
  FROM public.audit_pii_access
  WHERE action = 'READ'
    AND created_at >= now() - (v_threshold_minutes || ' minutes')::interval
  GROUP BY cabinet_slug, actor_email
  HAVING count(*) > v_threshold_rapid
    AND NOT EXISTS (
      SELECT 1 FROM public.security_alerts s
      WHERE s.category = 'rapid_consultations'
        AND s.evidence->>'actor' = public.audit_pii_access.actor_email
        AND s.detected_at >= now() - INTERVAL '1 hour'
    );

  GET DIAGNOSTICS v_tmp = ROW_COUNT;
  v_count := v_count + v_tmp;

  -- Détection 3 : logs > 5 ans (rétention RGPD)
  IF EXISTS (
    SELECT 1 FROM public.audit_pii_access
    WHERE created_at < now() - INTERVAL '5 years'
    LIMIT 1
  ) AND NOT EXISTS (
    SELECT 1 FROM public.security_alerts
    WHERE category = 'cleanup_overdue'
      AND status = 'open'
      AND detected_at >= now() - INTERVAL '7 days'
  ) THEN
    INSERT INTO public.security_alerts (
      severity, category, title, description, evidence
    ) VALUES (
      'INFO',
      'cleanup_overdue',
      'Logs RGPD à purger (rétention > 5 ans)',
      'Des logs d''accès dépassent la durée de conservation légale (RGPD art. 5-1-e). Lancer cleanup_old_audit_logs().',
      '{"action": "SELECT public.cleanup_old_audit_logs();"}'::jsonb
    );
    v_count := v_count + 1;
  END IF;

  RETURN QUERY SELECT v_count;
END;
$$;

COMMENT ON FUNCTION public.detect_security_anomalies IS
  'Lance toutes les détections d''anomalies et insère les alertes nouvelles. À appeler depuis le cron quotidien.';


-- ============================================================
-- Function : get_open_alerts_to_notify
-- Renvoie les alertes 'open' jamais notifiées (pour le cron email)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_open_alerts_to_notify()
RETURNS TABLE (
  id UUID,
  cabinet_slug TEXT,
  severity TEXT,
  category TEXT,
  title TEXT,
  description TEXT,
  evidence JSONB,
  detected_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
AS $$
  SELECT id, cabinet_slug, severity, category, title, description,
         evidence, detected_at
  FROM public.security_alerts
  WHERE status = 'open'
    AND notified_admin_at IS NULL
  ORDER BY
    CASE severity
      WHEN 'BREACH'   THEN 1
      WHEN 'CRITICAL' THEN 2
      WHEN 'WARNING'  THEN 3
      WHEN 'INFO'     THEN 4
    END,
    detected_at;
$$;

COMMENT ON FUNCTION public.get_open_alerts_to_notify IS
  'Retourne les alertes non notifiées, triées par sévérité.';


-- ============================================================
-- Function : mark_alert_notified
-- Marque une alerte comme notifiée à l'admin
-- ============================================================
CREATE OR REPLACE FUNCTION public.mark_alert_notified(
  p_alert_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
  UPDATE public.security_alerts
  SET notified_admin_at = now()
  WHERE id = p_alert_id
    AND notified_admin_at IS NULL
  RETURNING true;
$$;

COMMIT;
