#!/usr/bin/env python3
"""
Pipeline générique — Carte foncière par département
Génère carte_appartements.html, carte_maisons.html, carte_commerces.html + index.html
Même modèle que hauts-de-seine-foncier (samuelbruno-lab.github.io)

Usage: python pipeline_dept.py <CODE_DEPT>
Ex:    python pipeline_dept.py 93
"""
import sys, os, json
import pandas as pd
import numpy as np
import folium
from folium.plugins import HeatMap, MiniMap, Fullscreen
import hdbscan
from scipy.spatial import ConvexHull
import branca.colormap as cm

# ── Config par département ─────────────────────────────────────────────────
DEPT_CONFIG = {
    "60": {
        "nom": "Oise", "code": "60",
        "gradient": ("90deg", "#ffdd00", "#ffffff", "#ec4899"),
        "color": "#ec4899",
        "csv_years": {2020: "/home/user/dvf_60.csv"},  # pas d'années séparées
        "csv_global": "/home/user/dvf_60.csv",
        "zoom": 10, "repo": "oise-foncier",
    },
    "75": {
        "nom": "Paris", "code": "75",
        "gradient": ("90deg", "#00d4ff", "#ffffff", "#ef4444"),
        "color": "#ef4444",
        "csv_years": {},
        "csv_global": "/home/user/dvf_75.csv",
        "zoom": 12, "repo": "paris-foncier",
    },
    "77": {
        "nom": "Seine-et-Marne", "code": "77",
        "gradient": ("90deg", "#00d4ff", "#ffffff", "#f97316"),
        "color": "#f97316",
        "csv_years": {},
        "csv_global": "/home/user/dvf_77.csv",
        "zoom": 10, "repo": "seine-et-marne-foncier",
    },
    "78": {
        "nom": "Yvelines", "code": "78",
        "gradient": ("90deg", "#00d4ff", "#ffffff", "#8b5cf6"),
        "color": "#8b5cf6",
        "csv_years": {},
        "csv_global": "/home/user/dvf_78.csv",
        "zoom": 11, "repo": "yvelines-foncier",
    },
    "91": {
        "nom": "Essonne", "code": "91",
        "gradient": ("90deg", "#00d4ff", "#ffffff", "#10b981"),
        "color": "#10b981",
        "csv_years": {},
        "csv_global": "/home/user/dvf_91.csv",
        "zoom": 11, "repo": "essonne-foncier",
    },
    "92": {
        "nom": "Hauts-de-Seine", "code": "92",
        "gradient": ("90deg", "#00d4ff", "#ffffff", "#ff6600"),
        "color": "#00d4ff",
        "csv_years": {},  # global CSV uniquement (yearly = fichiers HTML trop grands)
        "csv_global": "/home/user/dvf_92.csv",
        "zoom": 12, "repo": "hauts-de-seine-foncier",
    },
    "93": {
        "nom": "Seine-Saint-Denis", "code": "93",
        "gradient": ("90deg", "#00d4ff", "#ffffff", "#00ff88"),
        "color": "#00ff88",
        "csv_years": {},
        "csv_global": "/home/user/dvf_93.csv",
        "zoom": 12, "repo": "seine-saint-denis-foncier",
    },
    "94": {
        "nom": "Val-de-Marne", "code": "94",
        "gradient": ("90deg", "#00d4ff", "#ffffff", "#a78bfa"),
        "color": "#a78bfa",
        "csv_years": {},  # global CSV uniquement (yearly = fichiers HTML trop grands)
        "csv_global": "/home/user/dvf_94.csv",
        "zoom": 12, "repo": "val-de-marne-foncier",
    },
    "95": {
        "nom": "Val-d'Oise", "code": "95",
        "gradient": ("90deg", "#00d4ff", "#ffffff", "#f59e0b"),
        "color": "#f59e0b",
        "csv_years": {},
        "csv_global": "/home/user/dvf_95.csv",
        "zoom": 11, "repo": "val-d-oise-foncier",
    },
}

TYPE_CONFIG = {
    "Appartement": {"emoji": "🏢", "label": "Appartements", "file": "carte_appartements.html", "color": "#00d4ff"},
    "Maison":      {"emoji": "🏠", "label": "Maisons / Pavillons", "file": "carte_maisons.html", "color": "#00ff88"},
    "Local commercial": {"emoji": "🏭", "label": "Commerces & Locaux", "file": "carte_commerces.html", "color": "#ff6600"},
}

CLUSTER_COLORS = [
    "#00d4ff","#00ff88","#ff6600","#ff0055","#cc00ff",
    "#ffdd00","#00ffcc","#ff3399","#66ff00","#0099ff",
    "#ff9900","#ff00aa","#00ff44","#aa00ff","#ffcc00",
    "#00ccff","#ff4400","#44ffaa","#ff44cc","#aaff00",
]

def c_color(cid):
    return CLUSTER_COLORS[int(cid) % len(CLUSTER_COLORS)] if cid >= 0 else "#666666"

def aggregate_mutations(data):
    """Une ligne par mutation pour les mutations pures :
    - Sépare les mutations mixtes (plusieurs type_local) pour ventilation ultérieure
    - Agrège surface_terrain (somme des parcelles) pour les maisons
    - Agrège surface_reelle_bati (somme Carrez) pour les appartements
    Retourne : (pure_dedup, mixed_raw)
    """
    if "id_mutation" not in data.columns:
        return data, pd.DataFrame()
    # 1. Séparer mutations pures / mixtes
    if "type_local" in data.columns:
        n_types = data.groupby("id_mutation")["type_local"].apply(
            lambda x: x.dropna().nunique()
        )
        pure_ids  = n_types[n_types <= 1].index
        mixed_ids = n_types[n_types > 1].index
        n_mixed = len(mixed_ids)
        if n_mixed > 0:
            print(f"  Mutations mixtes détectées : {n_mixed} (seront ventilées)")
        pure_data  = data[data["id_mutation"].isin(pure_ids)].copy()
        mixed_data = data[data["id_mutation"].isin(mixed_ids)].copy()
    else:
        pure_data  = data.copy()
        mixed_data = pd.DataFrame()
    # 2. Agréger surfaces pour mutations pures
    agg_dict = {}
    for col in ["surface_terrain", "surface_reelle_bati"]:
        if col in data.columns:
            agg_dict[col] = "sum"
    if agg_dict:
        agg_df = pure_data.groupby("id_mutation").agg(agg_dict).reset_index()
        for col in agg_dict:
            agg_df[col] = agg_df[col].replace(0, np.nan)
        data_dedup = pure_data.drop_duplicates(subset=["id_mutation"], keep="first").copy()
        data_dedup = data_dedup.drop(columns=list(agg_dict.keys()), errors="ignore")
        data_dedup = data_dedup.merge(agg_df, on="id_mutation", how="left")
    else:
        data_dedup = pure_data.drop_duplicates(subset=["id_mutation"], keep="first").copy()
    print(f"  Mutations pures agrégées : {len(data_dedup)}")
    return data_dedup, mixed_data


