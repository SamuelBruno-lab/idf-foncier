#!/usr/bin/env python3
"""
pipeline_hdbscan_idf.py — Pipeline HDBSCAN communes Île-de-France
==================================================================
Lit les fichiers DVF CSV (par département), applique HDBSCAN par commune
× type_local, calcule l'enveloppe convexe + stats, stocke dans Supabase.

Usage:
    python pipeline_hdbscan_idf.py                          # tous les depts présents
    python pipeline_hdbscan_idf.py --download               # télécharge depts manquants
    python pipeline_hdbscan_idf.py --dept 92 77 78          # filtrer depts
    python pipeline_hdbscan_idf.py --commune 92078          # une seule commune
    python pipeline_hdbscan_idf.py --skip-upload            # calcul local seulement

Dépendances:
    pip install pandas numpy hdbscan scipy httpx python-dotenv requests tqdm
"""

import argparse
import gzip
import hashlib
import io
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import hdbscan
from dotenv import load_dotenv
from scipy.spatial import ConvexHull

# ── Config ────────────────────────────────────────────────────────────────────

DATA_DIR = Path("/home/user")
ENV_FILE = Path("/home/user/idf-foncier/foncier-idf/.env.local")

IDF_DEPTS = ["75", "77", "78", "91", "92", "93", "94", "95"]

# Colonnes nécessaires depuis les CSV
COLS_KEEP = {
    "annee", "id_mutation", "id_parcelle", "date_mutation", "nature_mutation",
    "valeur_fonciere", "adresse_numero", "adresse_nom_voie",
    "code_commune", "nom_commune", "code_departement",
    "type_local", "surface_reelle_bati", "nombre_pieces_principales",
    "latitude", "longitude",
}

# Seuils prix/m² (filtre outliers)
PRIX_M2_MAX = {
    "Appartement": 20000,
    "Maison": 15000,
    "Local industriel. commercial ou assimilé": 15000,
}
PRIX_M2_MIN = 500  # plancher global

# URLs DVF géocodées par année/département (geo-dvf.etalab.gouv.fr)
DVF_URL = "https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/departements/{dept}.csv.gz"

# Fenêtre DVF dynamique : 6 années glissantes incluant l'année courante.
# DGFiP publie 2× par an (avril + octobre) → l'année courante peut être absente
# jusqu'à la release d'octobre ; download_dept ignore silencieusement les 404.
_CURRENT_YEAR = datetime.now().year
DVF_YEARS = list(range(_CURRENT_YEAR - 5, _CURRENT_YEAR + 1))


# ── Utilitaires ───────────────────────────────────────────────────────────────

def load_env():
    load_dotenv(ENV_FILE)
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    if not url or not key:
        raise RuntimeError(f"Variables Supabase manquantes dans {ENV_FILE}")
    # Defensive sanitization :
    # - strip() : GitHub Secrets ajoute parfois un \n final
    # - rstrip('/') : retirer le slash final (sinon URL devient https://x//rest/v1/...
    #   ce qui produit PostgREST PGRST125 "Invalid path specified in request URL")
    url = url.strip().rstrip("/")
    key = key.strip()
    print(f"  Supabase URL: {url}")
    return url, key


def download_dept(dept: str, dest: Path, years: list[int] = DVF_YEARS) -> bool:
    """
    Télécharge et fusionne les fichiers DVF annuels pour un département.
    Retourne True si le fichier a été créé/mis à jour.
    """
    frames = []
    for year in years:
        url = DVF_URL.format(year=year, dept=dept)
        print(f"  Téléchargement {url}...")
        try:
            resp = httpx.get(url, follow_redirects=True, timeout=120)
            resp.raise_for_status()
            with gzip.open(io.BytesIO(resp.content)) as f:
                df = pd.read_csv(f, low_memory=False)
                df["annee"] = year
                frames.append(df)
                print(f"    → {len(df):,} lignes")
        except Exception as e:
            print(f"    ⚠ Erreur {year}: {e}")

    if not frames:
        return False

    merged = pd.concat(frames, ignore_index=True)
    merged.to_csv(dest, index=False)
    print(f"  ✅ Sauvegardé: {dest} ({len(merged):,} lignes)")
    return True


