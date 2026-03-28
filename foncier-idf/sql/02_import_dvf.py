"""
datamerry — Import CSV DVF → Supabase
Usage:
  python sql/02_import_dvf.py --dept 75 93 94 95 77 92
  python sql/02_import_dvf.py --download --dept 95        # télécharge toutes les années puis importe

Prérequis:
  pip install pandas python-dotenv httpx
  Fichiers CSV: dvf_75.csv, dvf_93.csv, etc. dans /home/user/
"""

import argparse
import os
import hashlib
import json
import gzip
import io
import pandas as pd
import numpy as np
import httpx
from dotenv import load_dotenv

load_dotenv(".env.local")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]

DEPT_COORDS = {
    "75": (48.8566, 2.3522, "Île-de-France"),
    "77": (48.6, 2.8, "Île-de-France"),
    "78": (48.8, 1.97, "Île-de-France"),
    "91": (48.6, 2.25, "Île-de-France"),
    "92": (48.85, 2.25, "Île-de-France"),
    "93": (48.91, 2.47, "Île-de-France"),
    "94": (48.79, 2.47, "Île-de-France"),
    "95": (49.0, 2.1, "Île-de-France"),
    "60": (49.41, 2.83, "Hauts-de-France"),
    "44": (47.22, -1.55, "Pays de la Loire"),
}

COLS_KEEP = [
    "id_mutation", "id_parcelle", "date_mutation", "valeur_fonciere",
    "adresse_numero", "adresse_nom_voie", "code_commune", "nom_commune",
    "code_departement", "latitude", "longitude",
    "type_local", "surface_reelle_bati", "nombre_pieces_principales",
]

# Seuils outliers prix/m² par département (cohérent avec route.ts)
PRIX_M2_MAX_BY_DEPT = {
    "75": {"Appartement": 20_000, "Maison": 18_000, "Local industriel. commercial ou assimilé": 15_000},
    "92": {"Appartement": 15_000, "Maison": 12_000, "Local industriel. commercial ou assimilé": 12_000},
    "93": {"Appartement": 10_000, "Maison": 8_000, "Local industriel. commercial ou assimilé": 10_000},
    "94": {"Appartement": 12_000, "Maison": 10_000, "Local industriel. commercial ou assimilé": 10_000},
}
PRIX_M2_MAX_DEFAULT = {"Appartement": 10_000, "Maison": 8_000, "Local industriel. commercial ou assimilé": 10_000}
PRIX_M2_MIN = 500
SURFACE_MIN = 9  # m² — minimum légal d'habitation en France

DOWNLOAD_YEARS = [2020, 2021, 2022, 2023, 2024, 2025]


def make_id(row):
    key = f"{row.get('id_mutation','')}-{row.get('id_parcelle','')}-{row.get('latitude','')}-{row.get('longitude','')}"
    return hashlib.md5(key.encode()).hexdigest()[:20]


def load_dept(dept: str, csv_path: str) -> list:
    print(f"  Lecture {csv_path}...")
    df = pd.read_csv(csv_path, low_memory=False, usecols=lambda c: c in COLS_KEEP)
    df = df.dropna(subset=["latitude", "longitude", "valeur_fonciere"])
    df = df[df["valeur_fonciere"] > 0]
    df = df.drop_duplicates(subset=["id_mutation", "id_parcelle"])

    df["valeur_fonciere"] = pd.to_numeric(df["valeur_fonciere"], errors="coerce").round().astype("Int64")
    df["surface_reelle_bati"] = pd.to_numeric(df["surface_reelle_bati"], errors="coerce").round().astype("Int64")
    df["date_mutation"] = pd.to_datetime(df["date_mutation"], errors="coerce")
    df["annee"] = df["date_mutation"].dt.year.astype("Int64")

    # Correction DVF multi-lots : valeur_fonciere est la valeur totale de la mutation,
    # répétée sur chaque lot. On divise par le nombre de lots par id_mutation.
    lots_par_mutation = df.groupby("id_mutation")["id_mutation"].transform("count")
    df["valeur_fonciere"] = (df["valeur_fonciere"].astype(float) / lots_par_mutation).round().astype("Int64")

    surf = df["surface_reelle_bati"].fillna(0).astype(float)
    df["prix_m2"] = np.where(
        surf > 0,
        (df["valeur_fonciere"].astype(float) / surf).round(),
        np.nan,
    )
    df["prix_m2"] = pd.to_numeric(df["prix_m2"], errors="coerce").round().astype("Int64")

    # Filtre surface minimum (9m² = minimum légal habitation France)
    valid_surface = df["surface_reelle_bati"].isna() | (df["surface_reelle_bati"] >= SURFACE_MIN)
    df = df[valid_surface]

    # Filtre outliers prix/m² — seuils par département
    dept_thresholds = PRIX_M2_MAX_BY_DEPT.get(dept, PRIX_M2_MAX_DEFAULT)
    df = df[df["prix_m2"].isna() | (df["prix_m2"] >= PRIX_M2_MIN)]
    for type_local, max_val in dept_thresholds.items():
        mask = (df["type_local"] == type_local) & (df["prix_m2"] > max_val)
        df = df[~mask]

    df["adresse"] = (
        df["adresse_numero"].fillna("").astype(str).str.strip()
        + " "
        + df["adresse_nom_voie"].fillna("").astype(str).str.strip()
    ).str.strip()
    df["adresse"] = df["adresse"].replace("", None)

    dept_lat, dept_lon, region = DEPT_COORDS.get(dept, (None, None, None))

    records = []
    for _, row in df.iterrows():
        records.append({
            "id": make_id(row),
            "lat": float(row["latitude"]),
            "lon": float(row["longitude"]),
            "valeur_fonciere": int(row["valeur_fonciere"]) if pd.notna(row["valeur_fonciere"]) else None,
            "prix_m2": int(row["prix_m2"]) if pd.notna(row.get("prix_m2")) else None,
            "surface": int(row["surface_reelle_bati"]) if pd.notna(row.get("surface_reelle_bati")) else None,
            "type_local": str(row["type_local"]) if pd.notna(row.get("type_local")) else None,
            "date_mutation": row["date_mutation"].strftime("%Y-%m-%d") if pd.notna(row["date_mutation"]) else None,
            "adresse": row.get("adresse"),
            "commune": str(row["nom_commune"]) if pd.notna(row.get("nom_commune")) else None,
            "code_commune": str(row["code_commune"]) if pd.notna(row.get("code_commune")) else None,
            "dept": dept,
            "region": region,
            "annee": int(row["annee"]) if pd.notna(row["annee"]) else None,
        })

    return records


