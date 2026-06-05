-- ============================================================================
-- 43_eurealimmo_founder_contracts.sql
--
-- Génération automatique des contrats de mandat « Associé(e) Fondateur(trice) ».
--
-- Ajoute à public.eurealimmo_mandataires :
--   - founder_number       : numéro de place fondateur (1..60). La n° 1 est
--                            l'Associée Fondatrice n° 1 (Diara), au contrat
--                            dédié (Art. 8 prime de cession + Art. 8 bis
--                            préemption). Les n° 2..60 utilisent le template
--                            générique (ces articles retirés).
--   - contract_generated_at: horodatage de la dernière génération du .docx.
--
-- Voir aussi :
--   src/lib/contracts/generate-mandat.ts
--   public/legal/templates/contrat-mandat-fondateur.template.docx
-- ============================================================================

ALTER TABLE public.eurealimmo_mandataires
  ADD COLUMN IF NOT EXISTS founder_number SMALLINT,
  ADD COLUMN IF NOT EXISTS contract_generated_at TIMESTAMPTZ;

-- Numéro unique, borné au cap réseau de 60 places fondateur.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mandataires_founder_number_range_ck'
  ) THEN
    ALTER TABLE public.eurealimmo_mandataires
      ADD CONSTRAINT mandataires_founder_number_range_ck
      CHECK (founder_number IS NULL OR founder_number BETWEEN 1 AND 60);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_mandataires_founder_number
  ON public.eurealimmo_mandataires (founder_number)
  WHERE founder_number IS NOT NULL;

COMMENT ON COLUMN public.eurealimmo_mandataires.founder_number IS
  'Place fondateur 1..60. n° 1 = Associée Fondatrice (contrat dédié Art. 8/8 bis) ; 2..60 = template générique.';
COMMENT ON COLUMN public.eurealimmo_mandataires.contract_generated_at IS
  'Dernière génération du contrat de mandat .docx (src/lib/contracts/generate-mandat.ts).';

-- ----------------------------------------------------------------------------
-- Storage : créer le bucket PRIVÉ des contrats générés (non signés).
-- À exécuter une fois (idempotent). Les .docx signés finaux restent gérés via
-- le prestataire e-signature / le bucket mandate-signed-pdfs existant.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('mandats-fondateurs', 'mandats-fondateurs', false)
ON CONFLICT (id) DO NOTHING;
