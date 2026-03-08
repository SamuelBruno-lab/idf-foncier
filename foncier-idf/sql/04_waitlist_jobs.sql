-- =============================================
-- DATAMERRY — Tables waitlist + jobs
-- À exécuter dans Supabase SQL Editor
-- =============================================

-- Table waitlist : personnes qui veulent être notifiées
CREATE TABLE IF NOT EXISTS waitlist (
  id              BIGSERIAL PRIMARY KEY,
  email           TEXT NOT NULL,
  commune_code    TEXT NOT NULL,
  commune_nom     TEXT,
  type            TEXT NOT NULL DEFAULT 'notify', -- 'notify' | 'paid_request'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at     TIMESTAMPTZ,                    -- date d'envoi de la notif
  UNIQUE (email, commune_code)
);

-- Index pour compter rapidement les inscrits par commune
CREATE INDEX IF NOT EXISTS idx_waitlist_commune ON waitlist (commune_code);

-- RLS : lecture publique du count (pas des emails)
ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "count_public" ON waitlist FOR SELECT USING (true);
CREATE POLICY "insert_public" ON waitlist FOR INSERT WITH CHECK (true);

-- Table jobs : demandes d'analyse
CREATE TABLE IF NOT EXISTS jobs (
  id              BIGSERIAL PRIMARY KEY,
  commune_code    TEXT NOT NULL,
  commune_nom     TEXT,
  user_email      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending_payment',
  -- pending_payment → paid → generating → done → public
  amount_eur      NUMERIC(6,2) DEFAULT 19.99,
  stripe_session_id TEXT,
  map_url         TEXT,                           -- URL de la carte générée
  public_at       TIMESTAMPTZ,                    -- date de mise en gratuit (J+3)
  paid_at         TIMESTAMPTZ,
  generated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_commune ON jobs (commune_code);
CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs (status);

-- RLS : seulement le service role peut lire/écrire
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_only" ON jobs USING (false); -- bloque l'anon key
-- Le service role bypass le RLS automatiquement

-- =============================================
-- CRON : passer les jobs 'done' en 'public' après 72h
-- Activer l'extension pg_cron dans Supabase > Extensions
-- =============================================
-- SELECT cron.schedule(
--   'publish-maps',
--   '0 * * * *',  -- toutes les heures
--   $$
--     UPDATE jobs
--     SET status = 'public'
--     WHERE status = 'done'
--       AND generated_at IS NOT NULL
--       AND generated_at + INTERVAL '72 hours' <= NOW();
--   $$
-- );
