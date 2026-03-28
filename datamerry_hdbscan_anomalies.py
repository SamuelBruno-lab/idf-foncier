#!/usr/bin/env python3
"""
DATAMERRY -- Detecteur d'anomalies de prix inter-zones HDBSCAN
================================================================
Script cle-en-main : telecharge les DVF publiques, clusterise par HDBSCAN,
et detecte les plus gros ecarts de prix entre micro-marches au sein d'une
meme commune.

Usage:
    python datamerry_hdbscan_anomalies.py
    python datamerry_hdbscan_anomalies.py --dept 92 93 94
    python datamerry_hdbscan_anomalies.py --skip-maps
    python datamerry_hdbscan_anomalies.py --output-dir mon_dossier

Output:
    - anomalies_idf_oise.csv : resultats tries par ecart de prix
    - post_linkedin.txt : post LinkedIn pre-redige avec les vrais chiffres
    - Pour chaque commune TOP 5 : carte HTML Folium (sauf --skip-maps)

Dependances:
    pip install -r requirements.txt

Auteur: Samuel Bruno -- Datamerry
Date: Mars 2026
"""

import argparse
import gzip
import io
import warnings
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
import hdbscan

warnings.filterwarnings("ignore")

try:
    import folium
    import branca.colormap as cm
    from scipy.spatial import ConvexHull
    HAS_FOLIUM = True
except ImportError:
    HAS_FOLIUM = False

# -- Configuration ------------------------------------------------------------

IDF_DEPTS = ["75", "77", "78", "91", "92", "93", "94", "95"]
OISE_DEPT = ["60"]
ALL_DEPTS = IDF_DEPTS + OISE_DEPT

DVF_URL = "https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/departements/{dept}.csv.gz"
DVF_YEARS = [2020, 2021, 2022, 2023, 2024]

COLS_KEEP = {
    "annee", "id_mutation", "id_parcelle", "date_mutation", "nature_mutation",
    "valeur_fonciere", "adresse_numero", "adresse_nom_voie",
    "code_commune", "nom_commune", "code_departement",
    "type_local", "surface_reelle_bati", "nombre_pieces_principales",
    "latitude", "longitude",
}

PRIX_M2_MAX = {
    "Appartement": 20000,
    "Maison": 15000,
}
PRIX_M2_MIN = 500

TYPES_BIENS = ["Appartement", "Maison"]

MIN_TX_COMMUNE = 30


# -- HDBSCAN adaptatif (repris de pipeline_hdbscan_idf.py) --------------------

def hdbscan_params(n, type_local=""):
    """Parametres adaptatifs selon le type de bien et le volume de transactions."""
    if n < 12:
        return None

    is_maison = type_local == "Maison"

    if is_maison:
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
        type_min = 8
        mcs = max(type_min, round(n * 0.08))
        ms = 3 if n > 100 else 2
        return {
            "min_cluster_size": mcs,
            "min_samples": ms,
            "cluster_selection_method": "eom",
        }


# -- 1. Telechargement DVF ----------------------------------------------------

def download_dvf(dept, year):
    """Telecharge les DVF depuis data.gouv.fr (open data)."""
    url = DVF_URL.format(year=year, dept=dept)
    try:
        resp = httpx.get(url, follow_redirects=True, timeout=120)
        resp.raise_for_status()
        with gzip.open(io.BytesIO(resp.content)) as f:
            df = pd.read_csv(f, low_memory=False, usecols=lambda c: c in COLS_KEEP)
        return df
    except Exception as e:
        print(f"  {dept}/{year}: {e}")
        return None


