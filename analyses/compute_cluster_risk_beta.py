#!/usr/bin/env python3
"""
DATAMERRY — Calcul du beta CAPM-style par cluster HDBSCAN.

Calcule pour chaque cluster :
  - σ (sigma) : volatilité QoQ% des prix
  - λ (lambda) : illiquidité = 1 / (ventes par an)
  - ρ (rho)   : rareté = 1 / (densité ventes par km²)

Compose un beta unique :
  beta = w_σ × z(σ) + w_λ × z(λ) + w_ρ × z(ρ)

Recentré pour avoir β=1 sur le cluster médian France.
β > 1 = micro-marché plus risqué (volatile, illiquide, rare)
β < 1 = micro-marché plus défensif (Paris 16e, Neuilly, etc.)

Usage :
  python analyses/compute_cluster_risk_beta.py
  python analyses/compute_cluster_risk_beta.py --weights "0.5,0.3,0.2"
  python analyses/compute_cluster_risk_beta.py --since 2018-01-01

Output :
  - Upsert dans public.fact_cluster_risk
  - CSV analyses/output/cluster_risk_beta.csv pour audit
"""

import argparse
import os
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd

try:
    import psycopg
    from shapely.geometry import Polygon
except ImportError as e:
    print(f"❌ Dépendance manquante : {e}")
    print("   pip install 'psycopg[binary]' shapely pandas numpy")
    sys.exit(1)


OUT_DIR = Path(__file__).resolve().parent / "output"
OUT_DIR.mkdir(exist_ok=True)


# ─────────────────────────────────────────────────────────────────────────────
# Connexion + loaders
# ─────────────────────────────────────────────────────────────────────────────

def get_connection() -> "psycopg.Connection":
    uri = os.environ.get("SUPABASE_DB_URL") or os.environ.get("DATABASE_URL")
    if not uri:
        print("❌ SUPABASE_DB_URL manquante. Format : postgresql://...")
        sys.exit(1)
    return psycopg.connect(uri, connect_timeout=15)


def load_dvf_points(conn, since: date | None) -> pd.DataFrame:
    where = "valeur_fonciere > 10000 AND surface BETWEEN 8 AND 500"
    if since:
        where += f" AND date_mutation >= '{since.isoformat()}'"
    sql = f"""
        SELECT
          date_mutation::date AS date_mutation,
          code_commune,
          type_local,
          prix_m2::float AS prix_m2,
          lat::float AS lat,
          lon::float AS lon
        FROM public.dvf_points
        WHERE {where}
    """
    print("▶ Chargement DVF points…")
    df = pd.read_sql(sql, conn)
    df = df[(df["prix_m2"] >= 500) & (df["prix_m2"] <= 25000)]
    print(f"  ✅ {len(df):,} transactions")
    return df


def load_hdbscan_zones(conn) -> pd.DataFrame:
    print("▶ Chargement clusters HDBSCAN…")
    sql = """
        SELECT id AS zone_id, code_commune, type_local, count,
               hull_coords, centroid_lat, centroid_lon
        FROM public.dvf_hdbscan_zones
        WHERE hull_coords IS NOT NULL
    """
    df = pd.read_sql(sql, conn)
    print(f"  ✅ {len(df):,} clusters")
    return df


# ─────────────────────────────────────────────────────────────────────────────
# Mapping transaction → cluster (point-in-polygon)
# ─────────────────────────────────────────────────────────────────────────────

def _point_in_polygon(point, polygon):
    if len(polygon) < 3:
        return False
    x, y = point
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i][0], polygon[i][1]
        xj, yj = polygon[j][0], polygon[j][1]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def assign_clusters(dvf: pd.DataFrame, zones: pd.DataFrame) -> pd.DataFrame:
    print("▶ Mapping transactions → clusters (point-in-polygon)…")
    zones_by_key: dict[tuple[str, str], list[tuple[str, list]]] = {}
    for z in zones.itertuples(index=False):
        zones_by_key.setdefault((z.code_commune, z.type_local), []).append(
            (z.zone_id, z.hull_coords)
        )

    zone_ids = []
    matched = 0
    for row in dvf.itertuples(index=False):
        candidates = zones_by_key.get((row.code_commune, row.type_local), [])
        point = (float(row.lat), float(row.lon))
        match_id = None
        for zid, hull in candidates:
            if _point_in_polygon(point, hull):
                match_id = zid
                break
        if match_id:
            matched += 1
        zone_ids.append(match_id)

    dvf = dvf.copy()
    dvf["zone_id"] = zone_ids
    pct = (matched / len(dvf) * 100) if len(dvf) > 0 else 0
    print(f"  ✅ {matched:,}/{len(dvf):,} mappés ({pct:.1f}%)")
    return dvf.dropna(subset=["zone_id"])


