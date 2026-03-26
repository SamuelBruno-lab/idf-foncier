#!/usr/bin/env python3
"""
pipeline_commune.py — Cartes foncières par commune (modèle pipeline_dept fidèle)
=================================================================================
Reproduit fidèlement le pipeline département (pipeline_dept.py) à l'échelle de
chaque commune : téléchargement DVF data.gouv.fr, nettoyage, agrégation mutations,
ventilation mixtes, HDBSCAN micro-marchés, cartes Folium par type + index.html.

Usage:
    python pipeline_commune.py 92012                   # une commune (Boulogne-Billancourt)
    python pipeline_commune.py --all                   # les 30 communes IDF
    python pipeline_commune.py --all --download        # télécharger DVF + traiter
    python pipeline_commune.py --all --skip-existing   # sauter les communes déjà générées
    python pipeline_commune.py --dry-run               # afficher les communes seulement
    python pipeline_commune.py 93066 93048 94028       # plusieurs communes

Sortie: maps/<code_commune>/  (carte_appartements.html, carte_maisons.html,
        carte_commerces.html, index.html)

Dépendances: pip install pandas numpy hdbscan scipy folium branca
"""
import sys
import os
import argparse
import time

# ── Réutiliser TOUTES les fonctions lourdes de pipeline_dept.py ──────────────
from pipeline_dept import (
    TYPE_CONFIG,
    CLUSTER_COLORS,
    c_color,
    aggregate_mutations,
    run_preliminary_clustering,
    assign_cluster_to_mixed,
    ventiler_mutations_mixtes,
    run_hdbscan,
    apply_jitter,
    make_map,
    make_index,
)

import pandas as pd
import numpy as np

