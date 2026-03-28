"""
DATAMERRY — Détecteur d'anomalies de prix inter-zones HDBSCAN
================================================================
Script clé-en-main : télécharge les DVF publiques, clusterise par HDBSCAN,
et détecte les plus gros écarts de prix entre micro-marchés au sein d'une même commune.

Usage:
    pip install pandas numpy hdbscan requests
    python datamerry_hdbscan_anomalies.py

Output:
    - anomalies_idf_oise.csv : résultats triés par écart de prix
    - post_linkedin.txt : post LinkedIn pré-rédigé avec les vrais chiffres
    - Pour chaque commune TOP 5 : carte HTML Folium

Auteur: Samuel Bruno — Datamerry
Date: Mars 2026
"""

import pandas as pd
import numpy as np
import os
import requests
import io
import gzip
import warnings
warnings.filterwarnings("ignore")

try:
    import hdbscan
except ImportError:
    print("Installation de hdbscan...")
    os.system("pip install hdbscan")
    import hdbscan

try:
    import folium
    from folium.plugins import HeatMap
    HAS_FOLIUM = True
except ImportError:
    HAS_FOLIUM = False
    print("folium non installé — les cartes ne seront pas générées (pip install folium)")

# ══════════════════════════════════════════════════════════════════════════════
# CONFIGURATION
# ══════════════════════════════════════════════════════════════════════════════

# Départements IDF + Oise
DEPARTEMENTS = ["75", "77", "78", "91", "92", "93", "94", "95", "60"]

# Années DVF à charger
ANNEES = [2020, 2021, 2022, 2023, 2024]

# HDBSCAN params
MIN_CLUSTER_SIZE = 8
MIN_SAMPLES = 3

# Nombre minimum de transactions par commune pour l'analyser
MIN_TX_COMMUNE = 30

# Types de biens à analyser
TYPES_BIENS = ["Appartement", "Maison"]

# Dossier de sortie
OUTPUT_DIR = "datamerry_output"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ══════════════════════════════════════════════════════════════════════════════
# 1. TÉLÉCHARGEMENT DVF
# ══════════════════════════════════════════════════════════════════════════════

def download_dvf(dept, year):
    """Télécharge les DVF depuis data.gouv.fr (open data)."""
    url = f"https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/departements/{dept}.csv.gz"
    try:
        r = requests.get(url, timeout=30)
        if r.status_code == 200:
            content = gzip.decompress(r.content)
            df = pd.read_csv(io.BytesIO(content), low_memory=False)
            return df
        else:
            print(f"  ⚠ {dept}/{year}: HTTP {r.status_code}")
            return None
    except Exception as e:
        print(f"  ⚠ {dept}/{year}: {e}")
        return None


def load_all_dvf():
    """Charge toutes les DVF IDF+Oise."""
    cache_file = os.path.join(OUTPUT_DIR, "dvf_idf_oise_cache.parquet")

    if os.path.exists(cache_file):
        print(f"📦 Cache trouvé : {cache_file}")
        return pd.read_parquet(cache_file)

    print("📥 Téléchargement des DVF depuis data.gouv.fr...")
    frames = []
    for dept in DEPARTEMENTS:
        for year in ANNEES:
            print(f"  Dept {dept} / {year}...", end=" ", flush=True)
            df = download_dvf(dept, year)
            if df is not None:
                df["annee"] = year
                frames.append(df)
                print(f"✓ {len(df)} lignes")
            else:
                print("✗")

    if not frames:
        print("❌ Aucune donnée téléchargée. Vérifiez votre connexion.")
        return None

    data = pd.concat(frames, ignore_index=True)
    print(f"\n📊 Total brut: {len(data):,} lignes")

    # Sauvegarde cache
    try:
        data.to_parquet(cache_file)
        print(f"💾 Cache sauvegardé: {cache_file}")
    except:
        pass

    return data


# ══════════════════════════════════════════════════════════════════════════════
# 2. NETTOYAGE
# ══════════════════════════════════════════════════════════════════════════════

def clean_dvf(data):
    """Nettoie les données DVF."""
    print("\n🧹 Nettoyage...")

    # Garder uniquement ventes
    data = data[data["nature_mutation"] == "Vente"].copy()

    # Coordonnées valides
    data = data.dropna(subset=["latitude", "longitude", "valeur_fonciere"])
    data = data[data["valeur_fonciere"] > 0]

    # Dédoublication
    data = data.drop_duplicates(subset=["id_mutation", "id_parcelle"])

    # Types numériques
    data["valeur_fonciere"] = pd.to_numeric(data["valeur_fonciere"], errors="coerce")
    data["surface_reelle_bati"] = pd.to_numeric(data["surface_reelle_bati"], errors="coerce")

    # Prix/m²
    data["prix_m2"] = np.where(
        data["surface_reelle_bati"] > 0,
        data["valeur_fonciere"] / data["surface_reelle_bati"],
        np.nan,
    )

    # Filtrer types de biens
    data = data[data["type_local"].isin(TYPES_BIENS)]
    data = data.dropna(subset=["prix_m2"])

    # Filtrer prix aberrants (outliers extrêmes)
    data = data[(data["prix_m2"] > 500) & (data["prix_m2"] < 25000)]

    print(f"  Transactions propres: {len(data):,}")
    print(f"  Communes: {data['code_commune'].nunique()}")

    return data


