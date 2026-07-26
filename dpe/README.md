# Observatoire DPE Datamerry — POC V1

Régression hédonique publique des **coefficients de la lettre DPE sur le prix
de vente** des maisons individuelles en France, actualisée à chaque millésime
de la BDNB (trimestriellement).

## Question de recherche

Combien la classe énergétique du DPE fait varier le prix de vente d'une
maison, en pourcentage, aujourd'hui vs il y a 12 mois ? Par région ?

## Méthodologie V1

### Source de données

- **BDNB (CSTB)** — millésime 2026-02.a  
  https://bdnb.io/download/
- Contient les 4 tables utilisées :
  - `batiment_groupe` (id, commune, géométrie)
  - `batiment_groupe_ffo_bat` (nb_logements, année de construction, matériaux)
  - `dpe_logement` (classe A→G, kWh/m², GES, date DPE)
  - `batiment_groupe_dvf_open_statistique` (stats DVF agrégées par bâtiment)

### Périmètre V1

Seulement les **maisons individuelles** (bâtiments avec `nb_logements = 1`).
Raison : la jointure DPE ↔ prix de vente est non ambiguë (1 bâtiment = 1
logement = 1 DPE = les mutations DVF de ce bâtiment).

Les **appartements** (immeubles avec plusieurs logements) sont exclus de la V1
car la BDNB attribue un DPE « représentatif » par bâtiment qui peut ne pas
correspondre à un appartement vendu précis. V2 les traitera par match
probabiliste.

### Modèle statistique

Régression OLS pour chaque département :

```
log(prix_m2_médian_maison) ~ C(classe_dpe, référence = "D")
                             + annee_construction / 100
                             + surface_habitable
                             + nb_niveau
```

Interprétation : le coefficient β pour une classe X (ex: G) s'interprète en
%-effet vs classe D via `(exp(β) - 1) × 100`.

Filtre qualité :
- Classe DPE ∈ {A, B, C, D, E, F, G}
- Prix/m² ∈ [500 €, 20 000 €] (anti-outliers)
- Année construction ∈ [1800, 2025]
- Département avec ≥ 200 obs (sinon skip pour cause de puissance statistique
  insuffisante)

### Limites connues V1

1. **Stats DVF agrégées** : la BDNB pré-calcule les statistiques prix par
   bâtiment sur 2014-2021 (`batiment_groupe_dvf_open_statistique.csv`).
   La régression capture l'effet moyen sur cette période, pas les évolutions
   fines temporelles. V2 utilisera geo-dvf direct (2020-2025 mutations
   individuelles).
2. **Effet fixe commune non inclus** en V1 (uniquement département). V2 :
   ajout d'effets fixes zone HDBSCAN pour capter les micro-marchés.
3. **Sélection biaisée** : seules les maisons ayant à la fois un DPE et une
   mutation dans la période sont analysées. Elles peuvent avoir des
   caractéristiques différentes de la population générale.

## Fichiers

| Fichier | Rôle |
|---------|------|
| `download_bdnb.py` | Télécharge la BDNB pour un département donné |
| `join_dvf_dpe_maison.py` | Jointure filtrée maisons individuelles |
| `regression_dpe.py` | OLS statsmodels + upload Supabase |
| `requirements.txt` | Dépendances Python |

## Lancement local (test)

```bash
cd dpe/
pip install -r requirements.txt

# Test sur département 94 (Val-de-Marne)
python download_bdnb.py --dept 94 --out ./bdnb_data
python join_dvf_dpe_maison.py --dept 94 --data ./bdnb_data --out ./joined
python regression_dpe.py --joined ./joined/joined_94.parquet --no-upload

# Puis pour la production, ajouter SUPABASE_URL + SERVICE_ROLE_KEY en env
# et retirer --no-upload pour écrire dans dim_dpe_coefficients
```

## Lancement CI

Le workflow `.github/workflows/observatoire-dpe.yml` déclenche la matrice
France entière chaque trimestre (1er du mois 3, 6, 9, 12) ou sur
`workflow_dispatch`.

## Sortie Supabase

Table `dim_dpe_coefficients` :

```sql
period_label       TEXT   -- ex: '2026-Q3'
run_at             TIMESTAMPTZ
region             TEXT   -- code département (75, 94, ...)
type_bien          TEXT   -- 'maison' en V1, 'appartement' en V2+
classe_dpe         TEXT   -- 'A' à 'G'
coefficient_log    DOUBLE -- β brut
pct_effect         DOUBLE -- (exp(β)-1)*100 : %-effet vs D
ic_lower_pct       DOUBLE -- IC 95 %
ic_upper_pct       DOUBLE -- IC 95 %
p_value            DOUBLE
n_obs_region       INT
n_obs_classe       INT
r2                 DOUBLE
methodology_version TEXT   -- 'v1_bdnb_maisons'
```

## Publication

Les résultats trimestriels alimenteront la page publique
`app.datamerry.com/observatoire-dpe` (à créer côté Next.js), et un rapport
PDF trimestriel co-publié DATAMERRY × Collabimo (task backlog #71).

## Roadmap

- **V1 (POC)** — maisons via BDNB agrégée, IDF puis France entière
- **V2** — maisons + DVF direct 2020-2025 (mutation par mutation)
- **V3** — appartements via match probabiliste surface + adresse + id_rnb
- **V4** — publication `/observatoire-dpe` avec dataviz + API REST