# ── Top 30 communes IDF ─────────────────────────────────────────────────────
COMMUNES_TOP30 = [
    {"code": "75056", "nom": "Paris",                   "dept": "75", "deptNom": "Paris",              "color": "#ef4444", "lat": 48.8566, "lon": 2.3522, "zoom": 12},
    {"code": "92012", "nom": "Boulogne-Billancourt",    "dept": "92", "deptNom": "Hauts-de-Seine",     "color": "#00d4ff", "lat": 48.8397, "lon": 2.2399, "zoom": 14},
    {"code": "93066", "nom": "Saint-Denis",             "dept": "93", "deptNom": "Seine-Saint-Denis",  "color": "#00ff88", "lat": 48.9362, "lon": 2.3574, "zoom": 14},
    {"code": "93048", "nom": "Montreuil",               "dept": "93", "deptNom": "Seine-Saint-Denis",  "color": "#00ff88", "lat": 48.8638, "lon": 2.4484, "zoom": 14},
    {"code": "95018", "nom": "Argenteuil",              "dept": "95", "deptNom": "Val-d'Oise",         "color": "#f59e0b", "lat": 48.9472, "lon": 2.2467, "zoom": 14},
    {"code": "92050", "nom": "Nanterre",                "dept": "92", "deptNom": "Hauts-de-Seine",     "color": "#00d4ff", "lat": 48.8924, "lon": 2.2071, "zoom": 14},
    {"code": "94028", "nom": "Créteil",                 "dept": "94", "deptNom": "Val-de-Marne",       "color": "#a78bfa", "lat": 48.7911, "lon": 2.4628, "zoom": 14},
    {"code": "94081", "nom": "Vitry-sur-Seine",         "dept": "94", "deptNom": "Val-de-Marne",       "color": "#a78bfa", "lat": 48.7875, "lon": 2.3929, "zoom": 14},
    {"code": "92025", "nom": "Colombes",                "dept": "92", "deptNom": "Hauts-de-Seine",     "color": "#00d4ff", "lat": 48.9227, "lon": 2.2536, "zoom": 14},
    {"code": "92004", "nom": "Asnières-sur-Seine",      "dept": "92", "deptNom": "Hauts-de-Seine",     "color": "#00d4ff", "lat": 48.9119, "lon": 2.2882, "zoom": 14},
    {"code": "78646", "nom": "Versailles",              "dept": "78", "deptNom": "Yvelines",           "color": "#6366f1", "lat": 48.8014, "lon": 2.1301, "zoom": 14},
    {"code": "92026", "nom": "Courbevoie",              "dept": "92", "deptNom": "Hauts-de-Seine",     "color": "#00d4ff", "lat": 48.8966, "lon": 2.2567, "zoom": 14},
    {"code": "93001", "nom": "Aubervilliers",           "dept": "93", "deptNom": "Seine-Saint-Denis",  "color": "#00ff88", "lat": 48.9136, "lon": 2.3828, "zoom": 14},
    {"code": "93005", "nom": "Aulnay-sous-Bois",        "dept": "93", "deptNom": "Seine-Saint-Denis",  "color": "#00ff88", "lat": 48.9381, "lon": 2.4976, "zoom": 14},
    {"code": "92063", "nom": "Rueil-Malmaison",         "dept": "92", "deptNom": "Hauts-de-Seine",     "color": "#00d4ff", "lat": 48.8769, "lon": 2.1894, "zoom": 14},
    {"code": "94017", "nom": "Champigny-sur-Marne",     "dept": "94", "deptNom": "Val-de-Marne",       "color": "#a78bfa", "lat": 48.8176, "lon": 2.5159, "zoom": 14},
    {"code": "77284", "nom": "Meaux",                   "dept": "77", "deptNom": "Seine-et-Marne",     "color": "#f97316", "lat": 48.9601, "lon": 2.8781, "zoom": 14},
    {"code": "93029", "nom": "Drancy",                  "dept": "93", "deptNom": "Seine-Saint-Denis",  "color": "#00ff88", "lat": 48.9304, "lon": 2.4504, "zoom": 14},
    {"code": "92040", "nom": "Issy-les-Moulineaux",     "dept": "92", "deptNom": "Hauts-de-Seine",     "color": "#00d4ff", "lat": 48.8239, "lon": 2.2704, "zoom": 14},
    {"code": "93051", "nom": "Noisy-le-Grand",          "dept": "93", "deptNom": "Seine-Saint-Denis",  "color": "#00ff88", "lat": 48.8481, "lon": 2.5527, "zoom": 14},
    {"code": "92044", "nom": "Levallois-Perret",        "dept": "92", "deptNom": "Hauts-de-Seine",     "color": "#00d4ff", "lat": 48.8937, "lon": 2.2874, "zoom": 14},
    {"code": "94041", "nom": "Ivry-sur-Seine",          "dept": "94", "deptNom": "Val-de-Marne",       "color": "#a78bfa", "lat": 48.8122, "lon": 2.3847, "zoom": 14},
    {"code": "95127", "nom": "Cergy",                   "dept": "95", "deptNom": "Val-d'Oise",         "color": "#f59e0b", "lat": 49.0363, "lon": 2.0630, "zoom": 14},
    {"code": "78586", "nom": "Sartrouville",            "dept": "78", "deptNom": "Yvelines",           "color": "#6366f1", "lat": 48.9376, "lon": 2.1593, "zoom": 14},
    {"code": "92002", "nom": "Antony",                  "dept": "92", "deptNom": "Hauts-de-Seine",     "color": "#00d4ff", "lat": 48.7533, "lon": 2.2983, "zoom": 14},
    {"code": "93031", "nom": "Épinay-sur-Seine",        "dept": "93", "deptNom": "Seine-Saint-Denis",  "color": "#00ff88", "lat": 48.9530, "lon": 2.3107, "zoom": 14},
    {"code": "93010", "nom": "Bondy",                   "dept": "93", "deptNom": "Seine-Saint-Denis",  "color": "#00ff88", "lat": 48.9026, "lon": 2.4842, "zoom": 14},
    {"code": "92023", "nom": "Clamart",                 "dept": "92", "deptNom": "Hauts-de-Seine",     "color": "#00d4ff", "lat": 48.8027, "lon": 2.2667, "zoom": 14},
    {"code": "94033", "nom": "Fontenay-sous-Bois",      "dept": "94", "deptNom": "Val-de-Marne",       "color": "#a78bfa", "lat": 48.8518, "lon": 2.4770, "zoom": 14},
    {"code": "93071", "nom": "Sevran",                  "dept": "93", "deptNom": "Seine-Saint-Denis",  "color": "#00ff88", "lat": 48.9445, "lon": 2.5254, "zoom": 14},
]