def load_csv_dept(dept: str, csv_path: Path) -> pd.DataFrame:
    """Charge et nettoie un fichier CSV DVF départemental."""
    print(f"  Lecture {csv_path.name} ({csv_path.stat().st_size // 1_000_000} MB)...")

    df = pd.read_csv(csv_path, low_memory=False, usecols=lambda c: c in COLS_KEEP)

    # Nettoyage de base
    df = df.dropna(subset=["latitude", "longitude", "valeur_fonciere"])
    df = df[pd.to_numeric(df["valeur_fonciere"], errors="coerce") > 1]
    df = df.drop_duplicates(subset=["id_mutation", "id_parcelle"])

    # Exclusion VEFA Maisons (prix promoteur gonflé)
    if "nature_mutation" in df.columns:
        mask_vefa_maison = (
            (df.get("nature_mutation", "") == "Vente en l'état futur d'achèvement")
            & (df.get("type_local", "") == "Maison")
        )
        df = df[~mask_vefa_maison]

    # Types numériques
    df["valeur_fonciere"] = pd.to_numeric(df["valeur_fonciere"], errors="coerce")
    df["surface_reelle_bati"] = pd.to_numeric(df["surface_reelle_bati"], errors="coerce")
    df["latitude"] = pd.to_numeric(df["latitude"], errors="coerce")
    df["longitude"] = pd.to_numeric(df["longitude"], errors="coerce")

    # Correction DVF multi-lots : valeur_fonciere est la valeur totale de la mutation,
    # répétée sur chaque lot. On divise par le nombre de lots par id_mutation.
    # (cohérent avec 02_import_dvf.py)
    if "id_mutation" in df.columns:
        lots_par_mutation = df.groupby("id_mutation")["id_mutation"].transform("count")
        df["valeur_fonciere"] = (df["valeur_fonciere"] / lots_par_mutation).round()

    # Prix au m²
    df["prix_m2"] = np.where(
        df["surface_reelle_bati"] > 0,
        df["valeur_fonciere"] / df["surface_reelle_bati"],
        np.nan,
    )

    # Filtre outliers prix/m²
    df = df[df["prix_m2"].isna() | (df["prix_m2"] >= PRIX_M2_MIN)]
    for type_local, max_val in PRIX_M2_MAX.items():
        mask = (df["type_local"] == type_local) & (df["prix_m2"] > max_val)
        df = df[~mask]

    # Code département depuis code_commune si absent
    if "code_departement" not in df.columns or df["code_departement"].isna().all():
        df["code_departement"] = df["code_commune"].astype(str).str[:2]

    # Filtrer sur le département en cours uniquement (defensif si DVF mixe les codes).
    # Note: l'ancien code filtrait sur IDF_DEPTS hardcodé, ce qui empêchait
    # l'utilisation pour France entière (pipeline_hdbscan_dept.py).
    df = df[df["code_departement"].astype(str).str.zfill(2) == str(dept).zfill(2)]

    print(f"    → {len(df):,} transactions valides (dept {dept})")
    return df


# ── Fenêtre adaptative, holding period, volatilité ────────────────────────

def adaptive_window(
    df: pd.DataFrame,
    target_n: int = 50,
    max_lookback: int = 6,
    force_years: int | None = None,
) -> tuple[int, int, int] | None:
    """
    Choisit la fenêtre temporelle la plus récente contenant ≥target_n transactions.
    Floor : 1 an (cas Paris × Appartement où une seule année suffit).
    Plafond : `max_lookback` ans (au-delà, les prix anciens polluent la médiane).

    Si `force_years` est passé, on force cette fenêtre (utilisé pour le dataset
    "5 ans précis" qui veut des micro-marchés fins peu importe le volume).

    Returns (annee_min, annee_max, n_in_window) ou None si df est vide.
    """
    if "annee" not in df.columns or df.empty:
        return None
    annees = df["annee"].dropna()
    if annees.empty:
        return None
    annee_max = int(annees.max())

    if force_years is not None and force_years > 0:
        annee_min = annee_max - force_years + 1
        n = int((df["annee"] >= annee_min).sum())
        return annee_min, annee_max, n

    for window_size in range(1, max_lookback + 1):
        annee_min = annee_max - window_size + 1
        n = int((df["annee"] >= annee_min).sum())
        if n >= target_n:
            return annee_min, annee_max, n
    annee_min = annee_max - max_lookback + 1
    n = int((df["annee"] >= annee_min).sum())
    return annee_min, annee_max, n