# ─────────────────────────────────────────────────────────────────────────────
# Calcul σ, λ, ρ
# ─────────────────────────────────────────────────────────────────────────────

def haversine_km(lat1, lon1, lat2, lon2):
    """Distance Haversine en km."""
    R = 6371.0
    p = np.pi / 180
    a = (
        0.5
        - np.cos((lat2 - lat1) * p) / 2
        + np.cos(lat1 * p) * np.cos(lat2 * p) * (1 - np.cos((lon2 - lon1) * p)) / 2
    )
    return 2 * R * np.arcsin(np.sqrt(a))


def hull_area_km2(hull_coords: list[list[float]]) -> float | None:
    """
    Calcule l'aire approximative d'un hull en km² à partir des coords (lat, lon).
    Méthode : Polygon shapely en degrés, puis conversion approximative à la
    latitude moyenne du hull (1° lat ≈ 111 km, 1° lon ≈ 111 × cos(lat) km).
    """
    if not hull_coords or len(hull_coords) < 4:
        return None
    try:
        poly = Polygon(hull_coords)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty:
            return None
        # area en degrés² ; on convertit en km²
        lats = [c[0] for c in hull_coords]
        mean_lat = sum(lats) / len(lats)
        deg_lat_km = 111.0
        deg_lon_km = 111.0 * np.cos(np.radians(mean_lat))
        return float(poly.area * deg_lat_km * deg_lon_km)
    except Exception:
        return None


def compute_sigma_lambda_rho(
    dvf_mapped: pd.DataFrame,
    zones: pd.DataFrame,
) -> pd.DataFrame:
    """
    Pour chaque cluster, calcule σ (vol QoQ%), λ (illiquidité), ρ (rareté).
    Renvoie un DataFrame [zone_id, sigma_qoq_pct, lambda_illiquidite, rho_rarete,
    n_obs_total, n_quarters, area_km2].
    """
    print("\n▶ Calcul σ (volatilité), λ (illiquidité), ρ (rareté) par cluster…")

    # Volatilité QoQ par cluster
    m = dvf_mapped.copy()
    m["date_mutation"] = pd.to_datetime(m["date_mutation"])
    m["year_quarter"] = m["date_mutation"].dt.to_period("Q")
    qoq = (
        m.groupby(["zone_id", "year_quarter"])
        .agg(prix_m2_median=("prix_m2", "median"), n_obs=("prix_m2", "size"))
        .reset_index()
    )
    qoq = qoq[qoq["n_obs"] >= 3]  # min 3 ventes par trimestre
    qoq = qoq.sort_values(["zone_id", "year_quarter"])
    qoq["qoq_pct"] = qoq.groupby("zone_id")["prix_m2_median"].pct_change() * 100
    sigma = (
        qoq.groupby("zone_id")
        .agg(sigma_qoq_pct=("qoq_pct", "std"), n_quarters=("qoq_pct", "count"))
        .reset_index()
    )
    sigma = sigma[sigma["n_quarters"] >= 4]  # min 4 trimestres pour calcul std

    # Liquidité : ventes par an par cluster
    cluster_dates = (
        dvf_mapped.groupby("zone_id")
        .agg(
            n_obs_total=("prix_m2", "size"),
            date_min=("date_mutation", "min"),
            date_max=("date_mutation", "max"),
        )
        .reset_index()
    )
    cluster_dates["nb_annees"] = (
        (
            pd.to_datetime(cluster_dates["date_max"])
            - pd.to_datetime(cluster_dates["date_min"])
        ).dt.days
        / 365.25
    ).clip(lower=0.25)  # min 3 mois
    cluster_dates["ventes_par_an"] = (
        cluster_dates["n_obs_total"] / cluster_dates["nb_annees"]
    )
    cluster_dates["lambda_illiquidite"] = 1.0 / cluster_dates["ventes_par_an"]

    # Rareté : 1 / densité ventes par km²
    zones_area = zones.copy()
    zones_area["area_km2"] = zones_area["hull_coords"].apply(hull_area_km2)
    rho_df = (
        cluster_dates.merge(zones_area[["zone_id", "area_km2"]], on="zone_id", how="left")
    )
    rho_df["densite_par_km2"] = rho_df["n_obs_total"] / rho_df["area_km2"]
    rho_df["rho_rarete"] = 1.0 / rho_df["densite_par_km2"].replace(0, np.nan)

    # Merge final
    out = sigma.merge(
        rho_df[
            ["zone_id", "lambda_illiquidite", "rho_rarete", "n_obs_total",
             "area_km2", "ventes_par_an"]
        ],
        on="zone_id",
        how="inner",
    )
    out = out.dropna(subset=["sigma_qoq_pct", "lambda_illiquidite", "rho_rarete"])
    out = out[(out["sigma_qoq_pct"] > 0) & (out["lambda_illiquidite"] > 0) & (out["rho_rarete"] > 0)]
    print(f"  ✅ {len(out):,} clusters avec σ, λ, ρ valides")
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Composite beta (z-scores + pondération + recentrage sur 1)
# ─────────────────────────────────────────────────────────────────────────────

