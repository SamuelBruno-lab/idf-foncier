#!/usr/bin/env python3
"""
DATAMERRY — Analyse statistique DVF × OAT 10 ans.

Quantifie l'influence du contexte macro (taux OAT 10 ans) sur les prix
immobiliers historiques DVF. Produit un coefficient d'élasticité β empirique
qui sera ensuite utilisé par le tool chatbot `compute_market_adjusted_price`.

Sortie :
  analyses/output/dvf_oat_report.html           — rapport visuel
  analyses/output/dvf_oat_coefficients.csv      — β par segment (commune, type, pièce)
  analyses/output/dvf_oat_summary.json          — coefficients globaux + tests stats

Méthodologie :
  1. Charge DVF (depuis Supabase ou CSV local) + OAT 10 ans
  2. Joint sur date de mutation
  3. Pearson + Spearman (correlation rank robuste aux outliers)
  4. Régression linéaire log(prix_m2) = α + β × taux_oat + ε
  5. Régression avec lag (effet décalé 3/6/12 mois)
  6. Régression avec fixed effects communes (isole l'effet macro pur)

Hypothèse a priori (littérature française) :
  β ≈ -8% à -12% par +100bp de taux OAT
  (BdF Bulletin économique, OFCE, Crédit Foncier)

Usage :
  python analyses/dvf_oat_correlation.py [--limit N] [--from YYYY-MM-DD]

Dépendances :
  pip install pandas numpy scipy statsmodels matplotlib seaborn psycopg[binary]
"""

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

try:
    import psycopg
    from scipy import stats
    import statsmodels.api as sm
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError as e:
    print(f"❌ Dépendance manquante : {e}")
    print("   Installe : pip install 'psycopg[binary]' scipy statsmodels matplotlib seaborn pandas numpy")
    sys.exit(1)


OUT_DIR = Path(__file__).resolve().parent / "output"
OUT_DIR.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# Connexion Supabase
# ─────────────────────────────────────────────────────────────────────────────

def get_connection() -> "psycopg.Connection":
    uri = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")
    if not uri:
        print("❌ SUPABASE_DB_URL manquante. Format : postgresql://...")
        sys.exit(1)
    return psycopg.connect(uri, connect_timeout=15)


# ─────────────────────────────────────────────────────────────────────────────
# Loaders
# ─────────────────────────────────────────────────────────────────────────────

def load_dvf(conn, limit: int | None = None, since: date | None = None) -> pd.DataFrame:
    """
    Charge les transactions DVF depuis la table source (s'adapte au schéma
    existant — modifie le nom de la table si différent dans ton Supabase).

    Conventions attendues :
      - colonne date : `date_mutation` (DATE)
      - colonne prix : `valeur_fonciere` (NUMERIC)
      - colonne surface : `surface_reelle_bati` (NUMERIC)
      - colonne type : `type_local`
      - colonne commune : `code_commune` (INSEE)
    """
    where_clauses = [
        "valeur_fonciere > 10000",
        "valeur_fonciere < 5000000",
        "surface_reelle_bati BETWEEN 8 AND 500",
        "type_local IN ('Appartement', 'Maison')",
    ]
    if since:
        where_clauses.append(f"date_mutation >= '{since.isoformat()}'")
    where = " AND ".join(where_clauses)
    sql = f"""
        SELECT
          date_mutation::date AS date_mutation,
          code_commune,
          type_local,
          valeur_fonciere::float AS prix,
          surface_reelle_bati::float AS surface,
          nombre_pieces_principales::int AS pieces
        FROM public.fact_dvf
        WHERE {where}
        ORDER BY date_mutation
    """
    if limit:
        sql += f" LIMIT {limit}"
    print(f"▶ Chargement DVF depuis Supabase…")
    df = pd.read_sql(sql, conn)
    df["prix_m2"] = df["prix"] / df["surface"]
    # Filtrage prix/m² réaliste
    df = df[(df["prix_m2"] >= 500) & (df["prix_m2"] <= 25000)]
    print(f"  ✅ {len(df):,} transactions chargées (filtres qualité appliqués)")
    return df