# ══════════════════════════════════════════════════════════════════════════════
# 3. HDBSCAN PAR COMMUNE
# ══════════════════════════════════════════════════════════════════════════════

def hdbscan_commune(commune_data):
    """Applique HDBSCAN sur une commune et retourne les stats par cluster."""
    coords = np.radians(commune_data[["latitude", "longitude"]].values)

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=MIN_CLUSTER_SIZE,
        min_samples=MIN_SAMPLES,
        metric="haversine",
        cluster_selection_method="eom",
    )

    commune_data = commune_data.copy()
    commune_data["cluster"] = clusterer.fit_predict(coords)

    n_clusters = commune_data[commune_data["cluster"] >= 0]["cluster"].nunique()
    if n_clusters < 2:
        return None  # Pas assez de zones pour comparer

    # Stats par cluster
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
    """Trouve les plus gros écarts entre zones HDBSCAN par commune."""
    print("\n🔍 Analyse HDBSCAN commune par commune...")

    communes = data.groupby(["code_commune", "nom_commune"]).size().reset_index(name="count")
    communes = communes[communes["count"] >= MIN_TX_COMMUNE]
    print(f"  Communes éligibles (>={MIN_TX_COMMUNE} tx): {len(communes)}")

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

            # Trouver le plus gros écart entre zones
            if len(stats) < 2:
                continue

            # Écart max entre médiane la plus haute et la plus basse
            zone_high = stats.loc[stats["prix_m2_median"].idxmax()]
            zone_low = stats.loc[stats["prix_m2_median"].idxmin()]

            ecart_pct = ((zone_high["prix_m2_median"] / zone_low["prix_m2_median"]) - 1) * 100
            ecart_abs = zone_high["prix_m2_median"] - zone_low["prix_m2_median"]

            results.append({
                "code_commune": code,
                "nom_commune": nom,
                "dept": str(code)[:2] if len(str(code)) == 5 else str(code)[:2],
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
                print(f"  ... {len(results)} communes analysées")

        except Exception as e:
            continue

    print(f"\n✅ {len(results)} communes avec anomalies détectées")

    df_results = pd.DataFrame(results)
    df_results = df_results.sort_values("ecart_pct", ascending=False)

    return df_results, commune_data_dict


# ══════════════════════════════════════════════════════════════════════════════
# 4. GÉNÉRATION DU POST LINKEDIN
# ══════════════════════════════════════════════════════════════════════════════

def generate_linkedin_post(df_results):
    """Génère le post LinkedIn avec les vrais chiffres."""

    top5 = df_results.head(5)

    post = f"""Une même ville. Deux quartiers. +{top5.iloc[0]['ecart_pct']:.0f}% d'écart de prix.

J'ai analysé {len(df_results):,} communes d'Île-de-France et de l'Oise avec un algorithme de clustering (HDBSCAN) sur les données DVF publiques.

Résultat : dans certaines villes, le prix au m² varie de plus du double entre deux micro-zones distantes de quelques centaines de mètres.

Voici le top 5 des écarts les plus extrêmes :

"""

    for i, (_, row) in enumerate(top5.iterrows()):
        post += f"""{i+1}. {row['nom_commune']} ({row['dept']})
   Zone basse : {row['zone_basse_median_m2']:,} €/m² → Zone haute : {row['zone_chere_median_m2']:,} €/m²
   Écart : +{row['ecart_pct']:.0f}% ({row['ecart_abs_m2']:,} €/m² de différence)
   ({row['n_transactions']} transactions analysées, {row['n_clusters']} micro-marchés identifiés)

"""

    post += """Et pourtant, la plupart des estimateurs donnent UN SEUL prix moyen par ville.

Les agents immobiliers travaillent avec des moyennes communales. Les investisseurs prennent des décisions sur des données trop agrégées. Les vendeurs sous-évaluent (ou surévaluent) leur bien.

Le machine learning appliqué au foncier change la donne : on passe de "le prix moyen à [ville]" à "le vrai prix dans VOTRE micro-zone".

C'est ce que je construis avec Datamerry.

---

💡 Si vous voulez l'analyse de VOTRE commune, commentez "DATA + [nom de ville]" et je vous l'envoie.

🔗 Données : DVF (data.gouv.fr) — 100% open data
🤖 Méthode : HDBSCAN clustering sur coordonnées GPS

#immobilier #data #IA #proptech #investissement #machinelearning
"""

    return post


# ══════════════════════════════════════════════════════════════════════════════
# 5. GÉNÉRATION DES CARTES (TOP 5)
# ══════════════════════════════════════════════════════════════════════════════

def generate_map(commune_data, stats, nom_commune, code_commune):
    """Génère une carte Folium pour une commune."""
    if not HAS_FOLIUM:
        return

    from scipy.spatial import ConvexHull
    import branca.colormap as cm

    center = [commune_data["latitude"].mean(), commune_data["longitude"].mean()]
    m = folium.Map(location=center, zoom_start=14, tiles=None)

    folium.TileLayer(
        tiles="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attr="OSM / CARTO", name="Dark", max_zoom=19, subdomains="abcd",
    ).add_to(m)

    # Colormap
    p5 = commune_data["prix_m2"].quantile(0.05)
    p95 = commune_data["prix_m2"].quantile(0.95)
    colormap = cm.LinearColormap(
        colors=["#00d4ff", "#00ff88", "#ffdd00", "#ff6600", "#ff0055"],
        vmin=p5, vmax=p95, caption="Prix au m² (€)",
    )

    COLORS = ["#00d4ff", "#00ff88", "#ff6600", "#ff0055", "#cc00ff",
              "#ffdd00", "#00ffcc", "#ff3399", "#66ff00", "#0099ff"]

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
                tooltip=f"Zone {cid} · {int(row['n_transactions'])} tx · {row['prix_m2_median']:,.0f} €/m²",
            ).add_to(m)
        except:
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
            tooltip=f"{row['valeur_fonciere']:,.0f}€ · {prix:,.0f}€/m²",
        ).add_to(m)

    colormap.add_to(m)
    folium.LayerControl().add_to(m)

    # Watermark Datamerry
    watermark = """
    <div style="position:fixed;bottom:8px;left:50%;transform:translateX(-50%);
    z-index:9999;background:rgba(10,10,20,0.8);color:rgba(255,255,255,0.7);
    font-family:sans-serif;font-size:11px;padding:4px 14px;border-radius:20px;
    border:1px solid rgba(255,255,255,0.1);">
    © 2026 Datamerry — Samuel Bruno
    </div>"""
    m.get_root().html.add_child(folium.Element(watermark))

    out = os.path.join(OUTPUT_DIR, f"carte_{code_commune}_{nom_commune.replace(' ','_')}.html")
    m.save(out)
    print(f"  🗺  Carte: {out}")


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════