def compute_clusters(records: list) -> tuple:
    """Calcule les agrégats commune / dept / region."""
    df = pd.DataFrame(records)
    communes, depts, regions = [], [], []

    for (code_commune, type_local), g in df.groupby(["code_commune", "type_local"], dropna=False):
        # Filtrer les prix/m² aberrants (ex: surface déclarée 1m² → prix/m² fantaisiste)
        prix_m2_vals = g["prix_m2"].dropna()
        if len(prix_m2_vals) >= 4:
            q1, q3 = prix_m2_vals.quantile(0.25), prix_m2_vals.quantile(0.75)
            iqr = q3 - q1
            mask = (g["prix_m2"] >= max(200, q1 - 1.5 * iqr)) & (g["prix_m2"] <= q3 + 1.5 * iqr)
            g_clean = g[mask | g["prix_m2"].isna()]
        else:
            # < 4 transactions : filtre fixe large (200–30 000 €/m²)
            g_clean = g[(g["prix_m2"].isna()) | ((g["prix_m2"] >= 200) & (g["prix_m2"] <= 30000))]
        communes.append({
            "cluster_id": f"{code_commune}_{type_local}",
            "nom": g["commune"].iloc[0] if "commune" in g else None,
            "lat": g["lat"].median(),
            "lon": g["lon"].median(),
            "dept": g["dept"].iloc[0],
            "type_local": type_local if pd.notna(type_local) else None,
            "count": len(g_clean),
            "prix_median": int(g_clean["valeur_fonciere"].median()) if g_clean["valeur_fonciere"].notna().any() else None,
            "prix_m2_median": int(g_clean["prix_m2"].median()) if g_clean["prix_m2"].notna().any() else None,
        })

    for (dept, type_local), g in df.groupby(["dept", "type_local"], dropna=False):
        prix_m2_vals = g["prix_m2"].dropna()
        if len(prix_m2_vals) >= 4:
            q1, q3 = prix_m2_vals.quantile(0.25), prix_m2_vals.quantile(0.75)
            iqr = q3 - q1
            mask = (g["prix_m2"] >= max(200, q1 - 1.5 * iqr)) & (g["prix_m2"] <= q3 + 1.5 * iqr)
            g_clean = g[mask | g["prix_m2"].isna()]
        else:
            g_clean = g[(g["prix_m2"].isna()) | ((g["prix_m2"] >= 200) & (g["prix_m2"] <= 30000))]
        depts.append({
            "cluster_id": f"{dept}_{type_local}",
            "nom": f"Dept {dept}",
            "lat": g["lat"].median(),
            "lon": g["lon"].median(),
            "dept": dept,
            "type_local": type_local if pd.notna(type_local) else None,
            "count": len(g_clean),
            "prix_median": int(g_clean["valeur_fonciere"].median()) if g_clean["valeur_fonciere"].notna().any() else None,
            "prix_m2_median": int(g_clean["prix_m2"].median()) if g_clean["prix_m2"].notna().any() else None,
        })

    for (region, type_local), g in df.groupby(["region", "type_local"], dropna=False):
        prix_m2_vals = g["prix_m2"].dropna()
        if len(prix_m2_vals) >= 4:
            q1, q3 = prix_m2_vals.quantile(0.25), prix_m2_vals.quantile(0.75)
            iqr = q3 - q1
            mask = (g["prix_m2"] >= max(200, q1 - 1.5 * iqr)) & (g["prix_m2"] <= q3 + 1.5 * iqr)
            g_clean = g[mask | g["prix_m2"].isna()]
        else:
            g_clean = g[(g["prix_m2"].isna()) | ((g["prix_m2"] >= 200) & (g["prix_m2"] <= 30000))]
        regions.append({
            "cluster_id": f"{region}_{type_local}",
            "nom": region,
            "lat": g["lat"].median(),
            "lon": g["lon"].median(),
            "dept": None,
            "type_local": type_local if pd.notna(type_local) else None,
            "count": len(g_clean),
            "prix_median": int(g_clean["valeur_fonciere"].median()) if g_clean["valeur_fonciere"].notna().any() else None,
            "prix_m2_median": int(g_clean["prix_m2"].median()) if g_clean["prix_m2"].notna().any() else None,
        })

    return communes, depts, regions