def compute_beta_composite(
    df: pd.DataFrame, weights: tuple[float, float, float] = (0.5, 0.3, 0.2)
) -> pd.DataFrame:
    """
    Z-score chacune des 3 composantes, applique les poids, recentre pour β=1
    sur le cluster médian.

    Poids par défaut : 0.5 volatilité / 0.3 illiquidité / 0.2 rareté.
    """
    print(f"\n▶ Composite β (poids σ={weights[0]} λ={weights[1]} ρ={weights[2]})…")

    out = df.copy()
    for col in ("sigma_qoq_pct", "lambda_illiquidite", "rho_rarete"):
        # Log-transform pour normaliser les distributions (typiquement skewed)
        vals = np.log(out[col].clip(lower=1e-6))
        out[f"z_{col}"] = (vals - vals.mean()) / vals.std()

    w_s, w_l, w_r = weights
    composite_raw = (
        w_s * out["z_sigma_qoq_pct"]
        + w_l * out["z_lambda_illiquidite"]
        + w_r * out["z_rho_rarete"]
    )

    # Recentrer pour que β médian = 1 (cluster moyen France = 1 par construction CAPM)
    median = composite_raw.median()
    std = composite_raw.std()
    # On veut médiane → 1, et un β qui a du sens dans [0.4 ; 1.8] pour l'immo résidentiel
    # → on utilise std / 2.5 comme échelle (paramétrable)
    out["beta"] = 1.0 + (composite_raw - median) / max(std, 1e-6) * 0.3

    # Clipping prudent — pas de β < 0.3 ni > 2.5 (cohérent avec littérature immo)
    out["beta"] = out["beta"].clip(lower=0.3, upper=2.5)

    print(f"  ✅ β médian : {out['beta'].median():.4f}")
    print(f"     β min/max : {out['beta'].min():.4f} / {out['beta'].max():.4f}")
    print(f"     β p25-p75 : {out['beta'].quantile(0.25):.4f} - {out['beta'].quantile(0.75):.4f}")
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Upsert Supabase
# ─────────────────────────────────────────────────────────────────────────────