def run_preliminary_clustering(pure_data, min_cluster_size=8, min_samples=2):
    """Clustering HDBSCAN préliminaire sur toutes les ventes pures pour définir les zones de référence."""
    if pure_data.empty or len(pure_data) < min_cluster_size:
        return np.full(len(pure_data), -1, dtype=int)
    coords = np.radians(pure_data[["latitude", "longitude"]].values)
    cl = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="haversine",
        cluster_selection_method="eom",
    )
    labels = cl.fit_predict(coords)
    n_clusters = int(np.unique(labels[labels >= 0]).size)
    print(f"  Clustering préliminaire (référence ventilation) : {n_clusters} zones sur {len(pure_data)} tx pures")
    return labels


def assign_cluster_to_mixed(mixed_data, pure_data, pure_cluster_labels):
    """Affecte chaque mutation mixte à la zone HDBSCAN la plus proche (par centroïde lat/lon)."""
    mixed_data = mixed_data.copy()
    pure_cl = pure_data.copy()
    pure_cl["_ref_cluster"] = pure_cluster_labels
    centroids = (
        pure_cl[pure_cl["_ref_cluster"] >= 0]
        .groupby("_ref_cluster")[["latitude", "longitude"]]
        .mean()
    )
    if centroids.empty:
        mixed_data["ref_cluster"] = -1
        return mixed_data
    centroid_arr = centroids[["latitude", "longitude"]].values
    centroid_ids = centroids.index.tolist()
    id_to_cluster = {}
    for id_mut, grp in mixed_data.groupby("id_mutation"):
        lat = float(grp["latitude"].iloc[0])
        lon = float(grp["longitude"].iloc[0])
        dists = np.sqrt((centroid_arr[:, 0] - lat) ** 2 + (centroid_arr[:, 1] - lon) ** 2)
        id_to_cluster[id_mut] = centroid_ids[int(np.argmin(dists))]
    mixed_data["ref_cluster"] = mixed_data["id_mutation"].map(id_to_cluster).fillna(-1).astype(int)
    return mixed_data


def ventiler_mutations_mixtes(mixed_data, median_m2_by_cluster_type,
                               median_m2_by_parcelle_type, global_median_m2_by_type,
                               min_parcelle_tx=5):
    """Ventile le prix total de chaque mutation mixte entre ses composantes.

    Référence de prix (par ordre de priorité) pour chaque composante (type_local) :
      1. Médiane de la parcelle (si ≥ min_parcelle_tx ventes pures du même type sur la parcelle)
      2. Médiane du micromarché = zone HDBSCAN préliminaire pour ce type
      3. Médiane globale commune (fallback)

    Formule : Part(type) = Prix_total × (S_type × P_réf_type) / Σ(S_i × P_réf_i)
    """
    if mixed_data.empty:
        return pd.DataFrame()

    results = []
    for id_mut, group in mixed_data.groupby("id_mutation"):
        total_val = float(group["valeur_fonciere"].iloc[0])
        ref_cluster = int(group["ref_cluster"].iloc[0]) if "ref_cluster" in group.columns else -1
        id_parcelle = str(group["id_parcelle"].iloc[0]) if "id_parcelle" in group.columns else None

        type_groups = []
        for tl, tl_grp in group.groupby("type_local", dropna=False):
            template = tl_grp.iloc[0].copy()
            surf_bati    = tl_grp["surface_reelle_bati"].sum() if "surface_reelle_bati" in tl_grp.columns else np.nan
            surf_terrain = tl_grp["surface_terrain"].sum()     if "surface_terrain"     in tl_grp.columns else np.nan
            template["surface_reelle_bati"] = surf_bati    if (pd.notna(surf_bati)    and surf_bati    > 0) else np.nan
            template["surface_terrain"]     = surf_terrain if (pd.notna(surf_terrain) and surf_terrain > 0) else np.nan
            surf = surf_bati if (pd.notna(surf_bati) and surf_bati > 0) else np.nan

            parcelle_info = median_m2_by_parcelle_type.get(id_parcelle, {}).get(tl, {})
            if parcelle_info.get("count", 0) >= min_parcelle_tx and pd.notna(parcelle_info.get("median")):
                m2_ref = parcelle_info["median"]
                ref_source = "parcelle"
            elif ref_cluster >= 0 and tl in median_m2_by_cluster_type.get(ref_cluster, {}):
                m2_ref = median_m2_by_cluster_type[ref_cluster][tl]
                ref_source = f"zone_{ref_cluster}"
            else:
                m2_ref = global_median_m2_by_type.get(tl, np.nan)
                ref_source = "global"

            theorique = float(surf) * float(m2_ref) if (pd.notna(surf) and pd.notna(m2_ref)) else np.nan
            type_groups.append({
                "row": template, "type_local": tl,
                "surface": surf, "m2_ref": m2_ref,
                "theorique": theorique, "ref_source": ref_source,
            })

        total_theorique = sum(c["theorique"] for c in type_groups if pd.notna(c["theorique"]))

        breakdown = []
        for c in type_groups:
            if total_theorique > 0 and pd.notna(c["theorique"]):
                ventile_val = total_val * (c["theorique"] / total_theorique)
            else:
                ventile_val = total_val / len(type_groups)
            breakdown.append({
                "type": str(c["type_local"]),
                "surface": float(c["surface"]) if pd.notna(c["surface"]) else None,
                "m2_ref": float(c["m2_ref"]) if pd.notna(c["m2_ref"]) else None,
                "theorique": float(c["theorique"]) if pd.notna(c["theorique"]) else None,
                "ventile": ventile_val,
                "ref_source": c["ref_source"],
            })
        breakdown_str = json.dumps(breakdown, ensure_ascii=False)

        for c, b in zip(type_groups, breakdown):
            new_row = c["row"].copy()
            new_row["valeur_fonciere"]         = b["ventile"]
            new_row["is_ventile"]              = True
            new_row["valeur_fonciere_totale"]  = total_val
            surf = c["surface"]
            new_row["prix_m2"] = (b["ventile"] / float(surf)
                                  if pd.notna(surf) and float(surf) > 0 else np.nan)
            new_row["prix_m2_median_ventil"]   = c["m2_ref"]
            new_row["ventil_ref_source"]       = c["ref_source"]
            new_row["ventil_breakdown"]        = breakdown_str
            new_row["ventil_total_theorique"]  = total_theorique if total_theorique > 0 else np.nan
            results.append(new_row)

    if not results:
        return pd.DataFrame()
    ventile_df = pd.DataFrame(results)
    n_mut = mixed_data["id_mutation"].nunique()
    print(f"  Mutations mixtes ventilées : {n_mut} mutations → {len(ventile_df)} composantes")
    return ventile_df