def upsert_batch(table: str, records: list, on_conflict: str, batch_size=500):
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": f"resolution=merge-duplicates,return=minimal",
    }
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={on_conflict}"
    total = len(records)

    with httpx.Client(timeout=60, verify=False) as client:
        for i in range(0, total, batch_size):
            batch = records[i:i + batch_size]
            # Convertir les types numpy/pandas en Python natif, NaN → None
            def clean(v):
                if v is None:
                    return None
                if hasattr(v, 'item'):  # numpy scalar
                    v = v.item()
                if isinstance(v, float) and (v != v or v == float('inf') or v == float('-inf')):
                    return None
                return v
            batch_clean = [{k: clean(val) for k, val in row.items()} for row in batch]
            resp = client.post(url, headers=headers, json=batch_clean)
            if resp.status_code not in (200, 201):
                print(f"\n  ERREUR {resp.status_code}: {resp.text[:300]}")
                return
            print(f"  {table}: {min(i + batch_size, total)}/{total}", end="\r")
    print()


def download_dvf(dept: str, csv_dir: str) -> str:
    """Télécharge toutes les années DVF depuis data.gouv.fr et fusionne en un seul CSV."""
    out_path = os.path.join(csv_dir, f"dvf_{dept}.csv")
    frames = []
    for year in DOWNLOAD_YEARS:
        url = f"https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/departements/{dept}.csv.gz"
        print(f"  Téléchargement {dept}/{year}...", end=" ", flush=True)
        try:
            with httpx.Client(timeout=60, verify=False) as client:
                r = client.get(url)
            if r.status_code == 200:
                content = gzip.decompress(r.content)
                df = pd.read_csv(io.BytesIO(content), low_memory=False)
                frames.append(df)
                print(f"✓ {len(df):,} lignes")
            else:
                print(f"✗ HTTP {r.status_code}")
        except Exception as e:
            print(f"✗ {e}")

    if frames:
        merged = pd.concat(frames, ignore_index=True)
        merged.to_csv(out_path, index=False)
        print(f"  → {out_path} ({len(merged):,} lignes, {len(frames)} années)")
    else:
        print(f"  ⚠ Aucune donnée téléchargée pour le département {dept}")

    return out_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dept", nargs="+", default=["60", "75", "77", "78", "91", "92", "93", "94", "95"], help="Départements à importer")
    parser.add_argument("--csv-dir", default="/home/user", help="Dossier des CSV DVF")
    parser.add_argument("--download", action="store_true", help="Télécharger les DVF depuis data.gouv.fr avant import")
    args = parser.parse_args()

    if args.download:
        print("📥 Téléchargement des DVF depuis data.gouv.fr...")
        for dept in args.dept:
            download_dvf(dept, args.csv_dir)
        print()

    all_records = []
    for dept in args.dept:
        csv_path = os.path.join(args.csv_dir, f"dvf_{dept}.csv")
        if not os.path.exists(csv_path):
            print(f"  Fichier manquant: {csv_path} — skipped")
            continue
        records = load_dept(dept, csv_path)
        print(f"  Dept {dept}: {len(records):,} transactions")
        all_records.extend(records)

    if not all_records:
        print("Aucune donnée à importer.")
        return

    print(f"\nTotal: {len(all_records):,} transactions → Supabase...")
    upsert_batch("dvf_points", all_records, on_conflict="id")

    print("\nCalcul des clusters...")
    communes, depts, regions = compute_clusters(all_records)
    print(f"  {len(communes)} clusters commune, {len(depts)} clusters dept, {len(regions)} clusters region")

    upsert_batch("dvf_clusters_commune", communes, on_conflict="cluster_id", batch_size=1000)
    upsert_batch("dvf_clusters_dept", depts, on_conflict="cluster_id", batch_size=1000)
    upsert_batch("dvf_clusters_region", regions, on_conflict="cluster_id", batch_size=1000)

    print("\n✅ Import terminé!")


if __name__ == "__main__":
    main()
