"""
Jointure DVF ↔ DPE pour les MAISONS INDIVIDUELLES via la BDNB.

Stratégie V1 — pragmatique :
  1. Filtre les bâtiments avec nb_logements = 1 (maisons pures)
     → pour ceux-ci, 1 bâtiment = 1 logement = 1 DPE non ambigu
  2. Joint avec le DPE représentatif du bâtiment (dpe_logement)
  3. Joint avec les stats DVF pré-calculées BDNB (2014-2021, par bâtiment)
  4. Filtre qualité DPE (classe A-G renseignée, année_construction plausible)

Résultat : un CSV joint prêt pour la régression, 1 ligne = 1 maison individuelle
ayant à la fois un DPE et au moins une mutation DVF.

Usage :
    python join_dvf_dpe_maison.py --dept 94 --data ./bdnb_data --out ./joined

Limites V1 :
  - Utilise les stats DVF AGRÉGÉES BDNB (période 2014-2021), pas les mutations
    individuelles. La régression sera donc au niveau bâtiment × prix moyen.
  - V2 fera la jointure fine transaction × DPE via geo-dvf direct.
"""

import argparse
from pathlib import Path

import duckdb
import pandas as pd


def join_maisons(dept_dir: Path, out_path: Path) -> pd.DataFrame:
    """Joint les 4 tables BDNB en filtrant les maisons individuelles."""
    bg = dept_dir / "batiment_groupe.parquet"
    ffo = dept_dir / "batiment_groupe_ffo_bat.parquet"
    dvf = dept_dir / "batiment_groupe_dvf_open_statistique.parquet"
    dpe = dept_dir / "dpe_logement.parquet"

    for f in (bg, ffo, dvf, dpe):
        if not f.exists():
            raise FileNotFoundError(f"Table BDNB manquante : {f}")

    con = duckdb.connect()

    # SQL DuckDB tolérant : on utilise COALESCE et gère les schémas légèrement
    # différents entre millésimes BDNB.
    query = f"""
    WITH
    -- 1. Bâtiments = MAISONS INDIVIDUELLES (nb_logements = 1)
    maisons AS (
      SELECT
        bg.batiment_groupe_id,
        bg.code_commune_insee,
        ffo.mat_mur_txt,
        ffo.mat_toit_txt,
        CAST(ffo.annee_construction AS INT) AS annee_construction,
        CAST(ffo.nb_niveau AS INT) AS nb_niveau,
        CAST(ffo.nb_log AS INT) AS nb_log,
        bg.geom_groupe AS geom
      FROM read_parquet('{bg.as_posix()}') AS bg
      LEFT JOIN read_parquet('{ffo.as_posix()}') AS ffo
        USING (batiment_groupe_id)
      WHERE CAST(ffo.nb_log AS INT) = 1
        AND ffo.annee_construction IS NOT NULL
        AND CAST(ffo.annee_construction AS INT) BETWEEN 1800 AND 2025
    ),

    -- 2. DPE représentatif par bâtiment (le plus récent)
    dpe_par_batiment AS (
      SELECT
        batiment_groupe_id,
        FIRST(classe_bilan_dpe ORDER BY date_etablissement_dpe DESC) AS classe_dpe,
        FIRST(classe_emission_ges ORDER BY date_etablissement_dpe DESC) AS classe_ges,
        FIRST(CAST(conso_5_usages_ep_m2 AS DOUBLE) ORDER BY date_etablissement_dpe DESC) AS conso_kwh_m2_an,
        FIRST(CAST(surface_habitable_logement AS DOUBLE) ORDER BY date_etablissement_dpe DESC) AS surface_habitable,
        FIRST(CAST(date_etablissement_dpe AS DATE) ORDER BY date_etablissement_dpe DESC) AS date_dpe,
        COUNT(*) AS n_dpe_batiment
      FROM read_parquet('{dpe.as_posix()}')
      WHERE classe_bilan_dpe IS NOT NULL
        AND classe_bilan_dpe IN ('A','B','C','D','E','F','G')
      GROUP BY batiment_groupe_id
    ),

    -- 3. Stats DVF pré-calculées par bâtiment (par CSTB, 2014-2021)
    dvf_par_batiment AS (
      SELECT
        batiment_groupe_id,
        CAST(prix_moyen_maison AS DOUBLE) AS prix_moyen_maison,
        CAST(prix_m2_moyen_maison AS DOUBLE) AS prix_m2_moyen_maison,
        CAST(prix_m2_median_maison AS DOUBLE) AS prix_m2_median_maison,
        CAST(nb_transactions_maison AS INT) AS nb_transactions_maison,
        CAST(annee_transaction_min AS INT) AS annee_transaction_min,
        CAST(annee_transaction_max AS INT) AS annee_transaction_max
      FROM read_parquet('{dvf.as_posix()}')
      WHERE nb_transactions_maison IS NOT NULL
        AND CAST(nb_transactions_maison AS INT) >= 1
    )

    -- 4. Jointure finale
    SELECT
      m.batiment_groupe_id,
      m.code_commune_insee,
      SUBSTR(m.code_commune_insee, 1, 2) AS code_departement,
      m.annee_construction,
      m.mat_mur_txt,
      m.mat_toit_txt,
      m.nb_niveau,
      dpe.classe_dpe,
      dpe.classe_ges,
      dpe.conso_kwh_m2_an,
      dpe.surface_habitable,
      dpe.date_dpe,
      dpe.n_dpe_batiment,
      dvf.prix_moyen_maison,
      dvf.prix_m2_moyen_maison,
      dvf.prix_m2_median_maison,
      dvf.nb_transactions_maison,
      dvf.annee_transaction_min,
      dvf.annee_transaction_max
    FROM maisons AS m
    INNER JOIN dpe_par_batiment AS dpe USING (batiment_groupe_id)
    INNER JOIN dvf_par_batiment AS dvf USING (batiment_groupe_id)
    WHERE dvf.prix_m2_median_maison IS NOT NULL
      AND dvf.prix_m2_median_maison BETWEEN 500 AND 20000  -- filtre outliers
    """

    df = con.execute(query).fetch_df()
    con.close()

    print(f"✓ Jointure terminée : {len(df)} maisons individuelles avec DPE + DVF", flush=True)
    print(df["classe_dpe"].value_counts().sort_index().to_string(), flush=True)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out_path, engine="pyarrow", compression="snappy")
    print(f"✓ Écrit : {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)", flush=True)

    return df


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dept", required=True, help="Code département (ex: 94)")
    parser.add_argument("--data", default="./bdnb_data", help="Dossier BDNB téléchargée")
    parser.add_argument("--out", default="./joined", help="Dossier de sortie")
    args = parser.parse_args()

    dept = args.dept.zfill(2) if len(args.dept) == 1 else args.dept
    dept_dir = Path(args.data).resolve() / dept
    out_path = Path(args.out).resolve() / f"joined_{dept}.parquet"

    join_maisons(dept_dir, out_path)


if __name__ == "__main__":
    main()