def main():
    print("=" * 60)
    print("  DATAMERRY — Détecteur d'anomalies de prix HDBSCAN")
    print("  IDF + Oise · Données DVF publiques")
    print("=" * 60)

    # 1. Charger les données
    data = load_all_dvf()
    if data is None:
        return

    # 2. Nettoyer
    data = clean_dvf(data)

    # 3. Trouver les anomalies
    df_results, commune_data_dict = find_anomalies(data)

    # 4. Sauvegarder les résultats
    csv_path = os.path.join(OUTPUT_DIR, "anomalies_idf_oise.csv")
    df_results.to_csv(csv_path, index=False)
    print(f"\n📊 Résultats: {csv_path}")

    # 5. Afficher le TOP 20
    print("\n" + "=" * 60)
    print("  TOP 20 — PLUS GROS ÉCARTS DE PRIX INTER-ZONES")
    print("=" * 60)
    for i, (_, row) in enumerate(df_results.head(20).iterrows()):
        print(f"\n  #{i+1} {row['nom_commune']} ({row['dept']})")
        print(f"     {row['zone_basse_median_m2']:,}€/m² → {row['zone_chere_median_m2']:,}€/m²")
        print(f"     Écart: +{row['ecart_pct']}% ({row['ecart_abs_m2']:,}€/m²)")
        print(f"     {row['n_transactions']} tx · {row['n_clusters']} zones")

    # 6. Générer le post LinkedIn
    post = generate_linkedin_post(df_results)
    post_path = os.path.join(OUTPUT_DIR, "post_linkedin.txt")
    with open(post_path, "w", encoding="utf-8") as f:
        f.write(post)
    print(f"\n📝 Post LinkedIn: {post_path}")

    # 7. Générer les cartes TOP 5
    if HAS_FOLIUM:
        print("\n🗺  Génération des cartes TOP 5...")
        for _, row in df_results.head(5).iterrows():
            code = row["code_commune"]
            if code in commune_data_dict:
                clustered_data, stats = commune_data_dict[code]
                generate_map(clustered_data, stats, row["nom_commune"], code)

    print("\n" + "=" * 60)
    print("  ✅ TERMINÉ — Tous les fichiers dans:", OUTPUT_DIR)
    print("=" * 60)


if __name__ == "__main__":
    main()
