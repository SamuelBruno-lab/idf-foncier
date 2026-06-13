-- ============================================================
-- Migration 56 — Fix email du code referral DIARA fondateur
-- ============================================================
-- Le seed initial SQL 40 avait posé un email placeholder
-- (diara.camara@example.com). Ma migration 54 a updaté max_uses
-- mais pas l'email. Conséquence : le code DIARA founder n'apparaît
-- pas dans la page parrainage de Diara, qui ne voit que DIARA-STD.
--
-- Ce patch aligne owner_email sur le vrai email Collabimo.
-- ============================================================

BEGIN;

UPDATE public.eurealimmo_referral_codes
SET owner_email = 'diara.camara@collabimo.com',
    updated_at = now()
WHERE code = 'DIARA'
  AND owner_email = 'diara.camara@example.com';

-- Vérif rétroactive (à observer dans Studio)
SELECT code, owner_email, tier, max_uses, current_uses, is_active
FROM public.eurealimmo_referral_codes
WHERE owner_email ILIKE '%diara%' OR code LIKE 'DIARA%'
ORDER BY tier DESC;

COMMIT;