def load_all_dvf(depts, years, output_dir):
    """Charge toutes les DVF pour les departements demandes."""
    cache_file = output_dir / "dvf_cache.parquet"

    if cache_file.exists():
        print(f"Cache trouve : {cache_file}")
        return pd.read_parquet(cache_file)

    print("Telechargement des DVF depuis data.gouv.fr...")
    frames = []
    for dept in depts:
        for year in years:
            print(f"  Dept {dept} / {year}...", end=" ", flush=True)
            df = download_dvf(dept, year)
            if df is not None:
                df["annee"] = year
                frames.append(df)
                print(f"{len(df):,} lignes")
            else:
                print("echec")

    if not frames:
        print("Aucune donnee telechargee. Verifiez votre connexion.")
        return None

    data = pd.concat(frames, ignore_index=True)
    print(f"\nTotal brut: {len(data):,} lignes")

    try:
        data.to_parquet(cache_file)
        print(f"Cache sauvegarde: {cache_file}")
    except Exception:
        pass

    return data


# -- 2. Nettoyage -------------------------------------------------------------

def clean_dvf(data):
    """Nettoie les donnees DVF (memes regles que pipeline_hdbscan_idf.py)."""
    print("\nNettoyage...")

    # Ventes uniquement
    data = data[data["nature_mutation"] == "Vente"].copy()

    # Coordonnees et prix valides
    data = data.dropna(subset=["latitude", "longitude", "valeur_fonciere"])
    data["valeur_fonciere"] = pd.to_numeric(data["valeur_fonciere"], errors="coerce")
    data = data[data["valeur_fonciere"] > 0]

    # Deduplication
    data = data.drop_duplicates(subset=["id_mutation", "id_parcelle"])

    # Exclusion VEFA Maisons (prix promoteur gonfle)
    if "nature_mutation" in data.columns:
        mask_vefa = (
            (data["nature_mutation"] == "Vente en l'état futur d'achèvement")
            & (data["type_local"] == "Maison")
        )
        data = data[~mask_vefa]

    # Types numeriques
    data["surface_reelle_bati"] = pd.to_numeric(data["surface_reelle_bati"], errors="coerce")
    data["latitude"] = pd.to_numeric(data["latitude"], errors="coerce")
    data["longitude"] = pd.to_numeric(data["longitude"], errors="coerce")

    # Prix/m2
    data["prix_m2"] = np.where(
        data["surface_reelle_bati"] > 0,
        data["valeur_fonciere"] / data["surface_reelle_bati"],
        np.nan,
    )

    # Filtrer types de biens
    data = data[data["type_local"].isin(TYPES_BIENS)]
    data = data.dropna(subset=["prix_m2"])

    # Filtrer outliers par type
    data = data[data["prix_m2"] >= PRIX_M2_MIN]
    for type_local, max_val in PRIX_M2_MAX.items():
        mask = (data["type_local"] == type_local) & (data["prix_m2"] > max_val)
        data = data[~mask]

    print(f"  Transactions propres: {len(data):,}")
    print(f"  Communes: {data['code_commune'].nunique()}")

    return data


# -- 3. HDBSCAN par commune ---------------------------------------------------

def hdbscan_commune(commune_data):
    """Applique HDBSCAN sur une commune et retourne les stats par cluster."""
    coords = np.radians(commune_data[["latitude", "longitude"]].values)

    # Determiner le type dominant pour adapter les parametres
    type_counts = commune_data["type_local"].value_counts()
    type_dominant = type_counts.index[0] if len(type_counts) > 0 else "Appartement"

    params = hdbscan_params(len(commune_data), type_dominant)
    if params is None:
        return None

    clusterer = hdbscan.HDBSCAN(metric="haversine", **params)

    commune_data = commune_data.copy()
    commune_data["cluster"] = clusterer.fit_predict(coords)

    n_clusters = commune_data[commune_data["cluster"] >= 0]["cluster"].nunique()
    if n_clusters < 2:
        return None

    cluster_stats = []
    for cid in sorted(commune_data[commune_data["cluster"] >= 0]["cluster"].unique()):
        sub = commune_data[commune_data["cluster"] == cid]
        if len(sub) < 3:
            continue
        cluster_stats.append({
            "cluster": cid,
            "n_transactions": len(sub),
            "prix_m2_median": sub["prix_m2"].median(),
            "prix_m2_mean": sub["prix_m2"].mean(),
            "prix_m2_q25": sub["prix_m2"].quantile(0.25),
            "prix_m2_q75": sub["prix_m2"].quantile(0.75),
            "prix_m2_min": sub["prix_m2"].min(),
            "prix_m2_max": sub["prix_m2"].max(),
            "lat_center": sub["latitude"].mean(),
            "lon_center": sub["longitude"].mean(),
        })

    return commune_data, pd.DataFrame(cluster_stats)