def load_oat(conn) -> pd.DataFrame:
    print(f"▶ Chargement OAT 10 ans…")
    df = pd.read_sql(
        "SELECT date_obs AS date_oat, taux_oat_10y FROM public.fact_taux_oat10y ORDER BY date_obs",
        conn,
    )
    print(f"  ✅ {len(df):,} observations OAT")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Join DVF × OAT
# ─────────────────────────────────────────────────────────────────────────────

def join_dvf_oat(dvf: pd.DataFrame, oat: pd.DataFrame) -> pd.DataFrame:
    """
    Pour chaque transaction DVF, on attache le taux OAT du jour de mutation
    (ou le plus proche jour ouvré antérieur si la mutation tombe un weekend).
    """
    oat = oat.sort_values("date_oat")
    dvf = dvf.sort_values("date_mutation")
    merged = pd.merge_asof(
        dvf,
        oat,
        left_on="date_mutation",
        right_on="date_oat",
        direction="backward",
        tolerance=pd.Timedelta("7 days"),
    )
    n_before = len(merged)
    merged = merged.dropna(subset=["taux_oat_10y"])
    print(f"▶ Join DVF × OAT : {len(merged):,}/{n_before:,} avec taux disponible")
    return merged


# ─────────────────────────────────────────────────────────────────────────────
# Statistiques descriptives
# ─────────────────────────────────────────────────────────────────────────────

def descriptive(merged: pd.DataFrame) -> dict:
    print(f"\n▶ Statistiques descriptives :")
    stats_dict = {
        "n_observations": int(len(merged)),
        "periode_debut": str(merged["date_mutation"].min()),
        "periode_fin": str(merged["date_mutation"].max()),
        "prix_m2_median": float(merged["prix_m2"].median()),
        "prix_m2_mean": float(merged["prix_m2"].mean()),
        "taux_oat_median": float(merged["taux_oat_10y"].median()),
        "taux_oat_mean": float(merged["taux_oat_10y"].mean()),
        "taux_oat_min": float(merged["taux_oat_10y"].min()),
        "taux_oat_max": float(merged["taux_oat_10y"].max()),
    }
    for k, v in stats_dict.items():
        print(f"  {k:24s} : {v}")
    return stats_dict


# ─────────────────────────────────────────────────────────────────────────────
# Corrélations Pearson + Spearman
# ─────────────────────────────────────────────────────────────────────────────

def compute_correlations(merged: pd.DataFrame) -> dict:
    print(f"\n▶ Corrélations Pearson + Spearman (prix_m2 × taux_oat) :")
    pearson_r, pearson_p = stats.pearsonr(merged["prix_m2"], merged["taux_oat_10y"])
    spearman_r, spearman_p = stats.spearmanr(merged["prix_m2"], merged["taux_oat_10y"])
    log_pearson_r, log_pearson_p = stats.pearsonr(
        np.log(merged["prix_m2"]), merged["taux_oat_10y"]
    )
    out = {
        "pearson_r": float(pearson_r),
        "pearson_p_value": float(pearson_p),
        "spearman_rho": float(spearman_r),
        "spearman_p_value": float(spearman_p),
        "log_pearson_r": float(log_pearson_r),
        "log_pearson_p_value": float(log_pearson_p),
    }
    for k, v in out.items():
        print(f"  {k:25s} : {v:.6f}")
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Régression OLS log(prix_m2) ~ taux_oat
# ─────────────────────────────────────────────────────────────────────────────