COMMUNES_MAP = {c["code"]: c for c in COMMUNES_TOP30}

# ── Gradients par département (pour index.html) ─────────────────────────────
DEPT_GRADIENTS = {
    "75": ("90deg", "#00d4ff", "#ffffff", "#ef4444"),
    "77": ("90deg", "#00d4ff", "#ffffff", "#f97316"),
    "78": ("90deg", "#00d4ff", "#ffffff", "#6366f1"),
    "91": ("90deg", "#00d4ff", "#ffffff", "#10b981"),
    "92": ("90deg", "#00d4ff", "#ffffff", "#00d4ff"),
    "93": ("90deg", "#00d4ff", "#ffffff", "#00ff88"),
    "94": ("90deg", "#00d4ff", "#ffffff", "#a78bfa"),
    "95": ("90deg", "#00d4ff", "#ffffff", "#f59e0b"),
}


def build_commune_cfg(commune_info):
    """Construit un objet cfg compatible avec pipeline_dept.make_map / make_index."""
    dept = commune_info["dept"]
    gradient = DEPT_GRADIENTS.get(dept, ("90deg", "#00d4ff", "#ffffff", commune_info["color"]))
    return {
        "nom": commune_info["nom"],
        "code": commune_info["code"],
        "dept": dept,
        "deptNom": commune_info["deptNom"],
        "color": commune_info["color"],
        "gradient": gradient,
        "zoom": commune_info.get("zoom", 14),
        "csv_years": {},
        "csv_global": f"/home/user/dvf_{dept}.csv",
    }