def load_data(cfg):
    frames = []
    years_loaded = []
    # Années séparées
    for year, path in cfg["csv_years"].items():
        try:
            df = pd.read_csv(path, low_memory=False)
            df["annee"] = year
            frames.append(df)
            years_loaded.append(year)
            print(f"  {year}: {len(df)} lignes")
        except Exception as e:
            print(f"  Skip {year}: {e}")
    # Fichier global (si pas d'années séparées ou pour compléter)
    if not frames and cfg["csv_global"]:
        try:
            df = pd.read_csv(cfg["csv_global"], low_memory=False)
            if "date_mutation" in df.columns:
                df["date_mutation"] = pd.to_datetime(df["date_mutation"], errors="coerce")
                df["annee"] = df["date_mutation"].dt.year.fillna(2024).astype(int)
            else:
                df["annee"] = 2024
            frames.append(df)
            print(f"  global: {len(df)} lignes")
        except Exception as e:
            print(f"  Skip global: {e}")
    if not frames:
        raise RuntimeError("Aucune donnée chargée")
    data = pd.concat(frames, ignore_index=True)
    data = data.dropna(subset=["latitude", "longitude", "valeur_fonciere"])
    data = data[data["valeur_fonciere"] > 1]
    data["valeur_fonciere"] = pd.to_numeric(data["valeur_fonciere"], errors="coerce")
    data["surface_reelle_bati"] = pd.to_numeric(data.get("surface_reelle_bati", pd.Series(dtype=float)), errors="coerce")
    if "surface_terrain" in data.columns:
        data["surface_terrain"] = pd.to_numeric(data["surface_terrain"], errors="coerce")
    data["date_mutation"] = pd.to_datetime(data.get("date_mutation", pd.Series(dtype=str)), errors="coerce")
    # Exclusion caves/dépendances et doublons bruts
    if "type_local" in data.columns:
        data = data[data["type_local"] != "Dépendance"]
    if "id_mutation" in data.columns and "id_parcelle" in data.columns:
        data = data.drop_duplicates(subset=["id_mutation", "id_parcelle", "type_local", "surface_reelle_bati"])  # conserver les lots distincts par type/surface
    # Exclusion VEFA maisons (prix total promoteur)
    if "nature_mutation" in data.columns and "type_local" in data.columns:
        data = data[~((data["nature_mutation"] == "Vente en l'état futur d'achèvement") &
                      (data["type_local"] == "Maison"))]
    # Agréger par mutation : séparation pures/mixtes + somme surfaces parcelles/Carrez
    data, mixed_raw = aggregate_mutations(data)
    # Prix/m² : surface bâtie pour appartements et maisons
    if "surface_terrain" in data.columns and "type_local" in data.columns:
        data["prix_m2"] = np.where(
            (data["type_local"].isin(["Appartement", "Maison"])) & (data["surface_reelle_bati"] > 0),
            data["valeur_fonciere"] / data["surface_reelle_bati"],
            np.where(
                data["surface_reelle_bati"] > 0,
                data["valeur_fonciere"] / data["surface_reelle_bati"],
                np.nan,
            ),
        )
    else:
        data["prix_m2"] = np.where(
            data["surface_reelle_bati"] > 0,
            data["valeur_fonciere"] / data["surface_reelle_bati"],
            np.nan,
        )
    data = data.dropna(subset=["valeur_fonciere"])
    # Suppression des outliers DVF aberrants par type
    SEUIL_PRIX_M2 = {"Maison": 9000, "Appartement": 12000,
                     "Local industriel. commercial ou assimilé": 12000,
                     "Local commercial": 12000}
    if "type_local" in data.columns:
        for tl, seuil in SEUIL_PRIX_M2.items():
            mask = (data["type_local"] == tl) & (data["prix_m2"] > seuil)
            n = mask.sum()
            if n:
                print(f"  Suppression {n} outliers {tl} > {seuil} €/m²")
            data = data[~mask]
    # Ventilation des mutations mixtes
    # Clustering préliminaire sur les ventes pures pour définir les micromarchés de référence
    pure_cluster_labels = run_preliminary_clustering(data, min_cluster_size=8, min_samples=2)
    # Médiane par micromarché (zone) ET type
    median_m2_by_cluster_type = {}
    data_for_ref = data.copy()
    data_for_ref["_ref_cluster"] = pure_cluster_labels
    for cid in np.unique(pure_cluster_labels[pure_cluster_labels >= 0]):
        subset_c = data_for_ref[
            (data_for_ref["_ref_cluster"] == cid)
            & data_for_ref["prix_m2"].notna()
            & (data_for_ref["prix_m2"] > 0)
        ]
        median_m2_by_cluster_type[int(cid)] = {}
        if "type_local" in subset_c.columns:
            for tl in subset_c["type_local"].dropna().unique():
                vals = subset_c[subset_c["type_local"] == tl]["prix_m2"]
                if len(vals) >= 3:
                    median_m2_by_cluster_type[int(cid)][tl] = float(vals.median())
                    print(f"  Zone {cid} · {tl}: {median_m2_by_cluster_type[int(cid)][tl]:,.0f} €/m² ({len(vals)} tx)")
    # Médiane par parcelle ET type (référence si parcelle isolée avec beaucoup de ventes)
    median_m2_by_parcelle_type = {}
    if "id_parcelle" in data.columns and "type_local" in data.columns:
        for (id_parc, tl), grp in data.groupby(["id_parcelle", "type_local"]):
            vals = grp["prix_m2"].dropna()
            vals = vals[vals > 0]
            if id_parc not in median_m2_by_parcelle_type:
                median_m2_by_parcelle_type[id_parc] = {}
            median_m2_by_parcelle_type[id_parc][tl] = {
                "median": float(vals.median()) if len(vals) > 0 else np.nan,
                "count": len(vals),
            }
    # Médiane globale par type (fallback)
    global_median_m2_by_type = {}
    if "type_local" in data.columns:
        for tl in data["type_local"].dropna().unique():
            subset = data[(data["type_local"] == tl) & data["prix_m2"].notna() & (data["prix_m2"] > 0)]
            if len(subset) > 0:
                global_median_m2_by_type[tl] = float(subset["prix_m2"].median())
    if not mixed_raw.empty:
        mixed_raw = assign_cluster_to_mixed(mixed_raw, data, pure_cluster_labels)
        ventile_df = ventiler_mutations_mixtes(
            mixed_raw,
            median_m2_by_cluster_type,
            median_m2_by_parcelle_type,
            global_median_m2_by_type,
            min_parcelle_tx=5,
        )
        if not ventile_df.empty:
            data = pd.concat([data, ventile_df], ignore_index=True)
            print(f"  Total après ventilation : {len(data)} transactions")
    data["latitude"] = pd.to_numeric(data["latitude"], errors="coerce")
    data["longitude"] = pd.to_numeric(data["longitude"], errors="coerce")
    data = data.dropna(subset=["latitude", "longitude"])
    # Normalise type_local
    if "type_local" not in data.columns:
        data["type_local"] = "Appartement"
    print(f"Total transactions chargées : {len(data)}")
    return data