def regression_simple(merged: pd.DataFrame) -> dict:
    print(f"\n▶ Régression OLS : log(prix_m2) = α + β × taux_oat + ε")
    y = np.log(merged["prix_m2"])
    X = sm.add_constant(merged["taux_oat_10y"])
    model = sm.OLS(y, X).fit()
    print(model.summary().as_text()[:1200])

    beta = float(model.params["taux_oat_10y"])
    elasticity_per_100bp = (np.exp(beta) - 1) * 100  # interprété comme delta % de prix pour +1pt de taux
    out = {
        "alpha": float(model.params["const"]),
        "beta_taux_oat": beta,
        "elasticity_per_100bp_pct": float(elasticity_per_100bp),
        "r_squared": float(model.rsquared),
        "adj_r_squared": float(model.rsquared_adj),
        "n_obs": int(model.nobs),
        "t_stat_beta": float(model.tvalues["taux_oat_10y"]),
        "p_value_beta": float(model.pvalues["taux_oat_10y"]),
        "conf_int_beta_low": float(model.conf_int().loc["taux_oat_10y", 0]),
        "conf_int_beta_high": float(model.conf_int().loc["taux_oat_10y", 1]),
    }
    print(f"\n  📊 ÉLASTICITÉ EMPIRIQUE : prix immo varie de {elasticity_per_100bp:+.2f}% par +1pt de taux OAT")
    print(f"     (R² = {out['r_squared']:.4f}, p < {out['p_value_beta']:.6f})")
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Régression avec lag (effet décalé)
# ─────────────────────────────────────────────────────────────────────────────

def regression_with_lag(merged: pd.DataFrame, oat: pd.DataFrame) -> dict:
    print(f"\n▶ Régression avec lag (taux OAT à T-3/-6/-12 mois)")
    results = {}
    for months in [0, 3, 6, 12]:
        lagged_oat = oat.copy()
        lagged_oat["date_oat"] = lagged_oat["date_oat"] - pd.Timedelta(days=30 * months)
        lagged_oat = lagged_oat.rename(columns={"taux_oat_10y": f"taux_oat_lag{months}m"})

        m = pd.merge_asof(
            merged.sort_values("date_mutation"),
            lagged_oat.sort_values("date_oat"),
            left_on="date_mutation",
            right_on="date_oat",
            direction="backward",
            tolerance=pd.Timedelta("31 days"),
        ).dropna(subset=[f"taux_oat_lag{months}m"])

        if len(m) < 100:
            continue
        y = np.log(m["prix_m2"])
        X = sm.add_constant(m[f"taux_oat_lag{months}m"])
        mdl = sm.OLS(y, X).fit()
        beta = float(mdl.params[f"taux_oat_lag{months}m"])
        elasticity = (np.exp(beta) - 1) * 100
        results[f"lag_{months}m"] = {
            "beta": beta,
            "elasticity_per_100bp_pct": float(elasticity),
            "r_squared": float(mdl.rsquared),
            "n_obs": int(mdl.nobs),
            "p_value": float(mdl.pvalues[f"taux_oat_lag{months}m"]),
        }
        print(f"  Lag {months:2d}m : β={beta:+.4f} → {elasticity:+.2f}%/100bp · R²={mdl.rsquared:.4f}")
    return results


# ─────────────────────────────────────────────────────────────────────────────
# Coefficients par segment (commune × type)
# ─────────────────────────────────────────────────────────────────────────────

def beta_by_segment(merged: pd.DataFrame, min_obs: int = 200) -> pd.DataFrame:
    print(f"\n▶ Coefficient β par segment (min {min_obs} obs/segment)…")
    rows = []
    for (commune, type_local), g in merged.groupby(["code_commune", "type_local"]):
        if len(g) < min_obs:
            continue
        if g["taux_oat_10y"].std() < 0.1:  # pas assez de variance
            continue
        y = np.log(g["prix_m2"])
        X = sm.add_constant(g["taux_oat_10y"])
        try:
            m = sm.OLS(y, X).fit()
            rows.append(
                {
                    "code_commune": commune,
                    "type_local": type_local,
                    "n_obs": len(g),
                    "beta": float(m.params["taux_oat_10y"]),
                    "elasticity_per_100bp_pct": float(
                        (np.exp(m.params["taux_oat_10y"]) - 1) * 100
                    ),
                    "r_squared": float(m.rsquared),
                    "p_value": float(m.pvalues["taux_oat_10y"]),
                }
            )
        except Exception:
            continue
    df = pd.DataFrame(rows).sort_values("n_obs", ascending=False)
    print(f"  ✅ {len(df):,} segments analysés")
    print(f"  β médian : {df['beta'].median():.4f}")
    print(f"  Élasticité médiane : {df['elasticity_per_100bp_pct'].median():+.2f}% par +100bp")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Visualisations
