-- ============================================================
-- Migration 63 — Choix charge des honoraires (vendeur vs acquéreur)
-- ============================================================
-- Permet au mandataire de choisir, lors de la génération du mandat
-- Hoguet, si les honoraires sont à la charge du Vendeur (modèle OLEAN
-- "honoraires à la charge du Vendeur, prix de vente TTC = X €") ou
-- à la charge de l'Acquéreur (modèle FAI "prix net vendeur X € + honos").
-- ============================================================

BEGIN;

ALTER TABLE public.dim_cabinet_leads
  ADD COLUMN IF NOT EXISTS mandat_commission_charge TEXT;

ALTER TABLE public.dim_cabinet_leads
  DROP CONSTRAINT IF EXISTS dim_cabinet_leads_mandat_commission_charge_check;

ALTER TABLE public.dim_cabinet_leads
  ADD CONSTRAINT dim_cabinet_leads_mandat_commission_charge_check
  CHECK (
    mandat_commission_charge IS NULL
    OR mandat_commission_charge IN ('vendeur', 'acquereur')
  );

COMMENT ON COLUMN public.dim_cabinet_leads.mandat_commission_charge IS
  'Qui supporte juridiquement les honoraires du mandataire : ''vendeur'' (style OLEAN, prix de vente TTC inclus honos, vendeur reçoit prix - honos) ou ''acquereur'' (modèle FAI, prix net vendeur fixé, acquéreur paie net + honos).';

COMMIT;