def compute_holding_periods(df: pd.DataFrame) -> pd.DataFrame:
    """
    Pour chaque parcelle vendue ≥2 fois dans DVF, retourne les durées entre
    mutations successives (en mois). Utilise TOUT l'historique df, pas
    seulement la fenêtre adaptative — on veut le maximum de paires observables.

    Returns DataFrame[id_parcelle, duree_mois].
    """
    cols = {"id_parcelle", "date_mutation"}
    if not cols.issubset(df.columns):
        return pd.DataFrame(columns=["id_parcelle", "duree_mois"])

    sub = df[["id_parcelle", "date_mutation"]].dropna()
    sub = sub.drop_duplicates(subset=["id_parcelle", "date_mutation"])
    sub = sub.assign(date_mutation=pd.to_datetime(sub["date_mutation"], errors="coerce"))
    sub = sub.dropna(subset=["date_mutation"]).sort_values(["id_parcelle", "date_mutation"])
    sub["prev_date"] = sub.groupby("id_parcelle")["date_mutation"].shift(1)
    sub["duree_mois"] = ((sub["date_mutation"] - sub["prev_date"]).dt.days / 30.44).round()
    return sub.dropna(subset=["duree_mois"])[["id_parcelle", "duree_mois"]]


def compute_volatility(
    grp: pd.DataFrame,
) -> tuple[float | None, float | None, list[dict]]:
    """
    Sur le sous-ensemble d'un cluster, calcule :
      - prix_m2_yoy_pct : évolution % moyenne année sur année des médianes
      - prix_m2_volatility : coefficient de variation = stddev / mean
      - prix_m2_history : [{annee, median, n}] par année dans la fenêtre

    YoY et CV nécessitent ≥2 années, sinon None.
    """
    if "annee" not in grp.columns:
        return None, None, []
    yearly = (
        grp.dropna(subset=["prix_m2"])
        .groupby("annee")
        .agg(median_prix_m2=("prix_m2", "median"), n=("prix_m2", "count"))
        .reset_index()
        .sort_values("annee")
    )
    history = [
        {"annee": int(r.annee), "median": int(r.median_prix_m2), "n": int(r.n)}
        for r in yearly.itertuples()
    ]
    if len(yearly) < 2 or yearly["median_prix_m2"].mean() == 0:
        return None, None, history
    yoy = yearly["median_prix_m2"].pct_change().mean() * 100
    cv = yearly["median_prix_m2"].std() / yearly["median_prix_m2"].mean()
    return round(float(yoy), 2), round(float(cv), 3), history


# ── HDBSCAN par commune × type ─────────────────────────────────────────────

def compute_hull(pts: np.ndarray, alpha: float | None = None) -> list[list[float]] | None:
    """
    Enveloppe d'un cluster : alpha shape (concave hull) si possible,
    fallback convex hull. Auto-tune alpha si non spécifié.

    Returns list fermée [[lat, lon], ...] ou None si <3 points.
    """
    if len(pts) < 3:
        return None

    # Tentative alpha shape (défensif : si lib manque ou erreur, on retombe sur convex)
    try:
        import alphashape  # noqa: PLC0415
        from shapely.geometry import MultiPolygon, Polygon  # noqa: PLC0415

        coords = [(float(p[0]), float(p[1])) for p in pts]
        alphas = [alpha] if alpha is not None else [5000.0, 2500.0, 1500.0, 800.0, 400.0, 200.0]

        for a in alphas:
            try:
                shape = alphashape.alphashape(coords, a)
            except Exception:
                continue
            if shape is None or getattr(shape, "is_empty", True):
                continue
            poly = None
            if isinstance(shape, Polygon):
                poly = shape
            elif isinstance(shape, MultiPolygon):
                poly = max(shape.geoms, key=lambda g: g.area)
            if poly is not None and not poly.is_empty:
                hull_pts = [[float(x), float(y)] for x, y in poly.exterior.coords]
                if len(hull_pts) >= 4:
                    return hull_pts
    except ImportError:
        pass  # alphashape/shapely pas installé → fallback silencieux convex
    except Exception as e:
        print(f"    ⚠ alpha shape inattendu : {type(e).__name__} {e}")

    # Fallback convex hull
    try:
        hull = ConvexHull(pts)
        hull_pts = pts[hull.vertices].tolist()
        hull_pts.append(hull_pts[0])
        return hull_pts
    except Exception:
        return None