def load_commune_data(cfg, commune_code):
    """Charge les données DVF d'un département, filtre sur une commune,
    applique exactement le même pipeline de nettoyage que pipeline_dept.load_data."""
    csv_path = cfg["csv_global"]
    print(f"  Lecture {csv_path}...")
    if not os.path.exists(csv_path):
        raise RuntimeError(f"CSV manquant : {csv_path} — relancer avec --download ou fournir le fichier")

    data = pd.read_csv(csv_path, low_memory=False)
    print(f"  Brut : {len(data)} lignes")

    # Filtrer sur la commune
    # Paris : code_commune dans DVF = arrondissements 75101-75120, pas 75056
    if "code_commune" in data.columns:
        data["code_commune"] = data["code_commune"].astype(str).str.zfill(5)
        if commune_code == "75056":
            data = data[data["code_commune"].str.startswith("751")]
            print(f"  Filtré Paris (arrondissements 75101-75120) : {len(data)} lignes")
        else:
            data = data[data["code_commune"] == commune_code]
            print(f"  Filtré commune {commune_code} : {len(data)} lignes")
    else:
        print("  ⚠ Pas de colonne code_commune — utilisation de toutes les données")

    if len(data) == 0:
        raise RuntimeError(f"Aucune donnée pour la commune {commune_code}")

    # Date + filtre 2024-2025
    if "date_mutation" in data.columns:
        data["date_mutation"] = pd.to_datetime(data["date_mutation"], errors="coerce")
        if "annee" not in data.columns:
            data["annee"] = data["date_mutation"].dt.year.fillna(2024).astype(int)
        before = len(data)
        if commune_code == "75056":
            data = data[data["date_mutation"].dt.year == 2025]
            print(f"  Filtre Paris 2025 only : {before} → {len(data)}")
        else:
            data = data[data["date_mutation"].dt.year.isin([2024, 2025])]
            print(f"  Filtre 2024+2025 : {before} → {len(data)}")
        data["annee"] = data["date_mutation"].dt.year.astype(int)
    else:
        if "annee" not in data.columns:
            data["annee"] = 2024

    # Nettoyage standard (identique pipeline_dept)
    data = data.dropna(subset=["latitude", "longitude", "valeur_fonciere"])
    data = data[data["valeur_fonciere"] > 1]
    data["valeur_fonciere"] = pd.to_numeric(data["valeur_fonciere"], errors="coerce")
    data["surface_reelle_bati"] = pd.to_numeric(data.get("surface_reelle_bati", pd.Series(dtype=float)), errors="coerce")
    if "surface_terrain" in data.columns:
        data["surface_terrain"] = pd.to_numeric(data["surface_terrain"], errors="coerce")
    data["date_mutation"] = pd.to_datetime(data.get("date_mutation", pd.Series(dtype=str)), errors="coerce")

    # Exclusion caves/dépendances
    if "type_local" in data.columns:
        data = data[data["type_local"] != "Dépendance"]
    if "id_mutation" in data.columns and "id_parcelle" in data.columns:
        data = data.drop_duplicates(subset=["id_mutation", "id_parcelle", "type_local", "surface_reelle_bati"])
    # Exclusion VEFA maisons
    if "nature_mutation" in data.columns and "type_local" in data.columns:
        data = data[~((data["nature_mutation"] == "Vente en l'état futur d'achèvement") &
                      (data["type_local"] == "Maison"))]

    # Agrégation mutations pures/mixtes
    data, mixed_raw = aggregate_mutations(data)

    # Prix/m²
    if "surface_terrain" in data.columns and "type_local" in data.columns:
        data["prix_m2"] = np.where(
            (data["type_local"].isin(["Appartement", "Maison"])) & (data["surface_reelle_bati"] > 0),
            data["valeur_fonciere"] / data["surface_reelle_bati"],
            np.where(data["surface_reelle_bati"] > 0, data["valeur_fonciere"] / data["surface_reelle_bati"], np.nan),
        )
    else:
        data["prix_m2"] = np.where(
            data["surface_reelle_bati"] > 0,
            data["valeur_fonciere"] / data["surface_reelle_bati"],
            np.nan,
        )
    data = data.dropna(subset=["valeur_fonciere"])

    # Suppression outliers
    SEUIL_PRIX_M2_MAX = {"Maison": 9000, "Appartement": 12000,
                         "Local industriel. commercial ou assimilé": 12000,
                         "Local commercial": 12000}
    SEUIL_PRIX_M2_MIN = {"Maison": 500, "Appartement": 500,
                         "Local industriel. commercial ou assimilé": 500,
                         "Local commercial": 500}
    if "type_local" in data.columns:
        for tl, seuil in SEUIL_PRIX_M2_MAX.items():
            mask = (data["type_local"] == tl) & (data["prix_m2"] > seuil)
            n = mask.sum()
            if n:
                print(f"  Suppression {n} outliers {tl} > {seuil} €/m²")
            data = data[~mask]
        for tl, seuil in SEUIL_PRIX_M2_MIN.items():
            mask = (data["type_local"] == tl) & (data["prix_m2"] < seuil)
            n = mask.sum()
            if n:
                print(f"  Suppression {n} outliers {tl} < {seuil} €/m²")
            data = data[~mask]

    # Ventilation des mutations mixtes (identique pipeline_dept)
    pure_cluster_labels = run_preliminary_clustering(data, min_cluster_size=8, min_samples=2)
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
                if len(vals) >= 10:
                    median_m2_by_cluster_type[int(cid)][tl] = float(vals.median())

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

    global_median_m2_by_type = {}
    if "type_local" in data.columns:
        for tl in data["type_local"].dropna().unique():
            subset = data[(data["type_local"] == tl) & data["prix_m2"].notna() & (data["prix_m2"] > 0)]
            if len(subset) > 0:
                global_median_m2_by_type[tl] = float(subset["prix_m2"].median())

    if not mixed_raw.empty:
        mixed_raw = assign_cluster_to_mixed(mixed_raw, data, pure_cluster_labels)
        ventile_df = ventiler_mutations_mixtes(
            mixed_raw, median_m2_by_cluster_type, median_m2_by_parcelle_type,
            global_median_m2_by_type, min_parcelle_tx=5, seuil_m2_min=SEUIL_PRIX_M2_MIN,
        )
        if not ventile_df.empty:
            before = len(ventile_df)
            if "type_local" in ventile_df.columns:
                for tl, seuil in SEUIL_PRIX_M2_MAX.items():
                    ventile_df = ventile_df[~((ventile_df["type_local"] == tl) & (ventile_df["prix_m2"] > seuil))]
                for tl, seuil in SEUIL_PRIX_M2_MIN.items():
                    ventile_df = ventile_df[~((ventile_df["type_local"] == tl) & (ventile_df["prix_m2"] < seuil))]
            if len(ventile_df) < before:
                print(f"  Suppression {before - len(ventile_df)} ventilations aberrantes")
            data = pd.concat([data, ventile_df], ignore_index=True)
            print(f"  Total après ventilation : {len(data)} transactions")

    data["latitude"] = pd.to_numeric(data["latitude"], errors="coerce")
    data["longitude"] = pd.to_numeric(data["longitude"], errors="coerce")
    data = data.dropna(subset=["latitude", "longitude"])
    if "type_local" not in data.columns:
        data["type_local"] = "Appartement"
    print(f"  Total transactions chargées : {len(data)}")
    return data