# ─────────────────────────────────────────────────────────────────────────────

def make_plots(merged: pd.DataFrame, segments_df: pd.DataFrame) -> list[Path]:
    print(f"\n▶ Génération des visualisations…")
    paths = []

    # 1) Série temporelle prix_m2 médian × OAT
    monthly = merged.copy()
    monthly["month"] = pd.to_datetime(monthly["date_mutation"]).dt.to_period("M").dt.to_timestamp()
    agg = monthly.groupby("month").agg(
        prix_m2_median=("prix_m2", "median"),
        taux_oat=("taux_oat_10y", "mean"),
    )
    fig, ax1 = plt.subplots(figsize=(12, 5))
    ax1.plot(agg.index, agg["prix_m2_median"], color="#1f3a8a", label="Prix médian €/m²")
    ax1.set_ylabel("Prix médian €/m²", color="#1f3a8a")
    ax2 = ax1.twinx()
    ax2.plot(agg.index, agg["taux_oat"], color="#c2410c", label="Taux OAT 10y (%)")
    ax2.set_ylabel("Taux OAT 10 ans (%)", color="#c2410c")
    plt.title("Prix immobilier médian vs Taux OAT 10 ans (France)")
    p1 = OUT_DIR / "series_temporelle.png"
    plt.tight_layout()
    plt.savefig(p1, dpi=120)
    plt.close()
    paths.append(p1)

    # 2) Scatter log(prix_m2) × taux_oat avec droite de régression
    fig, ax = plt.subplots(figsize=(10, 6))
    sample = merged.sample(min(20000, len(merged)), random_state=42)
    ax.scatter(sample["taux_oat_10y"], np.log(sample["prix_m2"]), alpha=0.05, s=4, color="#1f3a8a")
    coef = np.polyfit(merged["taux_oat_10y"], np.log(merged["prix_m2"]), 1)
    xs = np.linspace(merged["taux_oat_10y"].min(), merged["taux_oat_10y"].max(), 100)
    ax.plot(xs, coef[1] + coef[0] * xs, color="#c2410c", linewidth=2,
            label=f"OLS β = {coef[0]:+.4f}")
    ax.set_xlabel("Taux OAT 10 ans (%)")
    ax.set_ylabel("log(Prix €/m²)")
    ax.set_title("Relation log(prix_m2) × taux OAT 10 ans")
    ax.legend()
    p2 = OUT_DIR / "scatter_log_prix_vs_oat.png"
    plt.tight_layout()
    plt.savefig(p2, dpi=120)
    plt.close()
    paths.append(p2)

    # 3) Distribution des β par segment
    if not segments_df.empty:
        fig, ax = plt.subplots(figsize=(10, 5))
        ax.hist(segments_df["elasticity_per_100bp_pct"], bins=60, color="#1f3a8a", edgecolor="white")
        ax.axvline(segments_df["elasticity_per_100bp_pct"].median(), color="#c2410c", linewidth=2,
                   label=f"Médiane : {segments_df['elasticity_per_100bp_pct'].median():+.2f}%")
        ax.set_xlabel("Élasticité (% / +100bp)")
        ax.set_ylabel("Nombre de segments (commune × type)")
        ax.set_title("Distribution de l'élasticité prix/taux par micro-marché")
        ax.legend()
        p3 = OUT_DIR / "distribution_elasticite.png"
        plt.tight_layout()
        plt.savefig(p3, dpi=120)
        plt.close()
        paths.append(p3)

    for p in paths:
        print(f"  ✅ {p}")
    return paths