def hdbscan_params(n: int, type_local: str = "") -> dict | None:
    """
    Paramètres adaptatifs par type de bien.

    MAISONS — cluster_selection_method="leaf"
      Préserve les micro-zones géographiquement proches à prix distincts
      (ex: quartiers pavillonnaires mitoyens à 150m d'écart).
      min_cluster_size petit car le stock de maisons est rare.

    APPARTEMENTS / COMMERCES — cluster_selection_method="eom"
      min_cluster_size = max(type_min, round(n * 0.08))
      Règle empirique : ~8% des transactions par zone → nombre de zones
      proportionnel à la densité du marché.
      Exemple: 386 apparts → mcs=30 → 6 zones (Bongarde, Sorbiers, Ponant…)
               45 commerces → mcs=5  → 4 zones (ZI Nord, 8-Mai-45…)
    """
    if n < 12:
        return None

    is_maison = type_local == "Maison"

    if is_maison:
        # Maisons : leaf, min_cluster_size fixe selon volume
        if n < 40:
            mcs = 4
        elif n < 150:
            mcs = 6
        else:
            mcs = 8
        return {
            "min_cluster_size": mcs,
            "min_samples": 2,
            "cluster_selection_method": "leaf",
        }
    else:
        # Appartements & Commerces : eom, mcs proportionnel (≈8%)
        type_min = 5 if "Local" in type_local else 8
        mcs = max(type_min, round(n * 0.08))
        ms = 3 if n > 100 else 2
        return {
            "min_cluster_size": mcs,
            "min_samples": ms,
            "cluster_selection_method": "eom",
        }


def process_commune_type(
    code_commune: str,
    nom_commune: str,
    dept: str,
    type_local: str,
    sub: pd.DataFrame,
    window_annee_min: int | None = None,
    window_annee_max: int | None = None,
    holdings_lookup: dict[str, list[float]] | None = None,
) -> list[dict]:
    """
    Applique HDBSCAN sur un sous-ensemble commune × type_local (déjà filtré
    par la fenêtre adaptative en amont).

    `holdings_lookup` : dict {id_parcelle: [duree_mois, ...]} pré-calculé sur
    TOUT l'historique DVF (pas seulement la fenêtre). Permet d'agréger la
    durée de détention médiane par cluster.

    Retourne la liste des zones (clusters) à insérer dans dvf_hdbscan_zones.
    """
    params = hdbscan_params(len(sub), type_local)
    if params is None:
        return []

    coords = np.radians(sub[["latitude", "longitude"]].values)

    try:
        clusterer = hdbscan.HDBSCAN(
            metric="haversine",
            **params,
        )
        labels = clusterer.fit_predict(coords)
    except Exception as e:
        print(f"    HDBSCAN erreur {code_commune}/{type_local}: {e}")
        return []

    sub = sub.copy()
    sub["cluster"] = labels

    zones = []
    for cid in sorted(set(labels)):
        if cid < 0:  # bruit
            continue

        grp = sub[sub["cluster"] == cid]
        pts = grp[["latitude", "longitude"]].values

        # Enveloppe : alpha shape (concave hull) si possible — pas de
        # chevauchement avec les autres clusters HDBSCAN car ceux-ci sont
        # spatialement disjoints par construction (algo density-based).
        # Fallback convex hull si alphashape échoue.
        hull_coords = compute_hull(pts)  # alpha auto-tune (cf. compute_hull docstring)

        prix_m2_vals = grp["prix_m2"].dropna().values
        centroid = pts.mean(axis=0)

        # Holding period : agrège les durées des parcelles présentes dans ce cluster.
        # On utilise toutes les paires de mutations observées sur ces parcelles,
        # même celles hors fenêtre (la durée de détention reflète l'histoire complète).
        duree_median_mois = None
        n_reventes = 0
        if holdings_lookup:
            cluster_parcelles = grp["id_parcelle"].dropna().unique() if "id_parcelle" in grp.columns else []
            durees: list[float] = []
            for p in cluster_parcelles:
                durees.extend(holdings_lookup.get(p, []))
            if durees:
                duree_median_mois = int(np.median(durees))
                n_reventes = len(durees)

        # Volatilité et historique annuel
        yoy_pct, volatility, history = compute_volatility(grp)

        # Nettoyage du nom de type pour ID
        type_slug = (
            type_local.replace(" ", "_").replace(".", "").replace(",", "")[:30]
        )
        zone_id = f"{code_commune}_{type_slug}_{cid}"

        zones.append({
            "id": zone_id,
            "code_commune": code_commune,
            "nom_commune": nom_commune,
            "dept": dept,
            "type_local": type_local,
            "cluster_id": int(cid),
            "count": int(len(grp)),
            "prix_m2_median": int(np.median(prix_m2_vals)) if len(prix_m2_vals) > 0 else None,
            "prix_m2_p10": int(np.percentile(prix_m2_vals, 10)) if len(prix_m2_vals) > 0 else None,
            "prix_m2_p25": int(np.percentile(prix_m2_vals, 25)) if len(prix_m2_vals) > 0 else None,
            "prix_m2_p75": int(np.percentile(prix_m2_vals, 75)) if len(prix_m2_vals) > 0 else None,
            "prix_m2_p90": int(np.percentile(prix_m2_vals, 90)) if len(prix_m2_vals) > 0 else None,
            "prix_median": int(grp["valeur_fonciere"].median()) if grp["valeur_fonciere"].notna().any() else None,
            "hull_coords": hull_coords,
            "centroid_lat": float(centroid[0]),
            "centroid_lon": float(centroid[1]),
            # Plage descriptive (years réellement présentes)
            "annee_min": int(grp["annee"].min()) if "annee" in grp.columns else None,
            "annee_max": int(grp["annee"].max()) if "annee" in grp.columns else None,
            # Fenêtre adaptative choisie (avant HDBSCAN)
            "window_annee_min": window_annee_min,
            "window_annee_max": window_annee_max,
            # Durée de détention
            "duree_detention_median_mois": duree_median_mois,
            "n_reventes_observees": n_reventes,
            # Volatilité
            "prix_m2_yoy_pct": yoy_pct,
            "prix_m2_volatility": volatility,
            "prix_m2_history": history,
        })

    return zones