def download_dept_csv(dept, dest):
    """Télécharge les CSV DVF data.gouv.fr pour un département (2020-2025)."""
    import gzip
    import io
    import httpx

    DVF_URL = "https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/departements/{dept}.csv.gz"
    DVF_YEARS = [2020, 2021, 2022, 2023, 2024, 2025]

    frames = []
    for year in DVF_YEARS:
        url = DVF_URL.format(year=year, dept=dept)
        print(f"    Téléchargement {url}...")
        try:
            resp = httpx.get(url, follow_redirects=True, timeout=120)
            resp.raise_for_status()
            with gzip.open(io.BytesIO(resp.content)) as f:
                df = pd.read_csv(f, low_memory=False)
                df["annee"] = year
                frames.append(df)
                print(f"      → {len(df):,} lignes")
        except Exception as e:
            print(f"      ⚠ {year}: {e}")

    if not frames:
        return False
    merged = pd.concat(frames, ignore_index=True)
    merged.to_csv(dest, index=False)
    print(f"    ✅ {dest} ({len(merged):,} lignes)")
    return True


def process_commune(commune_info, skip_existing=False):
    """Traite une commune : charge DVF, HDBSCAN, génère cartes par type + index."""
    code = commune_info["code"]
    nom = commune_info["nom"]
    dept = commune_info["dept"]

    out_dir = os.path.join(os.path.dirname(__file__), "maps", code)
    os.makedirs(out_dir, exist_ok=True)

    if skip_existing and os.path.exists(os.path.join(out_dir, "index.html")):
        print(f"  ⏭ {nom} ({code}) — déjà généré, skip")
        return True

    cfg = build_commune_cfg(commune_info)

    print(f"\n{'='*60}")
    print(f"  Commune : {nom} ({code}) — Dept {dept} ({commune_info['deptNom']})")
    print(f"  Sortie  : {out_dir}")
    print(f"{'='*60}")

    # Charger les données
    print("\n[1/3] Chargement des données...")
    try:
        all_data = load_commune_data(cfg, code)
    except RuntimeError as e:
        print(f"  ❌ {e}")
        return False

    if len(all_data) < 20:
        print(f"  ⚠ Seulement {len(all_data)} transactions — trop peu pour générer des cartes")
        return False

    stats = {
        "total": len(all_data),
        "med_prix": all_data["valeur_fonciere"].median(),
        "med_m2": all_data["prix_m2"].median() if all_data["prix_m2"].notna().any() else 0,
        "n_communes": 1,
        "by_type": {},
        "clusters_by_type": {},
    }

    # Normaliser type_local
    COMMERCIAL_TYPES = {
        "Local commercial",
        "Local industriel, commercial ou assimilé",
        "Local industriel. commercial ou assimilé",
    }
    all_data["type_local_norm"] = all_data["type_local"].apply(
        lambda x: "Local commercial" if str(x) in COMMERCIAL_TYPES else str(x)
    )

    print("\n[2/3] Génération des cartes par type...")
    for type_local in ["Appartement", "Maison", "Local commercial"]:
        sub = all_data[all_data["type_local_norm"] == type_local].copy()
        if len(sub) < 10:
            print(f"  Skip {type_local} (seulement {len(sub)} lignes)")
            continue
        print(f"\n  ── {type_local} : {len(sub)} transactions")
        stats["by_type"][type_local] = len(sub)
        # Adapter min_cluster_size à la taille commune (plus petit qu'un département)
        if len(sub) > 500:
            min_cs = 10
        elif len(sub) > 100:
            min_cs = 5
        else:
            min_cs = 3
        sub = run_hdbscan(sub, min_cluster_size=min_cs)
        stats["clusters_by_type"][type_local] = int(sub[sub["cluster"] >= 0]["cluster"].nunique())
        tc = TYPE_CONFIG.get(type_local, {"file": f"carte_{type_local.lower()}.html"})
        out_path = os.path.join(out_dir, tc["file"])
        make_map(sub, cfg, type_local, out_path)

    print("\n[3/3] Génération index.html...")
    make_index(cfg, stats, out_dir)

    print(f"\n✅ {nom} ({code}) — {stats['total']} transactions, {sum(stats['clusters_by_type'].values())} micro-marchés")
    return True