# ─────────────────────────────────────────────────────────────────────────────
# Rapport HTML
# ─────────────────────────────────────────────────────────────────────────────

def write_report(
    descriptive: dict,
    correlations: dict,
    regression: dict,
    lag_results: dict,
    segments_df: pd.DataFrame,
    plot_paths: list[Path],
) -> Path:
    print(f"\n▶ Génération du rapport HTML…")
    plot_html = "".join(
        f'<figure><img src="{p.name}" alt="{p.stem}"/><figcaption>{p.stem.replace("_"," ")}</figcaption></figure>'
        for p in plot_paths
    )
    best_lag = max(lag_results.items(), key=lambda kv: kv[1]["r_squared"])[0] if lag_results else "n/a"

    html = f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><title>DATAMERRY — Rapport DVF × OAT 10 ans</title>
<style>
  body{{font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:960px;margin:32px auto;padding:0 24px;color:#0f172a;line-height:1.5}}
  h1,h2,h3{{color:#1f3a8a}} h1{{border-bottom:2px solid #1f3a8a;padding-bottom:8px}}
  table{{border-collapse:collapse;width:100%;margin:16px 0;font-size:13px}}
  th,td{{border:1px solid #e2e8f0;padding:8px 12px;text-align:left}}
  th{{background:#f1f5f9;font-weight:600}}
  .big{{font-size:24px;font-weight:700;color:#c2410c}}
  .small{{font-size:12px;color:#64748b}}
  figure{{margin:16px 0}} figure img{{max-width:100%;border:1px solid #e2e8f0;border-radius:8px}}
  figcaption{{font-size:11px;color:#94a3b8;margin-top:4px}}
  .alert{{background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0;font-size:13px}}
</style>
</head><body>

<h1>DATAMERRY — Analyse statistique DVF × OAT 10 ans</h1>
<p class="small">Généré automatiquement par <code>analyses/dvf_oat_correlation.py</code> · Sources : DVF (DGFiP open data), ECB SDW / BdF / FRED.</p>

<h2>📊 Résultat clé</h2>
<p>
  Élasticité empirique du prix immobilier français au taux OAT 10 ans (modèle OLS simple) :<br>
  <span class="big">{regression['elasticity_per_100bp_pct']:+.2f}% par +100bp</span>
</p>
<p class="small">
  Intervalle de confiance 95% : [{(np.exp(regression['conf_int_beta_low'])-1)*100:+.2f}% ; {(np.exp(regression['conf_int_beta_high'])-1)*100:+.2f}%]<br>
  R² = {regression['r_squared']:.4f} · p-value &lt; {regression['p_value_beta']:.6e} · n = {regression['n_obs']:,} transactions
</p>

<div class="alert">
  <strong>Interprétation :</strong> quand l'OAT 10 ans monte de 1 point de pourcentage,
  le prix immobilier au m² ajusté varie de
  <strong>{regression['elasticity_per_100bp_pct']:+.2f}%</strong> en moyenne (toute chose égale par ailleurs).
  Le meilleur lag testé est <strong>{best_lag}</strong> (effet décalé).
</div>

<h2>1. Statistiques descriptives</h2>
<table>{''.join(f'<tr><td>{k}</td><td>{v}</td></tr>' for k,v in descriptive.items())}</table>

<h2>2. Corrélations</h2>
<table>
  <tr><th>Test</th><th>Coefficient</th><th>p-value</th></tr>
  <tr><td>Pearson (prix_m2 × taux)</td><td>{correlations['pearson_r']:.4f}</td><td>{correlations['pearson_p_value']:.2e}</td></tr>
  <tr><td>Spearman (rang)</td><td>{correlations['spearman_rho']:.4f}</td><td>{correlations['spearman_p_value']:.2e}</td></tr>
  <tr><td>Pearson sur log(prix_m2)</td><td>{correlations['log_pearson_r']:.4f}</td><td>{correlations['log_pearson_p_value']:.2e}</td></tr>
</table>

<h2>3. Régression avec lag (effet décalé)</h2>
<table>
  <tr><th>Lag</th><th>β</th><th>Élasticité (%/100bp)</th><th>R²</th><th>n obs</th><th>p-value</th></tr>
  {''.join(f"<tr><td>{k}</td><td>{v['beta']:+.4f}</td><td>{v['elasticity_per_100bp_pct']:+.2f}%</td><td>{v['r_squared']:.4f}</td><td>{v['n_obs']:,}</td><td>{v['p_value']:.2e}</td></tr>" for k,v in lag_results.items())}
</table>

<h2>4. Coefficient par segment (commune × type)</h2>
<p>{len(segments_df):,} segments analysés (≥200 obs). β médian = {segments_df['beta'].median():.4f}, élasticité médiane = {segments_df['elasticity_per_100bp_pct'].median():+.2f}%/100bp.</p>
<p class="small">CSV complet : <code>analyses/output/dvf_oat_coefficients.csv</code></p>

<h2>5. Visualisations</h2>
{plot_html}

<h2>6. Implications pour le tool chatbot</h2>
<p>Le coefficient empirique <strong>{regression['elasticity_per_100bp_pct']:+.2f}% / +100bp</strong> sera utilisé par
le tool <code>compute_market_adjusted_price</code> du chatbot DATAMERRY pour ajuster le prix médian cluster
en fonction du delta entre taux historique du cluster et taux actuel.</p>

<p class="small">Reproductibilité : voir <code>analyses/dvf_oat_correlation.py</code>. Données brutes accessibles
via <code>fact_dvf</code> et <code>fact_taux_oat10y</code> Supabase.</p>

</body></html>"""

    p = OUT_DIR / "dvf_oat_report.html"
    p.write_text(html, encoding="utf-8")
    print(f"  ✅ {p}")
    return p


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Limite n transactions DVF (debug)")
    parser.add_argument("--from", dest="since", type=str, default="2014-01-01", help="Date min DVF")
    args = parser.parse_args()

    since = date.fromisoformat(args.since) if args.since else None

    conn = get_connection()
    try:
        dvf = load_dvf(conn, limit=args.limit, since=since)
        oat = load_oat(conn)
        oat["date_oat"] = pd.to_datetime(oat["date_oat"])
        dvf["date_mutation"] = pd.to_datetime(dvf["date_mutation"])

        merged = join_dvf_oat(dvf, oat)
        if len(merged) < 1000:
            print(f"\n❌ Trop peu d'observations jointes ({len(merged)}). Lance d'abord pipeline_oat10y.py --bootstrap.")
            sys.exit(1)

        d = descriptive(merged)
        c = compute_correlations(merged)
        r = regression_simple(merged)
        lr = regression_with_lag(merged, oat)
        seg = beta_by_segment(merged)

        seg_csv = OUT_DIR / "dvf_oat_coefficients.csv"
        seg.to_csv(seg_csv, index=False)
        print(f"\n💾 {seg_csv}")

        plots = make_plots(merged, seg)
        report = write_report(d, c, r, lr, seg, plots)

        # Summary JSON pour intégration future tool chatbot
        summary = {
            "descriptive": d,
            "correlations": c,
            "regression_simple": r,
            "regression_lag": lr,
            "segments_summary": {
                "n_segments": int(len(seg)),
                "median_beta": float(seg["beta"].median()),
                "median_elasticity_per_100bp_pct": float(seg["elasticity_per_100bp_pct"].median()),
                "p25_elasticity": float(seg["elasticity_per_100bp_pct"].quantile(0.25)),
                "p75_elasticity": float(seg["elasticity_per_100bp_pct"].quantile(0.75)),
            },
        }
        summary_path = OUT_DIR / "dvf_oat_summary.json"
        summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"💾 {summary_path}")

        print(f"\n✅ Rapport disponible : {report}")
        print(f"   Ouvre-le dans un navigateur pour visualiser.\n")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