def run_hdbscan_all(
    df: pd.DataFrame,
    commune_filter: str | None = None,
    target_n_window: int = 50,
    max_lookback_years: int = 6,
    force_window_years: int | None = None,
) -> list[dict]:
    """
    Applique HDBSCAN pour toutes les communes × types dans le DataFrame, avec
    fenêtre temporelle adaptative par (commune × type) et durée de détention.

    Étapes :
      1. Pré-calcul des durées de détention sur tout l'historique DVF
      2. Pour chaque (commune × type) : fenêtre adaptative → filtre → HDBSCAN
      3. Log de la fenêtre choisie par (commune × type)
    """
    all_zones = []
    types_cibles = [
        "Appartement",
        "Maison",
        "Local industriel. commercial ou assimilé",
    ]

    # ── Pré-calcul des durées de détention (tout l'historique DVF) ────────
    print("\n  Calcul des durées de détention (toutes parcelles ≥2 mutations)...")
    holdings_df = compute_holding_periods(df)
    holdings_lookup: dict[str, list[float]] = {}
    for row in holdings_df.itertuples():
        holdings_lookup.setdefault(row.id_parcelle, []).append(float(row.duree_mois))
    print(f"    → {len(holdings_lookup):,} parcelles avec historique de revente ({len(holdings_df):,} paires)")

    communes = df["code_commune"].dropna().unique()
    if commune_filter:
        communes = [c for c in communes if c == commune_filter]

    total = len(communes)
    print(f"\n  {total} communes à traiter...")

    for i, code_commune in enumerate(sorted(communes), 1):
        comm_df = df[df["code_commune"] == code_commune]
        nom_commune = comm_df["nom_commune"].iloc[0] if "nom_commune" in comm_df.columns else code_commune
        dept = str(comm_df["code_departement"].iloc[0]) if "code_departement" in comm_df.columns else code_commune[:2]

        commune_zones = []
        for type_local in types_cibles:
            sub = comm_df[comm_df["type_local"] == type_local].copy()
            if len(sub) < 5:
                continue

            # Fenêtre adaptative (ou forcée si force_window_years).
            window = adaptive_window(
                sub,
                target_n=target_n_window,
                max_lookback=max_lookback_years,
                force_years=force_window_years,
            )
            if window is None:
                continue
            window_min, window_max, n_in_window = window
            sub_windowed = sub[sub["annee"] >= window_min].copy()

            # Log de la fenêtre choisie pour cette (commune × type)
            window_size = window_max - window_min + 1
            print(
                f"    {code_commune} {nom_commune[:25]:<25} × {type_local[:15]:<15} "
                f"→ [{window_min}-{window_max}] ({window_size}an, n={n_in_window})"
            )

            zones = process_commune_type(
                code_commune, nom_commune, dept, type_local, sub_windowed,
                window_annee_min=window_min,
                window_annee_max=window_max,
                holdings_lookup=holdings_lookup,
            )
            commune_zones.extend(zones)

        all_zones.extend(commune_zones)

        if i % 50 == 0 or i == total:
            n_zones = len(all_zones)
            print(f"  [{i}/{total}] {code_commune} — {len(commune_zones)} zones | total: {n_zones}")

    return all_zones