def upsert_supabase(conn, df: pd.DataFrame) -> int:
    print(f"\n▶ Upsert {len(df):,} lignes dans fact_cluster_risk…")
    rows = [
        (
            r.zone_id,
            float(r.sigma_qoq_pct),
            float(r.lambda_illiquidite),
            float(r.rho_rarete),
            float(r.z_sigma_qoq_pct),
            float(r.z_lambda_illiquidite),
            float(r.z_rho_rarete),
            float(r.beta),
            int(r.n_obs_total),
            int(r.n_quarters),
            float(r.area_km2) if r.area_km2 is not None and not np.isnan(r.area_km2) else None,
        )
        for r in df.itertuples(index=False)
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO public.fact_cluster_risk (
              zone_id, sigma_qoq_pct, lambda_illiquidite, rho_rarete,
              z_sigma, z_lambda, z_rho, beta, n_obs_total, n_quarters, area_km2
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (zone_id) DO UPDATE SET
              sigma_qoq_pct = EXCLUDED.sigma_qoq_pct,
              lambda_illiquidite = EXCLUDED.lambda_illiquidite,
              rho_rarete = EXCLUDED.rho_rarete,
              z_sigma = EXCLUDED.z_sigma,
              z_lambda = EXCLUDED.z_lambda,
              z_rho = EXCLUDED.z_rho,
              beta = EXCLUDED.beta,
              n_obs_total = EXCLUDED.n_obs_total,
              n_quarters = EXCLUDED.n_quarters,
              area_km2 = EXCLUDED.area_km2,
              computed_at = now()
            """,
            rows,
        )
    conn.commit()
    return len(rows)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--weights",
        default="0.5,0.3,0.2",
        help="Pondérations σ,λ,ρ (défaut 0.5,0.3,0.2)",
    )
    parser.add_argument(
        "--since", default="2018-01-01", help="Date min DVF (défaut 2018-01-01)"
    )
    parser.add_argument(
        "--skip-upload", action="store_true", help="Calcul local uniquement"
    )
    args = parser.parse_args()

    weights = tuple(float(w) for w in args.weights.split(","))
    if len(weights) != 3 or abs(sum(weights) - 1.0) > 0.01:
        print("❌ --weights doit être 3 nombres sommant à 1 (ex: 0.5,0.3,0.2)")
        sys.exit(1)

    since = date.fromisoformat(args.since) if args.since else None

    print("─" * 70)
    print("  DATAMERRY — Calcul beta CAPM par cluster HDBSCAN")
    print("─" * 70)

    conn = get_connection()
    try:
        dvf = load_dvf_points(conn, since)
        zones = load_hdbscan_zones(conn)
        dvf_mapped = assign_clusters(dvf, zones)
        if dvf_mapped.empty:
            print("❌ Aucune transaction mappée à un cluster. Arrêt.")
            sys.exit(1)

        components = compute_sigma_lambda_rho(dvf_mapped, zones)
        beta_df = compute_beta_composite(components, weights=weights)

        # CSV audit
        csv_path = OUT_DIR / "cluster_risk_beta.csv"
        beta_df.to_csv(csv_path, index=False)
        print(f"\n💾 {csv_path}")

        if not args.skip_upload:
            n = upsert_supabase(conn, beta_df)
            print(f"  ✅ {n:,} lignes upsertées dans fact_cluster_risk")

        # Top 5 / bottom 5 pour validation
        print("\n📊 Top 5 clusters les plus RISQUÉS (β élevé) :")
        for r in beta_df.nlargest(5, "beta")[
            ["zone_id", "beta", "sigma_qoq_pct", "lambda_illiquidite", "n_obs_total"]
        ].itertuples(index=False):
            print(
                f"   {r.zone_id:30s} β={r.beta:.3f}  σ={r.sigma_qoq_pct:6.2f}%  "
                f"λ={r.lambda_illiquidite:.3f}  n_ventes={r.n_obs_total}"
            )

        print("\n📊 Top 5 clusters les plus DÉFENSIFS (β faible) :")
        for r in beta_df.nsmallest(5, "beta")[
            ["zone_id", "beta", "sigma_qoq_pct", "lambda_illiquidite", "n_obs_total"]
        ].itertuples(index=False):
            print(
                f"   {r.zone_id:30s} β={r.beta:.3f}  σ={r.sigma_qoq_pct:6.2f}%  "
                f"λ={r.lambda_illiquidite:.3f}  n_ventes={r.n_obs_total}"
            )

        print("\n✅ Terminé.\n")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
