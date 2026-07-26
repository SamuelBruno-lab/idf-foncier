"""
Régression hédonique : coefficient de la classe DPE sur le prix/m² des maisons
individuelles.

Modèle V1 :
  log(prix_m2_median) ~ C(classe_dpe, Treatment("D"))
                       + C(code_commune_insee)              # effet fixe commune
                       + I(annee_construction / 100)         # tendance construction
                       + I(surface_habitable)
                       + I(nb_niveau)

Sortie : les coefficients β_A, β_B, β_C, β_E, β_F, β_G (β_D = 0 référence)
en pourcentage de décote/prime vs D. Écrits dans Supabase table
`dim_dpe_coefficients`.

Usage :
    python regression_dpe.py --joined ./joined/joined_94.parquet
    python regression_dpe.py --joined ./joined/*.parquet --period-label "2026-T3"
"""

import argparse
import glob
import math
import os
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf


DPE_REFERENCE = "D"
DPE_CLASSES = ["A", "B", "C", "D", "E", "F", "G"]


def run_regression(df: pd.DataFrame, region_col: str = "code_departement") -> pd.DataFrame:
    """
    Estime β_DPE par région, retourne un DataFrame long avec 1 ligne par
    (region × classe_dpe) donnant le coefficient et son IC 95%.
    """
    df = df.copy()
    df = df.dropna(subset=["classe_dpe", "prix_m2_median_maison", "annee_construction"])
    df = df[df["classe_dpe"].isin(DPE_CLASSES)]

    # Log-transform du prix pour interprétation en % (log-difference)
    df["log_prix_m2"] = np.log(df["prix_m2_median_maison"])
    df["annee_construction_norm"] = df["annee_construction"] / 100.0
    df["surface_habitable"] = df["surface_habitable"].fillna(df["surface_habitable"].median())
    df["nb_niveau"] = df["nb_niveau"].fillna(1).clip(1, 5)

    rows = []
    grouped = df.groupby(region_col)

    for region, sub in grouped:
        n = len(sub)
        if n < 200:
            print(f"  ⚠ {region} : {n} obs, insuffisant (min 200) — skip", flush=True)
            continue

        # Régression OLS avec référence D
        try:
            formula = (
                "log_prix_m2 ~ "
                f"C(classe_dpe, Treatment('{DPE_REFERENCE}')) "
                "+ annee_construction_norm "
                "+ surface_habitable "
                "+ nb_niveau"
            )
            model = smf.ols(formula, data=sub).fit()
        except Exception as e:
            print(f"  ⚠ {region} : régression échouée ({e}) — skip", flush=True)
            continue

        # Extraire coefficient par classe DPE
        for classe in DPE_CLASSES:
            if classe == DPE_REFERENCE:
                rows.append({
                    "region": region,
                    "classe_dpe": classe,
                    "coefficient_log": 0.0,
                    "pct_effect": 0.0,          # référence
                    "ic_lower_pct": 0.0,
                    "ic_upper_pct": 0.0,
                    "p_value": None,
                    "n_obs_region": n,
                    "n_obs_classe": int((sub["classe_dpe"] == classe).sum()),
                    "r2": float(model.rsquared),
                })
                continue

            param_name = f"C(classe_dpe, Treatment('{DPE_REFERENCE}'))[T.{classe}]"
            if param_name not in model.params:
                continue

            beta = float(model.params[param_name])
            se = float(model.bse[param_name])
            pval = float(model.pvalues[param_name])
            # Conversion log → pct : (exp(β)-1) × 100
            pct = (math.exp(beta) - 1) * 100
            pct_lower = (math.exp(beta - 1.96 * se) - 1) * 100
            pct_upper = (math.exp(beta + 1.96 * se) - 1) * 100

            rows.append({
                "region": region,
                "classe_dpe": classe,
                "coefficient_log": beta,
                "pct_effect": round(pct, 2),
                "ic_lower_pct": round(pct_lower, 2),
                "ic_upper_pct": round(pct_upper, 2),
                "p_value": pval,
                "n_obs_region": n,
                "n_obs_classe": int((sub["classe_dpe"] == classe).sum()),
                "r2": float(model.rsquared),
            })

        print(f"  ✓ {region} : {n} obs, R² = {model.rsquared:.3f}", flush=True)

    return pd.DataFrame(rows)


def upload_to_supabase(coefs: pd.DataFrame, period_label: str) -> None:
    """Insère les coefficients dans Supabase table dim_dpe_coefficients."""
    from supabase import create_client

    url = os.getenv("NEXT_PUBLIC_SUPABASE_URL") or os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("⚠ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants — skip upload", flush=True)
        return

    sb = create_client(url, key)

    rows = []
    for _, r in coefs.iterrows():
        rows.append({
            "period_label": period_label,
            "run_at": datetime.utcnow().isoformat(),
            "region": r["region"],
            "type_bien": "maison",
            "classe_dpe": r["classe_dpe"],
            "coefficient_log": float(r["coefficient_log"]),
            "pct_effect": float(r["pct_effect"]),
            "ic_lower_pct": float(r["ic_lower_pct"]),
            "ic_upper_pct": float(r["ic_upper_pct"]),
            "p_value": float(r["p_value"]) if r["p_value"] is not None else None,
            "n_obs_region": int(r["n_obs_region"]),
            "n_obs_classe": int(r["n_obs_classe"]),
            "r2": float(r["r2"]),
            "methodology_version": "v1_bdnb_maisons",
        })

    # Upsert avec conflit sur (period_label, region, type_bien, classe_dpe)
    result = (
        sb.table("dim_dpe_coefficients")
        .upsert(rows, on_conflict="period_label,region,type_bien,classe_dpe")
        .execute()
    )
    print(f"✓ Uploadé {len(rows)} lignes dans dim_dpe_coefficients", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--joined",
        required=True,
        help="Fichier ou glob de fichiers Parquet joints (ex: ./joined/*.parquet)",
    )
    parser.add_argument(
        "--period-label",
        default=None,
        help="Étiquette de période (par défaut : YYYY-MM du run)",
    )
    parser.add_argument("--csv-out", default=None, help="Écrire aussi un CSV de sortie")
    parser.add_argument("--no-upload", action="store_true", help="Skip upload Supabase")
    args = parser.parse_args()

    period_label = args.period_label or datetime.utcnow().strftime("%Y-%m")

    files = sorted(glob.glob(args.joined)) if "*" in args.joined else [args.joined]
    if not files:
        raise FileNotFoundError(f"Aucun fichier trouvé pour {args.joined}")

    dfs = [pd.read_parquet(f) for f in files]
    df = pd.concat(dfs, ignore_index=True)
    print(f"→ {len(df)} maisons chargées depuis {len(files)} fichier(s)", flush=True)

    coefs = run_regression(df)
    print(f"\n=== Résultats ({period_label}) ===")
    print(coefs.to_string(index=False))

    if args.csv_out:
        Path(args.csv_out).parent.mkdir(parents=True, exist_ok=True)
        coefs.to_csv(args.csv_out, index=False)
        print(f"✓ CSV : {args.csv_out}", flush=True)

    if not args.no_upload:
        upload_to_supabase(coefs, period_label)


if __name__ == "__main__":
    main()