def main():
    parser = argparse.ArgumentParser(
        description="Pipeline commune — Cartes foncières HDBSCAN pour les 30 communes IDF"
    )
    parser.add_argument("codes", nargs="*", help="Code(s) INSEE des communes à traiter")
    parser.add_argument("--all", action="store_true", help="Traiter les 30 communes IDF")
    parser.add_argument("--download", action="store_true", help="Télécharger les CSV DVF manquants")
    parser.add_argument("--skip-existing", action="store_true", help="Sauter les communes déjà générées")
    parser.add_argument("--dry-run", action="store_true", help="Afficher les communes seulement")
    args = parser.parse_args()

    if args.all:
        communes = COMMUNES_TOP30
    elif args.codes:
        communes = []
        for code in args.codes:
            if code in COMMUNES_MAP:
                communes.append(COMMUNES_MAP[code])
            else:
                print(f"⚠ Commune {code} inconnue (pas dans le Top 30)")
        if not communes:
            print("Aucune commune valide.")
            sys.exit(1)
    else:
        parser.print_help()
        print("\nCommunes disponibles:")
        for c in COMMUNES_TOP30:
            print(f"  {c['code']}  {c['nom']:<30} ({c['deptNom']})")
        sys.exit(0)

    print("=" * 60)
    print(f"Pipeline Commune — {len(communes)} commune(s)")
    print("=" * 60)

    if args.dry_run:
        print(f"\n{'Code':<8} {'Commune':<30} {'Dept':<6} {'Département'}")
        print("-" * 70)
        for c in communes:
            print(f"{c['code']:<8} {c['nom']:<30} {c['dept']:<6} {c['deptNom']}")
        return

    # Téléchargement des CSV départementaux si demandé
    if args.download:
        depts_needed = sorted(set(c["dept"] for c in communes))
        print(f"\n[0] Téléchargement des CSV DVF pour {len(depts_needed)} département(s)...")
        for dept in depts_needed:
            dest = f"/home/user/dvf_{dept}.csv"
            if os.path.exists(dest) and os.path.getsize(dest) > 1_000_000:
                print(f"  {dept}: déjà présent ({os.path.getsize(dest) // 1_000_000} MB)")
                continue
            print(f"  {dept}: téléchargement...")
            download_dept_csv(dept, dest)

    # Traitement commune par commune
    t0 = time.time()
    results = {"ok": [], "fail": [], "skip": []}

    for i, commune in enumerate(communes, 1):
        print(f"\n{'━'*60}")
        print(f"  [{i}/{len(communes)}] {commune['nom']} ({commune['code']})")
        print(f"{'━'*60}")
        try:
            success = process_commune(commune, skip_existing=args.skip_existing)
            if success:
                results["ok"].append(commune["nom"])
            else:
                results["fail"].append(commune["nom"])
        except Exception as e:
            print(f"  ❌ Erreur : {e}")
            results["fail"].append(commune["nom"])

    elapsed = time.time() - t0

    # Résumé
    print(f"\n{'='*60}")
    print(f"  RÉSUMÉ — {elapsed:.0f}s")
    print(f"{'='*60}")
    print(f"  ✅ OK     : {len(results['ok'])}")
    if results["ok"]:
        for n in results["ok"]:
            print(f"             · {n}")
    print(f"  ❌ Échec  : {len(results['fail'])}")
    if results["fail"]:
        for n in results["fail"]:
            print(f"             · {n}")
    print(f"\n  Fichiers dans : maps/<code_commune>/")


if __name__ == "__main__":
    main()
