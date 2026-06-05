-- ============================================================================
-- HELPER (non-migration) — Attribution des numéros de place fondateur (1..60)
-- ----------------------------------------------------------------------------
-- Prérequis : avoir d'abord appliqué sql/43_eurealimmo_founder_contracts.sql
--             (colonnes founder_number / contract_generated_at).
--
-- À exécuter dans Supabase → SQL Editor. Les UPDATE ne touchent QUE les lignes
-- dont founder_number IS NULL → ré-exécutable sans écraser l'existant.
--
-- Choisissez la SECTION B *ou* la SECTION C (pas les deux), puis SECTION D.
-- ============================================================================


-- ── SECTION A — Réserver la n° 1 à l'Associée Fondatrice (Diara) ────────────
-- (Adaptez l'email si besoin. La n° 1 a un contrat dédié, ne pas la générer
--  via le template générique.)
UPDATE public.eurealimmo_mandataires
SET    founder_number = 1
WHERE  lower(email) = lower('diara.camara@collabimo.com')
  AND  founder_number IS NULL;


-- ── SECTION B — Attribution EXPLICITE (recommandée) ─────────────────────────
-- Liste email → numéro. Dupliquez/complétez les lignes du VALUES.
UPDATE public.eurealimmo_mandataires AS m
SET    founder_number = v.num
FROM (VALUES
    ('fondateur2@example.com', 2),
    ('fondateur3@example.com', 3),
    ('fondateur4@example.com', 4)
    -- ('...@...', 5), ...
) AS v(email, num)
WHERE lower(m.email) = lower(v.email)
  AND m.founder_number IS NULL;


-- ── SECTION C — Attribution AUTOMATIQUE séquentielle (alternative) ──────────
-- Numérote 2,3,4… (à la suite du max actuel) les mandataires « fondateurs »
-- encore sans numéro, par ordre d'inscription. Cap à 60.
-- ⚠️ Adaptez le critère « fondateur » à votre modèle (ici : commission 5 %
--    OU spécialité HNWI). Commentez la SECTION B si vous utilisez celle-ci.
WITH base AS (
    SELECT COALESCE(MAX(founder_number), 1) AS maxnum
    FROM   public.eurealimmo_mandataires
),
a_numeroter AS (
    SELECT id,
           row_number() OVER (ORDER BY created_at) AS rn
    FROM   public.eurealimmo_mandataires
    WHERE  founder_number IS NULL
      AND  is_active = true
      AND  (commission_eurealimmo_pct = 5 OR specialty = 'hnwi')
)
UPDATE public.eurealimmo_mandataires AS m
SET    founder_number = base.maxnum + a.rn
FROM   a_numeroter a, base
WHERE  m.id = a.id
  AND  base.maxnum + a.rn <= 60;


-- ── SECTION D — Vérification ────────────────────────────────────────────────
SELECT founder_number,
       first_name, last_name, email,
       is_active,
       contract_generated_at
FROM   public.eurealimmo_mandataires
WHERE  founder_number IS NOT NULL
ORDER  BY founder_number;

-- Contrôle des doublons (doit renvoyer 0 ligne) :
SELECT founder_number, count(*)
FROM   public.eurealimmo_mandataires
WHERE  founder_number IS NOT NULL
GROUP  BY founder_number
HAVING count(*) > 1;