def find_anomalies(data):
    """Trouve les plus gros ecarts entre zones HDBSCAN par commune."""
    print("\nAnalyse HDBSCAN commune par commune...")

    communes = data.groupby(["code_commune", "nom_commune"]).size().reset_index(name="count")
    communes = communes[communes["count"] >= MIN_TX_COMMUNE]
    print(f"  Communes eligibles (>={MIN_TX_COMMUNE} tx): {len(communes)}")

    results = []
    commune_data_dict = {}

    for _, row in communes.iterrows():
        code = row["code_commune"]
        nom = row["nom_commune"]
        commune_data = data[data["code_commune"] == code].copy()

        try:
            result = hdbscan_commune(commune_data)
            if result is None:
                continue
            clustered_data, stats = result

            if len(stats) < 2:
                continue

            zone_high = stats.loc[stats["prix_m2_median"].idxmax()]
            zone_low = stats.loc[stats["prix_m2_median"].idxmin()]

            ecart_pct = ((zone_high["prix_m2_median"] / zone_low["prix_m2_median"]) - 1) * 100
            ecart_abs = zone_high["prix_m2_median"] - zone_low["prix_m2_median"]

            results.append({
                "code_commune": code,
                "nom_commune": nom,
                "dept": str(code)[:2],
                "n_transactions": len(commune_data),
                "n_clusters": len(stats),
                "zone_chere_id": int(zone_high["cluster"]),
                "zone_chere_median_m2": round(zone_high["prix_m2_median"]),
                "zone_chere_n_tx": int(zone_high["n_transactions"]),
                "zone_chere_lat": zone_high["lat_center"],
                "zone_chere_lon": zone_high["lon_center"],
                "zone_basse_id": int(zone_low["cluster"]),
                "zone_basse_median_m2": round(zone_low["prix_m2_median"]),
                "zone_basse_n_tx": int(zone_low["n_transactions"]),
                "zone_basse_lat": zone_low["lat_center"],
                "zone_basse_lon": zone_low["lon_center"],
                "ecart_pct": round(ecart_pct, 1),
                "ecart_abs_m2": round(ecart_abs),
            })

            commune_data_dict[code] = (clustered_data, stats)

            if len(results) % 50 == 0:
                print(f"  ... {len(results)} communes analysees")

        except Exception:
            continue

    print(f"\n{len(results)} communes avec anomalies detectees")

    df_results = pd.DataFrame(results)
    df_results = df_results.sort_values("ecart_pct", ascending=False)

    return df_results, commune_data_dict


# -- 4. Generation du post LinkedIn -------------------------------------------