def run_hdbscan(data, min_cluster_size=15):
    coords = np.radians(data[["latitude", "longitude"]].values)
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=3,
        metric="haversine",
        cluster_selection_method="eom",
    )
    data = data.copy()
    data["cluster"] = clusterer.fit_predict(coords)
    n_clusters = int(data[data["cluster"] >= 0]["cluster"].nunique())
    print(f"  Micro-marchés : {n_clusters}")
    return data

def apply_jitter(df, radius_deg=0.0001):
    df = df.copy()
    df["lat_j"] = df["latitude"].astype(float)
    df["lon_j"] = df["longitude"].astype(float)
    groups = df.groupby(["latitude", "longitude"])
    for (lat, lon), idx in groups.groups.items():
        n = len(idx)
        if n == 1:
            continue
        angles = np.linspace(0, 2 * np.pi * (1 + n // 8), n, endpoint=False)
        radii  = np.linspace(radius_deg * 0.3, radius_deg, n)
        df.loc[idx, "lat_j"] = lat + radii * np.sin(angles)
        df.loc[idx, "lon_j"] = lon + radii * np.cos(angles)
    return df


def make_map(data, cfg, type_local, out_path):
    tc = TYPE_CONFIG.get(type_local, {"emoji": "📍", "label": type_local, "color": "#00d4ff"})
    dept_nom = cfg["nom"]
    dept_code = cfg["code"]

    p5  = data["prix_m2"].quantile(0.05) if data["prix_m2"].notna().any() else 0
    p95 = data["prix_m2"].quantile(0.95) if data["prix_m2"].notna().any() else 10000
    if p5 == p95: p95 = p5 + 1
    colormap = cm.LinearColormap(
        colors=["#00d4ff", "#00ff88", "#ffdd00", "#ff6600", "#ff0055"],
        vmin=p5, vmax=p95, caption="Prix au m² (€)",
    )
    def price_color(prix_m2):
        if pd.isna(prix_m2): return "#aaaaaa"
        return colormap(max(p5, min(p95, prix_m2)))

    data = apply_jitter(data)

    center = [data["latitude"].mean(), data["longitude"].mean()]
    m = folium.Map(location=center, zoom_start=cfg["zoom"], tiles=None, prefer_canvas=True)
    folium.TileLayer(
        tiles="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attr='&copy; OSM &copy; CARTO', name="Dark (défaut)", max_zoom=19, subdomains="abcd",
    ).add_to(m)
    folium.TileLayer(
        tiles="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        attr='&copy; OSM &copy; CARTO', name="Light", max_zoom=19, subdomains="abcd",
    ).add_to(m)
    Fullscreen(position="topright").add_to(m)
    MiniMap(position="bottomleft", tile_layer="CartoDB dark_matter", zoom_level_offset=-5).add_to(m)

    # Heatmap
    heat_data = data[["latitude", "longitude", "prix_m2"]].dropna(subset=["prix_m2"]).copy()
    if len(heat_data) > 0:
        vmin_h = heat_data["prix_m2"].min(); vmax_h = heat_data["prix_m2"].max()
        if vmin_h < vmax_h:
            heat_data["w"] = (heat_data["prix_m2"] - vmin_h) / (vmax_h - vmin_h)
        else:
            heat_data["w"] = 1.0
        hm_fg = folium.FeatureGroup(name="🌡️ pression foncière : densité des transactions", show=False)
        HeatMap(
            data=heat_data[["latitude", "longitude", "w"]].values.tolist(),
            radius=20, blur=15, min_opacity=0.3,
            gradient={0.2: "#00d4ff", 0.5: "#ffdd00", 0.8: "#ff6600", 1.0: "#ff0055"},
        ).add_to(hm_fg)
        hm_fg.add_to(m)

    # Polygones micro-marchés
    poly_fg = folium.FeatureGroup(name="🗺️ Micro-marchés", show=True)
    for cid in sorted(data[data["cluster"] >= 0]["cluster"].unique()):
        pts = data[data["cluster"] == cid][["latitude", "longitude"]].values
        if len(pts) < 3: continue
        try:
            hull = ConvexHull(pts)
            hull_pts = pts[hull.vertices].tolist(); hull_pts.append(hull_pts[0])
            color = c_color(cid)
            sub = data[data["cluster"] == cid]
            med = sub["valeur_fonciere"].median()
            med_m2v = sub["prix_m2"].median()
            med_m2s = f"{med_m2v:,.0f} €/m²" if not np.isnan(med_m2v) else "—"
            popup_html = f"""
            <div style="font-family:'Segoe UI',Arial,sans-serif; min-width:210px; color:#222;">
              <div style="background:{color};color:#000;padding:8px 12px;border-radius:6px 6px 0 0;font-weight:700;font-size:14px;">Micro-marché {cid}</div>
              <div style="padding:10px 12px;background:#f9f9f9;border-radius:0 0 6px 6px;">
                <table style="width:100%;font-size:13px;border-collapse:collapse;">
                  <tr><td style="color:#666;padding:3px 0;">Transactions</td><td style="font-weight:600;text-align:right;">{len(sub)}</td></tr>
                  <tr><td style="color:#666;padding:3px 0;">Prix médian</td><td style="font-weight:600;text-align:right;">{med:,.0f} €</td></tr>
                  <tr><td style="color:#666;padding:3px 0;">Prix/m² médian</td><td style="font-weight:600;text-align:right;">{med_m2s}</td></tr>
                </table>
              </div>
            </div>"""
            folium.Polygon(
                locations=hull_pts, color=color,
                fill=True, fill_color=color, fill_opacity=0.10, weight=2,
                popup=folium.Popup(popup_html, max_width=250),
                tooltip=f"<b style='color:{color}'>Micro-marché {cid}</b> · {len(sub)} tx · {med:,.0f} €",
            ).add_to(poly_fg)
        except Exception:
            pass
    poly_fg.add_to(m)

    # Points par année
    YEAR_ICONS = {2020:"🔵",2021:"🟢",2022:"🟡",2023:"🟠",2024:"🔴",2025:"🟣"}
    years = sorted(data["annee"].dropna().unique().tolist())
    for year in years:
        year_int = int(year)
        fg = folium.FeatureGroup(name=f"{YEAR_ICONS.get(year_int,'•')} {year_int}", show=True)
        sub_year = data[data["annee"] == year]
        for _, row in sub_year.iterrows():
            cid = int(row.get("cluster", -1))
            color = price_color(row["prix_m2"])
            zone_label = f"Micro-marché {cid}" if cid >= 0 else "Isolé"
            sb = row.get("surface_reelle_bati")
            surface_s = f"{float(sb):.0f} m² bâti" if pd.notna(sb) and float(sb) > 0 else "—"
            prix_m2_s = f"{row['prix_m2']:,.0f} €/m²" if pd.notna(row.get("prix_m2")) else "—"
            adresse = " ".join(filter(lambda x: x and str(x) != "nan", [
                str(row.get("adresse_numero","") or ""),
                str(row.get("adresse_nom_voie","") or ""),
            ])).strip() or "Adresse inconnue"
            date_s = row["date_mutation"].strftime("%d/%m/%Y") if pd.notna(row.get("date_mutation")) else "—"
            type_s = str(row.get("type_local","") or "—")
            pieces = row.get("nombre_pieces_principales", None)
            pieces_s = f"{int(pieces)} pce{'s' if pieces > 1 else ''}" if pieces and pd.notna(pieces) and pieces > 0 else ""
            is_ventile = bool(row.get("is_ventile", False))
            val_totale = row.get("valeur_fonciere_totale", np.nan)
            ventile_note = ""
            if is_ventile and pd.notna(val_totale):
                ref_source = str(row.get("ventil_ref_source", "global"))
                total_theo = row.get("ventil_total_theorique", np.nan)
                breakdown_str = row.get("ventil_breakdown", "")
                if ref_source == "parcelle":
                    source_label = "médiane de la parcelle"
                elif ref_source.startswith("zone_"):
                    source_label = f"médiane Zone {ref_source.split('_')[1]} (micromarché)"
                else:
                    source_label = "médiane globale commune (fallback)"
                comp_rows = ""
                try:
                    components = json.loads(breakdown_str)
                    for comp in components:
                        tl_disp = str(comp.get("type", ""))
                        if len(tl_disp) > 22:
                            tl_disp = tl_disp[:20] + "…"
                        s_v = comp.get("surface")
                        p_v = comp.get("m2_ref")
                        t_v = comp.get("theorique")
                        r_v = comp.get("ventile")
                        s_s = f"{s_v:.0f} m²"    if s_v is not None else "—"
                        p_s = f"{p_v:,.0f} €/m²" if p_v is not None else "—"
                        t_s = f"{t_v:,.0f} €"    if t_v is not None else "—"
                        r_s = f"{r_v:,.0f} €"    if r_v is not None else "—"
                        comp_rows += (
                            f"<tr>"
                            f"<td style='padding:2px 4px;color:#ddd;white-space:nowrap;'>{tl_disp}</td>"
                            f"<td style='padding:2px 4px;text-align:right;'>{s_s}</td>"
                            f"<td style='padding:2px 4px;text-align:right;'>{p_s}</td>"
                            f"<td style='padding:2px 4px;text-align:right;color:#bbb;'>{t_s}</td>"
                            f"<td style='padding:2px 4px;text-align:right;font-weight:700;color:#ff9900;'>{r_s}</td>"
                            f"</tr>"
                        )
                except Exception:
                    pass
                total_theo_s = f"{total_theo:,.0f} €" if pd.notna(total_theo) else "—"
                ventile_note = (
                    f"<div style='font-size:10px;color:#ff9900;margin-top:6px;"
                    f"background:rgba(255,153,0,0.08);padding:6px 8px;border-radius:4px;"
                    f"border-left:3px solid #ff9900;line-height:1.6;'>"
                    f"<b>⚖️ Vente mixte</b> — Prix total DVF&nbsp;: <b>{float(val_totale):,.0f} €</b><br>"
                    f"<span style='color:#aaa;font-style:italic;'>Réf.&nbsp;: {source_label}</span>"
                    f"<table style='width:100%;border-collapse:collapse;margin-top:5px;font-size:9.5px;color:#bbb;'>"
                    f"<tr style='border-bottom:1px solid rgba(255,153,0,0.3);'>"
                    f"<th style='text-align:left;padding:2px 4px;font-weight:600;'>Type</th>"
                    f"<th style='text-align:right;padding:2px 4px;font-weight:600;'>Surface</th>"
                    f"<th style='text-align:right;padding:2px 4px;font-weight:600;'>€/m² réf.</th>"
                    f"<th style='text-align:right;padding:2px 4px;font-weight:600;'>Valeur théor.</th>"
                    f"<th style='text-align:right;padding:2px 4px;font-weight:600;'>Part ventilée</th>"
                    f"</tr>"
                    f"{comp_rows}"
                    f"<tr style='border-top:1px solid rgba(255,153,0,0.3);color:#aaa;'>"
                    f"<td colspan='3' style='padding:2px 4px;'>Total théorique</td>"
                    f"<td style='padding:2px 4px;text-align:right;color:#ddd;font-weight:600;'>{total_theo_s}</td>"
                    f"<td style='padding:2px 4px;text-align:right;color:#ddd;font-weight:600;'>{float(val_totale):,.0f} €</td>"
                    f"</tr>"
                    f"</table>"
                    f"</div>"
                )
            jitter_note = ""
            if abs(row.get("lat_j", row["latitude"]) - row["latitude"]) > 1e-8 or abs(row.get("lon_j", row["longitude"]) - row["longitude"]) > 1e-8:
                jitter_note = "<div style='font-size:10px;color:#f90;margin-top:4px;'>⚠️ Position légèrement décalée (adresse groupée)</div>"
            popup_html = f"""
            <div style="font-family:'Segoe UI',Arial,sans-serif; min-width:220px; color:#222;">
              <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:10px 14px;border-radius:6px 6px 0 0;">
                <div style="font-size:13px;font-weight:700;">{adresse}</div>
                <div style="font-size:11px;opacity:.75;margin-top:2px;">{type_s} {('· '+pieces_s) if pieces_s else ''}</div>
              </div>
              <div style="padding:12px 14px;background:#fdfdfd;border-radius:0 0 6px 6px;">
                <div style="font-size:22px;font-weight:800;color:#1a1a2e;">{row['valeur_fonciere']:,.0f} <span style="font-size:14px;color:#555;">€</span></div>
                <div style="font-size:12px;color:#666;margin-bottom:8px;">{surface_s} · <span style="color:{color};font-weight:600;">{prix_m2_s}</span></div>
                <hr style="margin:8px 0;border:none;border-top:1px solid #eee;">
                <table style="width:100%;font-size:12px;color:#555;">
                  <tr><td>Date</td><td style="text-align:right;font-weight:600;color:#333;">{date_s}</td></tr>
                  <tr><td>Micro-marché</td><td style="text-align:right;font-weight:600;color:{color};">{zone_label}</td></tr>
                </table>
                {ventile_note}
                {jitter_note}
              </div>
            </div>"""
            folium.CircleMarker(
                location=[row.get("lat_j", row["latitude"]), row.get("lon_j", row["longitude"])],
                radius=5, color="#ffffff22", fill=True,
                fill_color=color, fill_opacity=0.85, weight=0.5,
                popup=folium.Popup(popup_html, max_width=270),
                tooltip=f"<span style='font-size:12px;'><b>{row['valeur_fonciere']:,.0f} €</b> · {prix_m2_s} · {date_s}</span>",
            ).add_to(fg)
        fg.add_to(m)

    colormap.caption = "Prix au m² (€)"
    colormap.add_to(m)
    folium.LayerControl(collapsed=False, position="topright").add_to(m)

    n_clusters = int(data[data["cluster"] >= 0]["cluster"].nunique()) if "cluster" in data.columns else 0
    med_prix = data["valeur_fonciere"].median()
    med_m2 = data["prix_m2"].median()

    # Dashboard
    dashboard = f"""
<style>
  #dash{dept_code} {{
    position: fixed; top: 10px; left: 10px; z-index: 9999;
    background: linear-gradient(135deg, rgba(10,10,30,0.97), rgba(20,20,50,0.97));
    color: #e8e8f0; font-family: 'Segoe UI', Arial, sans-serif;
    border-radius: 12px; padding: 0; width: 290px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    border: 1px solid rgba(255,255,255,0.1); overflow: hidden;
  }}
  #dash{dept_code}-header {{
    background: linear-gradient(90deg, {tc["color"]}22, rgba(255,255,255,0.03));
    padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1);
  }}
  #dash{dept_code}-header h2 {{ margin: 0; font-size: 14px; font-weight: 700; color: #fff; }}
  #dash{dept_code}-header p {{ margin: 3px 0 0; font-size: 11px; color: rgba(255,255,255,.5); }}
  #dash{dept_code}-body {{ padding: 12px 16px; }}
  .kpi-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }}
  .kpi {{ background: rgba(255,255,255,0.06); border-radius: 8px; padding: 9px; text-align: center; border: 1px solid rgba(255,255,255,0.08); }}
  .kpi .val {{ font-size: 16px; font-weight: 800; color: {tc["color"]}; }}
  .kpi .lbl {{ font-size: 10px; color: rgba(255,255,255,.45); margin-top: 2px; text-transform:uppercase; letter-spacing:.5px; }}
  #dash{dept_code}-toggle {{ position: absolute; top: 8px; right: 12px; cursor: pointer; color: rgba(255,255,255,.5); font-size: 16px; user-select:none; }}
  #dash{dept_code}-toggle:hover {{ color: #fff; }}
  .back-link {{ display:block; margin-top: 10px; padding: 7px 10px; border-radius: 7px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.5); font-size: 11px; text-decoration: none; text-align: center; transition: all 0.2s; }}
  .back-link:hover {{ background: rgba(255,255,255,0.1); color: #fff; }}
</style>
<div id="dash{dept_code}">
  <div id="dash{dept_code}-header">
    <span id="dash{dept_code}-toggle" onclick="
      var b=document.getElementById('dash{dept_code}-body');
      var t=document.getElementById('dash{dept_code}-toggle');
      if(b.style.display==='none'){{b.style.display='block';t.textContent='▲'}}
      else{{b.style.display='none';t.textContent='▼'}}
    ">▲</span>
    <h2>{tc["emoji"]} {tc["label"]} · {dept_nom} ({dept_code})</h2>
    <p>2020 – 2025 · Source DVF data.gouv.fr</p>
  </div>
  <div id="dash{dept_code}-body">
    <div class="kpi-grid">
      <div class="kpi"><div class="val">{len(data):,}</div><div class="lbl">Transactions</div></div>
      <div class="kpi"><div class="val">{n_clusters}</div><div class="lbl">Micro-marchés</div></div>
      <div class="kpi"><div class="val">{med_prix/1000:.0f}k€</div><div class="lbl">Prix médian</div></div>
      <div class="kpi"><div class="val">{med_m2:,.0f}€</div><div class="lbl">Médiane/m²</div></div>
    </div>
    <a href="index.html" class="back-link">← Vue d'ensemble {dept_nom}</a>
    <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);font-size:10px;color:rgba(255,255,255,.25);text-align:center;">
      © 2026 Samuel Bruno · datamerry.com
    </div>
  </div>
</div>"""

    m.get_root().html.add_child(folium.Element(dashboard))
    m.save(out_path)

    # Post-process CSS
    with open(out_path, "r") as f: html = f.read()
    extra = """<style>
  .leaflet-popup-content-wrapper { border-radius:8px!important; padding:0!important; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.35)!important; }
  .leaflet-popup-content { margin:0!important; }
  .leaflet-control-layers { background:rgba(15,15,35,0.95)!important; color:#ddd!important; border:1px solid rgba(255,255,255,0.15)!important; border-radius:8px!important; }
  .leaflet-control-layers label { color:#ccc!important; }
  #copyright-banner { position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(10,10,20,0.75);color:rgba(255,255,255,0.7);font-family:'Segoe UI',Arial,sans-serif;font-size:11px;padding:4px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(4px);pointer-events:none; }
</style>"""
    html = html.replace("</head>", extra + "</head>")
    html = html.replace("</body>", '<div id="copyright-banner">© 2026 Samuel Bruno — datamerry.com</div>\n</body>')
    with open(out_path, "w") as f: f.write(html)
    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f"  ✅ {out_path} ({size_mb:.1f} MB)")

def make_index(cfg, stats, out_dir):
    dept_nom = cfg["nom"]
    dept_code = cfg["code"]
    color = cfg["color"]
    total_tx = stats["total"]
    n_communes = stats.get("n_communes", "—")
    med_prix = stats.get("med_prix", 0)
    med_m2 = stats.get("med_m2", 0)

    cards = ""
    for type_local, tc in TYPE_CONFIG.items():
        n = stats["by_type"].get(type_local, 0)
        n_clusters = stats["clusters_by_type"].get(type_local, 0)
        if n == 0: continue
        cards += f"""
    <a href="{tc['file']}" class="card">
      <div class="card-icon">{tc['emoji']}</div>
      <div class="card-body">
        <div class="card-title">{tc['label']}</div>
        <div class="card-desc">{n:,} transactions · {n_clusters} micro-marchés</div>
      </div>
      <div class="card-arrow">→</div>
    </a>"""

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analyse Foncière · {dept_nom} ({dept_code})</title>
  <meta name="description" content="Carte interactive du marché immobilier en {dept_nom} · {total_tx:,} transactions DVF 2020-2025 · Micro-marchés HDBSCAN · datamerry">
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: 'Segoe UI', Arial, sans-serif; background: linear-gradient(135deg, #0a0a1e 0%, #0d1b2a 50%, #0a0a1e 100%); min-height: 100vh; color: #e8e8f0; display: flex; flex-direction: column; align-items: center; padding: 60px 20px; }}
    .header {{ text-align: center; margin-bottom: 50px; }}
    .tag {{ display: inline-block; background: {color}22; color: {color}; border: 1px solid {color}55; border-radius: 20px; padding: 4px 16px; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 20px; }}
    .header h1 {{ font-size: clamp(28px, 5vw, 48px); font-weight: 800; background: linear-gradient({cfg['gradient'][0]}, {cfg['gradient'][1]}, {cfg['gradient'][2]}, {cfg['gradient'][3]}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1.2; margin-bottom: 16px; }}
    .header p {{ font-size: 16px; color: rgba(255,255,255,0.5); max-width: 520px; margin: 0 auto; line-height: 1.6; }}
    .stats-bar {{ display: flex; gap: 40px; justify-content: center; margin-bottom: 50px; flex-wrap: wrap; }}
    .stat {{ text-align: center; }}
    .stat .val {{ font-size: 30px; font-weight: 800; color: {color}; }}
    .stat .lbl {{ font-size: 11px; color: rgba(255,255,255,.4); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }}
    .cards {{ display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 600px; }}
    .card {{ display: flex; align-items: center; gap: 20px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 20px 24px; text-decoration: none; color: inherit; transition: all 0.2s ease; cursor: pointer; }}
    .card:hover {{ background: {color}11; border-color: {color}44; transform: translateY(-2px); box-shadow: 0 8px 32px {color}22; }}
    .card-icon {{ font-size: 30px; flex-shrink: 0; }}
    .card-body {{ flex: 1; }}
    .card-title {{ font-size: 17px; font-weight: 700; color: #fff; margin-bottom: 3px; }}
    .card-desc {{ font-size: 13px; color: rgba(255,255,255,0.45); }}
    .card-arrow {{ font-size: 18px; color: {color}66; flex-shrink: 0; }}
    .card:hover .card-arrow {{ color: {color}; }}
    .datamerry-link {{ margin-top: 30px; display: inline-flex; align-items: center; gap: 8px; padding: 10px 20px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.04); color: rgba(255,255,255,0.5); text-decoration: none; font-size: 13px; transition: all 0.2s; }}
    .datamerry-link:hover {{ background: rgba(255,255,255,0.08); color: #fff; border-color: rgba(255,255,255,0.25); }}
    .method-badge {{ display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 10px 18px; margin-top: 30px; font-size: 13px; color: rgba(255,255,255,0.5); }}
    .method-badge span {{ color: {color}; font-weight: 600; }}
    .footer {{ margin-top: 50px; text-align: center; font-size: 11px; color: rgba(255,255,255,0.2); line-height: 1.8; }}
  </style>
</head>
<body>
  <div class="header">
    <div class="tag">Analyse Foncière · Département {dept_code}</div>
    <h1>Marché Immobilier<br>{dept_nom}</h1>
    <p>Cartographie interactive des transactions immobilières<br>2020 – 2025 · Source : Demandes de Valeurs Foncières</p>
  </div>
  <div class="stats-bar">
    <div class="stat"><div class="val">{total_tx:,}</div><div class="lbl">Transactions</div></div>
    <div class="stat"><div class="val">2020–25</div><div class="lbl">Période</div></div>
    <div class="stat"><div class="val">{med_m2:,.0f}€</div><div class="lbl">Prix médian/m²</div></div>
    <div class="stat"><div class="val">{n_communes}</div><div class="lbl">Communes</div></div>
  </div>
  <div class="cards">{cards}</div>
  <a href="https://datamerry.com/dept/{dept_code}" class="datamerry-link">← Retour sur datamerry.com</a>
  <div class="method-badge">Algorithme · <span>HDBSCAN</span> · Géospatial · Données DVF open data</div>
  <div class="footer">
    © 2026 Samuel Bruno · Analyse Foncière · {dept_nom} ({dept_code})<br>
    Source : data.gouv.fr · DVF · <a href="https://datamerry.com" style="color:rgba(255,255,255,0.3);">datamerry.com</a>
  </div>
</body>
</html>"""
    with open(os.path.join(out_dir, "index.html"), "w") as f:
        f.write(html)
    print(f"  ✅ index.html généré")

def main():
    if len(sys.argv) < 2:
        print("Usage: python pipeline_dept.py <CODE_DEPT>")
        print("Codes disponibles:", list(DEPT_CONFIG.keys()))
        sys.exit(1)

    dept_code = sys.argv[1].strip()
    if dept_code not in DEPT_CONFIG:
        print(f"Département {dept_code} inconnu. Disponibles: {list(DEPT_CONFIG.keys())}")
        sys.exit(1)

    cfg = DEPT_CONFIG[dept_code]
    out_dir = f"/home/user/maps_{dept_code}"
    os.makedirs(out_dir, exist_ok=True)
    print(f"\n{'='*60}")
    print(f"  Pipeline : {cfg['nom']} ({dept_code})")
    print(f"  Sortie   : {out_dir}")
    print(f"{'='*60}")

    # Charger les données
    print("\n[1/3] Chargement des données...")
    all_data = load_data(cfg)

    stats = {
        "total": len(all_data),
        "med_prix": all_data["valeur_fonciere"].median(),
        "med_m2": all_data["prix_m2"].median() if all_data["prix_m2"].notna().any() else 0,
        "n_communes": all_data["code_commune"].nunique() if "code_commune" in all_data.columns else "—",
        "by_type": {},
        "clusters_by_type": {},
    }

    print("\n[2/3] Génération des cartes par type...")
    # Normaliser type_local : le libellé DVF réel est "Local industriel, commercial ou assimilé"
    # "Dépendance" (caves, parkings ~30K€) est exclu pour ne pas fausser la médiane commerces
    COMMERCIAL_TYPES = {
        "Local commercial",
        "Local industriel, commercial ou assimilé",
        "Local industriel. commercial ou assimilé",  # variante avec point (certains exports DVF)
    }
    all_data["type_local_norm"] = all_data["type_local"].apply(
        lambda x: "Local commercial" if str(x) in COMMERCIAL_TYPES else str(x)
    )

    for type_local in ["Appartement", "Maison", "Local commercial"]:
        sub = all_data[all_data["type_local_norm"] == type_local].copy()
        if len(sub) < 50:
            print(f"  Skip {type_local} (seulement {len(sub)} lignes)")
            continue
        print(f"\n  ── {type_local} : {len(sub)} transactions")
        stats["by_type"][type_local] = len(sub)
        min_cs = 15 if len(sub) > 1000 else 5
        sub = run_hdbscan(sub, min_cluster_size=min_cs)
        stats["clusters_by_type"][type_local] = int(sub[sub["cluster"] >= 0]["cluster"].nunique())
        tc = TYPE_CONFIG.get(type_local, {"file": f"carte_{type_local.lower()}.html"})
        out_path = os.path.join(out_dir, tc["file"])
        make_map(sub, cfg, type_local, out_path)

    print("\n[3/3] Génération index.html...")
    make_index(cfg, stats, out_dir)

    print(f"\n✅ Pipeline terminé pour {cfg['nom']} ({dept_code})")
    print(f"   Fichiers dans : {out_dir}")
    print(f"   Prêt pour GitHub Pages")

if __name__ == "__main__":
    main()
