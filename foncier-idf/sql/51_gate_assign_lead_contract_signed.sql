-- ============================================================
-- Migration 51 — Gate runtime sur attribution leads
-- ============================================================
-- Refuser l'attribution d'un lead à un mandataire dont le contrat
-- Eurealimmo n'est pas signé (contract_signed_at IS NULL) ou
-- bloqué (is_active = false).
--
-- Motif : conformité loi Hoguet — un mandataire ne peut exercer
-- qu'après inscription RSAC, laquelle nécessite l'attestation
-- Eurealimmo (carte T n° CPI 7501 2024 000 219). Sans signature
-- contrat, pas d'attestation → pas de RSAC → pas d'attribution.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.assign_lead_to_mandataire(
  p_lead_id UUID,
  p_mandataire_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_contract_signed_at TIMESTAMPTZ;
  v_is_active BOOLEAN;
  v_is_blocked BOOLEAN;
  v_first_name TEXT;
  v_last_name TEXT;
BEGIN
  -- Vérifie l'état du mandataire
  SELECT contract_signed_at, is_active, is_blocked, first_name, last_name
    INTO v_contract_signed_at, v_is_active, v_is_blocked, v_first_name, v_last_name
  FROM public.eurealimmo_mandataires
  WHERE id = p_mandataire_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mandataire_not_found: %', p_mandataire_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_contract_signed_at IS NULL THEN
    RAISE EXCEPTION
      'contract_not_signed: % % (%) — contrat mandataire non signé, attribution refusée (Hoguet/RSAC)',
      v_first_name, v_last_name, p_mandataire_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_is_blocked = true THEN
    RAISE EXCEPTION 'mandataire_blocked: % % (%)',
      v_first_name, v_last_name, p_mandataire_id
      USING ERRCODE = 'P0001';
  END IF;

  IF v_is_active = false THEN
    RAISE EXCEPTION 'mandataire_inactive: % % (%)',
      v_first_name, v_last_name, p_mandataire_id
      USING ERRCODE = 'P0001';
  END IF;

  -- OK, on attribue
  UPDATE public.dim_cabinet_leads
  SET mandataire_id = p_mandataire_id,
      updated_at = now()
  WHERE id = p_lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'lead_not_found: %', p_lead_id
      USING ERRCODE = 'P0002';
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.assign_lead_to_mandataire IS
  'Attribue un lead à un mandataire. Refuse si contrat non signé, mandataire bloqué ou inactif. Conformité Hoguet/RSAC.';

-- ============================================================
-- Vue : mandataires éligibles à recevoir des leads
-- ============================================================
-- À utiliser côté UI admin pour le dropdown d'attribution.
-- ============================================================
CREATE OR REPLACE VIEW public.v_mandataires_eligibles AS
SELECT
  id,
  first_name,
  last_name,
  email,
  specialty,
  city_name,
  state_name,
  commission_eurealimmo_pct,
  contract_signed_at,
  CASE
    WHEN commission_eurealimmo_pct = 5 THEN 'founder'
    WHEN commission_eurealimmo_pct = 8 THEN 'standard'
    WHEN commission_eurealimmo_pct IS NULL THEN 'pending'
    ELSE 'custom'
  END AS tier_derived
FROM public.eurealimmo_mandataires
WHERE contract_signed_at IS NOT NULL
  AND is_active = true
  AND is_blocked = false
ORDER BY contract_signed_at ASC;

COMMENT ON VIEW public.v_mandataires_eligibles IS
  'Mandataires Eurealimmo en règle (contrat signé + actif + non bloqué), éligibles à recevoir des leads.';

COMMIT;
