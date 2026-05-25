-- ============================================================
-- datamerry — Phase 2.6b : ajout dispositif Jeanbrun (successeur Pinel)
-- À exécuter dans Supabase SQL Editor
-- ============================================================
-- Source : arrêté du 6 janvier 2026 (JO du 31 janvier 2026)
-- Caractéristiques :
--   - Successeur du Pinel (clos 31/12/2024), actif jusqu'en 2034
--   - 3 niveaux : intermédiaire (Loc1), social (Loc2), très social (Loc3)
--   - 5 zones : A bis, A, B1, B2, C (contrairement à Pinel = Abis/A/B1 seulement)
--   - Couvre toute la France métropolitaine + DOM
--   - Réduction d'IR : -30% à -45% sur 9 ans
--   - Formule loyer mensuel max = LMZONE × surface_utile × min(0.7 + 19/S ; 1.2)
--     (le min avec 1.2 plafonne le coefficient pour les petites surfaces)

INSERT INTO dim_plafond_loyer (dispositif, zone, annee, loyer_max_m2, source_juridique) VALUES
  -- Niveau intermédiaire (Loc1)
  ('jeanbrun_intermediaire', 'Abis', 2026, 19.71, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),
  ('jeanbrun_intermediaire', 'A',    2026, 14.64, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),
  ('jeanbrun_intermediaire', 'B1',   2026, 11.80, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),
  ('jeanbrun_intermediaire', 'B2',   2026, 10.26, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),
  ('jeanbrun_intermediaire', 'C',    2026, 10.26, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),

  -- Niveau social (Loc2) ≈ -15% intermédiaire
  ('jeanbrun_social', 'Abis', 2026, 16.75, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),
  ('jeanbrun_social', 'A',    2026, 12.44, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),
  ('jeanbrun_social', 'B1',   2026, 10.03, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),
  ('jeanbrun_social', 'B2',   2026,  8.72, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),
  ('jeanbrun_social', 'C',    2026,  8.72, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),

  -- Niveau très social (Loc3) ≈ -30% intermédiaire
  ('jeanbrun_tres_social', 'Abis', 2026, 13.80, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),
  ('jeanbrun_tres_social', 'A',    2026, 10.25, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),
  ('jeanbrun_tres_social', 'B1',   2026,  8.26, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),
  ('jeanbrun_tres_social', 'B2',   2026,  7.18, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)'),
  ('jeanbrun_tres_social', 'C',    2026,  7.18, 'Arrêté du 6 janvier 2026 (JO 31/01/2026)')
ON CONFLICT (dispositif, zone, annee) DO NOTHING;

COMMENT ON COLUMN dim_plafond_loyer.dispositif IS
  'Identifiant du dispositif fiscal. Valeurs supportées : lli, loc_avantages_{intermediaire,social,tres_social}, denormandie, jeanbrun_{intermediaire,social,tres_social}';
