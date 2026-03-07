-- ============================================================
-- Migration : qualification des leads
-- À exécuter dans Supabase SQL Editor
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS intent       TEXT,        -- acheteur | vendeur | investisseur | agent
  ADD COLUMN IF NOT EXISTS commune_code TEXT,        -- ex: "92078"
  ADD COLUMN IF NOT EXISTS commune_nom  TEXT,        -- ex: "Villeneuve-la-Garenne"
  ADD COLUMN IF NOT EXISTS budget       TEXT,        -- ex: "250 000 – 400 000 €"
  ADD COLUMN IF NOT EXISTS timeline     TEXT;        -- ex: "3 à 6 mois"

COMMENT ON COLUMN leads.intent       IS 'Intention déclarée: acheteur, vendeur, investisseur, agent';
COMMENT ON COLUMN leads.commune_code IS 'Code INSEE de la commune consultée';
COMMENT ON COLUMN leads.commune_nom  IS 'Nom de la commune consultée';
COMMENT ON COLUMN leads.budget       IS 'Tranche de budget déclarée';
COMMENT ON COLUMN leads.timeline     IS 'Horizon temporel déclaré';