def generate_linkedin_post(df_results):
    """Genere le post LinkedIn avec les vrais chiffres."""
    top5 = df_results.head(5)

    post = (
        f"Une meme ville. Deux quartiers. "
        f"+{top5.iloc[0]['ecart_pct']:.0f}% d'ecart de prix.\n\n"
        f"J'ai analyse {len(df_results):,} communes d'Ile-de-France et de l'Oise "
        f"avec un algorithme de clustering (HDBSCAN) sur les donnees DVF publiques.\n\n"
        f"Resultat : dans certaines villes, le prix au m2 varie de plus du double "
        f"entre deux micro-zones distantes de quelques centaines de metres.\n\n"
        f"Voici le top 5 des ecarts les plus extremes :\n\n"
    )

    for i, (_, row) in enumerate(top5.iterrows()):
        post += (
            f"{i+1}. {row['nom_commune']} ({row['dept']})\n"
            f"   Zone basse : {row['zone_basse_median_m2']:,} EUR/m2 "
            f"-> Zone haute : {row['zone_chere_median_m2']:,} EUR/m2\n"
            f"   Ecart : +{row['ecart_pct']:.0f}% "
            f"({row['ecart_abs_m2']:,} EUR/m2 de difference)\n"
            f"   ({row['n_transactions']} transactions analysees, "
            f"{row['n_clusters']} micro-marches identifies)\n\n"
        )

    post += (
        "Et pourtant, la plupart des estimateurs donnent UN SEUL prix moyen par ville.\n\n"
        "Les agents immobiliers travaillent avec des moyennes communales. "
        "Les investisseurs prennent des decisions sur des donnees trop agregees. "
        "Les vendeurs sous-evaluent (ou surevaluent) leur bien.\n\n"
        "Le machine learning applique au foncier change la donne : "
        "on passe de \"le prix moyen a [ville]\" a \"le vrai prix dans VOTRE micro-zone\".\n\n"
        "C'est ce que je construis avec Datamerry.\n\n"
        "---\n\n"
        "Si vous voulez l'analyse de VOTRE commune, "
        "commentez \"DATA + [nom de ville]\" et je vous l'envoie.\n\n"
        "Donnees : DVF (data.gouv.fr) -- 100% open data\n"
        "Methode : HDBSCAN clustering sur coordonnees GPS\n\n"
        "#immobilier #data #IA #proptech #investissement #machinelearning\n"
    )

    return post


# -- 5. Generation des cartes (TOP 5) -----------------------------------------

def generate_map(commune_data, stats, nom_commune, code_commune, output_dir):
    """Genere une carte Folium pour une commune."""
    if not HAS_FOLIUM:
        return

    center = [commune_data["latitude"].mean(), commune_data["longitude"].mean()]
    m = folium.Map(location=center, zoom_start=14, tiles=None)

    folium.TileLayer(
        tiles="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attr="OSM / CARTO", name="Dark", max_zoom=19, subdomains="abcd",
    ).add_to(m)

    p5 = commune_data["prix_m2"].quantile(0.05)
    p95 = commune_data["prix_m2"].quantile(0.95)
    colormap = cm.LinearColormap(
        colors=["#00d4ff", "#00ff88", "#ffdd00", "#ff6600", "#ff0055"],
        vmin=p5, vmax=p95, caption="Prix au m2 (EUR)",
    )

    COLORS = [
        "#00d4ff", "#00ff88", "#ff6600", "#ff0055", "#cc00ff",
        "#ffdd00", "#00ffcc", "#ff3399", "#66ff00", "#0099ff",
    ]

    # Polygones HDBSCAN
    for _, row in stats.iterrows():
        cid = int(row["cluster"])
        pts = commune_data[commune_data["cluster"] == cid][["latitude", "longitude"]].values
        if len(pts) < 3:
            continue
        try:
            hull = ConvexHull(pts)
            hull_pts = pts[hull.vertices].tolist()
            hull_pts.append(hull_pts[0])
            color = COLORS[cid % len(COLORS)]
            folium.Polygon(
                locations=hull_pts, color=color,
                fill=True, fill_color=color, fill_opacity=0.12, weight=2,
                tooltip=(
                    f"Zone {cid} - {int(row['n_transactions'])} tx - "
                    f"{row['prix_m2_median']:,.0f} EUR/m2"
                ),
            ).add_to(m)
        except Exception:
            pass

    # Points
    for _, row in commune_data.iterrows():
        prix = row["prix_m2"]
        clamped = max(p5, min(p95, prix))
        color = colormap(clamped)
        folium.CircleMarker(
            location=[row["latitude"], row["longitude"]],
            radius=5, color="#ffffff22", fill=True, fill_color=color,
            fill_opacity=0.8, weight=0.5,
            tooltip=f"{row['valeur_fonciere']:,.0f} EUR - {prix:,.0f} EUR/m2",
        ).add_to(m)

    colormap.add_to(m)
    folium.LayerControl().add_to(m)

    watermark = """
    <div style="position:fixed;bottom:8px;left:50%;transform:translateX(-50%);
    z-index:9999;background:rgba(10,10,20,0.8);color:rgba(255,255,255,0.7);
    font-family:sans-serif;font-size:11px;padding:4px 14px;border-radius:20px;
    border:1px solid rgba(255,255,255,0.1);">
    Datamerry -- Samuel Bruno
    </div>"""
    m.get_root().html.add_child(folium.Element(watermark))

    safe_name = nom_commune.replace(" ", "_").replace("'", "")
    out = output_dir / f"carte_{code_commune}_{safe_name}.html"
    m.save(str(out))
    print(f"  Carte: {out}")