# ── Upload Supabase ──────────────────────────────────────────────────────────

def upsert_zones(
    zones: list[dict],
    supabase_url: str,
    supabase_key: str,
    batch_size: int = 200,
    table_name: str = "dvf_hdbscan_zones",
):
    """Upsert les zones HDBSCAN dans Supabase par lots.

    PRINCIPE : on commence par DELETE les anciennes lignes pour les communes
    qu'on s'apprête à uploader. Sinon, comme les cluster_id HDBSCAN ne sont
    pas stables d'un run à l'autre (1 cluster = 1 id auto-incrémenté qui
    change selon ordre des points), on accumulerait des lignes orphelines
    de runs précédents → l'API renvoie 2× plus de zones, qui se chevauchent.
    """
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    url = f"{supabase_url}/rest/v1/{table_name}?on_conflict=id"
    total = len(zones)

    # ── DELETE des anciennes zones pour les communes qu'on update ───────
    # Cluster IDs HDBSCAN ne sont pas stables d'un run à l'autre → upsert sur
    # id génère des lignes orphelines. On nettoie d'abord, puis insert frais.
    # CAST str() obligatoire : code_commune peut être numpy.int64 (hors IDF).
    # Chunking par 200 : URL PostgREST limitée à ~8 KB.
    communes_to_clean = sorted(set(str(z["code_commune"]) for z in zones))
    if communes_to_clean:
        print(f"  DELETE des anciennes zones pour {len(communes_to_clean)} commune(s)...")
        del_headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
            "Prefer": "return=minimal",
        }
        chunk = 200
        deleted_total = 0
        with httpx.Client(timeout=90) as client:
            for i in range(0, len(communes_to_clean), chunk):
                sub = communes_to_clean[i : i + chunk]
                in_list = ",".join(sub)
                del_url = f"{supabase_url}/rest/v1/{table_name}?code_commune=in.({in_list})"
                try:
                    r = client.delete(del_url, headers=del_headers)
                    if r.status_code in (200, 204):
                        deleted_total += len(sub)
                    else:
                        print(f"    ⚠ DELETE chunk {i//chunk + 1} HTTP {r.status_code}: {r.text[:150]}")
                except Exception as e:
                    print(f"    ⚠ DELETE chunk {i//chunk + 1} exception: {e}")
        print(f"    {deleted_total}/{len(communes_to_clean)} communes nettoyées")

    def clean(v):
        if v is None:
            return None
        if hasattr(v, "item"):
            v = v.item()
        if isinstance(v, float) and (v != v or abs(v) == float("inf")):
            return None
        return v

    print(f"\n  Upload {total} zones → Supabase...")

    with httpx.Client(timeout=90) as client:
        for i in range(0, total, batch_size):
            batch = zones[i : i + batch_size]
            batch_clean = [{k: clean(val) for k, val in row.items()} for row in batch]
            # hull_coords est déjà une liste Python, pas besoin de sérialisation
            resp = client.post(url, headers=headers, json=batch_clean)
            if resp.status_code not in (200, 201):
                print(f"\n  ERREUR {resp.status_code}: {resp.text[:400]}")
                return False
            print(f"  {min(i + batch_size, total)}/{total} zones uploadées", end="\r")
            time.sleep(0.05)  # éviter rate limiting

    print(f"\n  ✅ {total} zones uploadées")
    return True


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Pipeline HDBSCAN communes IDF")
    parser.add_argument("--dept", nargs="+", default=IDF_DEPTS, help="Départements à traiter")
    parser.add_argument("--commune", help="Traiter une seule commune (code INSEE)")
    parser.add_argument("--download", action="store_true", help="Télécharger depts manquants")
    parser.add_argument("--skip-upload", action="store_true", help="Calcul sans upload Supabase")
    parser.add_argument("--csv-dir", default=str(DATA_DIR), help="Dossier des fichiers CSV")
    args = parser.parse_args()

    csv_dir = Path(args.csv_dir)

    print("=" * 60)
    print("Pipeline HDBSCAN — Communes Île-de-France")
    print("=" * 60)

    # ── 1. Téléchargement depts manquants ─────────────────────────────────────
    if args.download:
        print("\n[1] Téléchargement des depts manquants...")
        for dept in args.dept:
            dest = csv_dir / f"dvf_{dept}.csv"
            if dest.exists():
                print(f"  dept {dept}: déjà présent ({dest.stat().st_size // 1_000_000} MB), skip")
                continue
            print(f"  dept {dept}: téléchargement en cours...")
            download_dept(dept, dest)
    else:
        print("\n[1] (Téléchargement ignoré — utiliser --download si nécessaire)")

    # ── 2. Chargement CSV ─────────────────────────────────────────────────────
    print("\n[2] Chargement des fichiers CSV...")
    all_frames = []
    loaded_depts = []

    for dept in args.dept:
        csv_path = csv_dir / f"dvf_{dept}.csv"
        if not csv_path.exists():
            print(f"  dept {dept}: fichier manquant ({csv_path}), skip")
            print(f"    → Relancer avec --download pour télécharger")
            continue
        try:
            df = load_csv_dept(dept, csv_path)
            all_frames.append(df)
            loaded_depts.append(dept)
        except Exception as e:
            print(f"  dept {dept}: erreur de lecture — {e}")

    if not all_frames:
        print("Aucune donnée chargée. Vérifier les fichiers CSV.")
        sys.exit(1)

    data = pd.concat(all_frames, ignore_index=True)
    print(f"\n  Total: {len(data):,} transactions | {len(loaded_depts)} depts: {', '.join(loaded_depts)}")
    print(f"  Communes: {data['code_commune'].nunique():,}")
    print(f"  Types: {data['type_local'].value_counts().to_dict()}")

    # ── 3. HDBSCAN ────────────────────────────────────────────────────────────
    print("\n[3] Calcul HDBSCAN par commune × type...")
    t0 = time.time()
    all_zones = run_hdbscan_all(data, commune_filter=args.commune)
    elapsed = time.time() - t0
    print(f"\n  {len(all_zones)} zones calculées en {elapsed:.0f}s")

    if not all_zones:
        print("Aucune zone produite.")
        sys.exit(0)

    # Stats résumé
    types_count = {}
    for z in all_zones:
        t = z["type_local"]
        types_count[t] = types_count.get(t, 0) + 1
    for t, n in sorted(types_count.items(), key=lambda x: -x[1]):
        print(f"  {t[:40]:<40} {n:>5} zones")

    # ── 4. Upload Supabase ────────────────────────────────────────────────────
    if args.skip_upload:
        print("\n[4] Upload ignoré (--skip-upload)")
        # Sauvegarde locale pour inspection
        out = csv_dir / "hdbscan_zones_idf.json"
        def np_clean(obj):
            if hasattr(obj, "item"):
                return obj.item()
            raise TypeError
        with open(out, "w") as f:
            json.dump(all_zones, f, ensure_ascii=False, indent=2, default=np_clean)
        print(f"  Zones sauvegardées localement: {out}")
        return

    print("\n[4] Upload vers Supabase...")
    try:
        supabase_url, supabase_key = load_env()
    except RuntimeError as e:
        print(f"  ERREUR: {e}")
        sys.exit(1)

    success = upsert_zones(all_zones, supabase_url, supabase_key)

    if success:
        print(f"\n✅ Pipeline terminé — {len(all_zones)} zones HDBSCAN dans Supabase")
        print(f"   Communes traitées: {len(set(z['code_commune'] for z in all_zones))}")
        print(f"   Depts: {', '.join(sorted(set(z['dept'] for z in all_zones)))}")
    else:
        print("\n❌ Erreur lors de l'upload")
        sys.exit(1)


if __name__ == "__main__":
    main()