# -- Main ---------------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="Datamerry -- Detecteur d'anomalies de prix inter-zones HDBSCAN",
    )
    parser.add_argument(
        "--dept", nargs="+", default=ALL_DEPTS,
        help=f"Departements a analyser (defaut: {' '.join(ALL_DEPTS)})",
    )
    parser.add_argument(
        "--years", nargs="+", type=int, default=DVF_YEARS,
        help=f"Annees DVF (defaut: {' '.join(map(str, DVF_YEARS))})",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=Path("datamerry_output"),
        help="Dossier de sortie (defaut: datamerry_output)",
    )
    parser.add_argument(
        "--skip-maps", action="store_true",
        help="Ne pas generer les cartes Folium",
    )
    parser.add_argument(
        "--top", type=int, default=20,
        help="Nombre de communes a afficher dans le classement (defaut: 20)",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  DATAMERRY -- Detecteur d'anomalies de prix HDBSCAN")
    print(f"  Departements: {' '.join(args.dept)}")
    print(f"  Annees: {' '.join(map(str, args.years))}")
    print("=" * 60)

    # 1. Charger les donnees
    data = load_all_dvf(args.dept, args.years, args.output_dir)
    if data is None:
        return

    # 2. Nettoyer
    data = clean_dvf(data)

    # 3. Trouver les anomalies
    df_results, commune_data_dict = find_anomalies(data)

    if df_results.empty:
        print("Aucune anomalie detectee.")
        return

    # 4. Sauvegarder les resultats
    csv_path = args.output_dir / "anomalies_idf_oise.csv"
    df_results.to_csv(csv_path, index=False)
    print(f"\nResultats: {csv_path}")

    # 5. Afficher le classement
    print("\n" + "=" * 60)
    print(f"  TOP {args.top} -- PLUS GROS ECARTS DE PRIX INTER-ZONES")
    print("=" * 60)
    for i, (_, row) in enumerate(df_results.head(args.top).iterrows()):
        print(f"\n  #{i+1} {row['nom_commune']} ({row['dept']})")
        print(f"     {row['zone_basse_median_m2']:,} EUR/m2 -> {row['zone_chere_median_m2']:,} EUR/m2")
        print(f"     Ecart: +{row['ecart_pct']}% ({row['ecart_abs_m2']:,} EUR/m2)")
        print(f"     {row['n_transactions']} tx - {row['n_clusters']} zones")

    # 6. Generer le post LinkedIn
    post = generate_linkedin_post(df_results)
    post_path = args.output_dir / "post_linkedin.txt"
    post_path.write_text(post, encoding="utf-8")
    print(f"\nPost LinkedIn: {post_path}")

    # 7. Generer les cartes TOP 5
    if not args.skip_maps and HAS_FOLIUM:
        print("\nGeneration des cartes TOP 5...")
        for _, row in df_results.head(5).iterrows():
            code = row["code_commune"]
            if code in commune_data_dict:
                clustered_data, stats = commune_data_dict[code]
                generate_map(
                    clustered_data, stats,
                    row["nom_commune"], code, args.output_dir,
                )
    elif not HAS_FOLIUM:
        print("\nfolium non installe -- cartes non generees (pip install folium)")

    print("\n" + "=" * 60)
    print(f"  Termine -- Tous les fichiers dans: {args.output_dir}")
    print("=" * 60)


if __name__ == "__main__":
    main()
