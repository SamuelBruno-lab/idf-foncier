"""
Trois cartes HDBSCAN pour Le Plessis-Robinson (92060) :
  1. Appartements
  2. Maisons (pavillons)
  3. Commerces / Locaux d'activités / Entrepôts
Même modèle que carte_vlg_par_type.py
"""
import json
import pandas as pd
import numpy as np
import folium
from folium.plugins import HeatMap, MiniMap, Fullscreen
import hdbscan
from scipy.spatial import ConvexHull
import branca.colormap as cm
import os

# ── Réutilisation des fonctions du pipeline VLG ────────────────────────────────
from carte_vlg_par_type import (
    aggregate_mutations,
    run_preliminary_clustering,
    assign_cluster_to_mixed,
    ventiler_mutations_mixtes,
    apply_jitter,
    build_map,
)

COMMUNE_CODE = "92060"
COMMUNE_NOM = "Le Plessis-Robinson"
OUTPUT_DIR = "/home/user/idf-foncier/lpr_pages"
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── 1. Chargement & nettoyage ─────────────────────────────────────────────────
years = [2020, 2021, 2022, 2023, 2024, 2025]
frames = []
for y in years:
    try:
        df = pd.read_csv(f"/home/user/idf-foncier/dvf_{COMMUNE_CODE}_{y}.csv", low_memory=False)
        df["annee"] = y
        frames.append(df)
        print(f"  {y}: {len(df)} lignes")
    except Exception as e:
        print(f"Skip {y}: {e}")

raw = pd.concat(frames, ignore_index=True)
raw = raw.dropna(subset=["latitude", "longitude", "valeur_fonciere"])
raw = raw[raw["valeur_fonciere"] > 1]
raw = raw.drop_duplicates(subset=["id_mutation", "id_parcelle", "type_local", "surface_reelle_bati"])
raw = raw[raw["type_local"] != "Dépendance"]
raw = raw[~((raw["nature_mutation"] == "Vente en l'état futur d'achèvement") &
            (raw["type_local"] == "Maison"))]
raw["valeur_fonciere"]     = pd.to_numeric(raw["valeur_fonciere"],     errors="coerce")
raw["surface_reelle_bati"] = pd.to_numeric(raw["surface_reelle_bati"], errors="coerce")
raw["surface_terrain"]     = pd.to_numeric(raw["surface_terrain"],     errors="coerce")
raw["date_mutation"]       = pd.to_datetime(raw["date_mutation"],       errors="coerce")

raw, mixed_raw = aggregate_mutations(raw)

raw["prix_m2"] = np.where(
    (raw["type_local"].isin(["Appartement", "Maison"])) & (raw["surface_reelle_bati"] > 0),
    raw["valeur_fonciere"] / raw["surface_reelle_bati"],
    np.where(
        raw["surface_reelle_bati"] > 0,
        raw["valeur_fonciere"] / raw["surface_reelle_bati"],
        np.nan,
    ),
)
raw = raw.dropna(subset=["valeur_fonciere"])

# Suppression outliers
SEUIL_PRIX_M2_MAX = {"Maison": 12000, "Appartement": 15000,
                     "Local industriel. commercial ou assimilé": 15000}
SEUIL_PRIX_M2_MIN = {"Maison": 500, "Appartement": 500,
                     "Local industriel. commercial ou assimilé": 500}
for tl, seuil in SEUIL_PRIX_M2_MAX.items():
    mask = (raw["type_local"] == tl) & (raw["prix_m2"] > seuil)
    n = mask.sum()
    if n:
        print(f"Suppression {n} outliers {tl} > {seuil} €/m²")
    raw = raw[~mask]
for tl, seuil in SEUIL_PRIX_M2_MIN.items():
    mask = (raw["type_local"] == tl) & (raw["prix_m2"] < seuil)
    n = mask.sum()
    if n:
        print(f"Suppression {n} outliers {tl} < {seuil} €/m²")
    raw = raw[~mask]

# ── Ventilation des mutations mixtes ──────────────────────────────────────────
pure_cluster_labels = run_preliminary_clustering(raw, min_cluster_size=8, min_samples=2)

median_m2_by_cluster_type = {}
raw_for_ref = raw.copy()
raw_for_ref["_ref_cluster"] = pure_cluster_labels
for cid in np.unique(pure_cluster_labels[pure_cluster_labels >= 0]):
    subset_c = raw_for_ref[
        (raw_for_ref["_ref_cluster"] == cid)
        & raw_for_ref["prix_m2"].notna()
        & (raw_for_ref["prix_m2"] > 0)
    ]
    median_m2_by_cluster_type[int(cid)] = {}
    for tl in subset_c["type_local"].dropna().unique():
        vals = subset_c[subset_c["type_local"] == tl]["prix_m2"]
        if len(vals) >= 10:
            median_m2_by_cluster_type[int(cid)][tl] = float(vals.median())

median_m2_by_parcelle_type = {}
for (id_parc, tl), grp in raw.groupby(["id_parcelle", "type_local"]):
    vals = grp["prix_m2"].dropna()
    vals = vals[vals > 0]
    if id_parc not in median_m2_by_parcelle_type:
        median_m2_by_parcelle_type[id_parc] = {}
    median_m2_by_parcelle_type[id_parc][tl] = {
        "median": float(vals.median()) if len(vals) > 0 else np.nan,
        "count": len(vals),
    }

global_median_m2_by_type = {}
for tl in raw["type_local"].dropna().unique():
    subset = raw[(raw["type_local"] == tl) & raw["prix_m2"].notna() & (raw["prix_m2"] > 0)]
    if len(subset) > 0:
        global_median_m2_by_type[tl] = float(subset["prix_m2"].median())
        print(f"  Médiane globale {tl}: {global_median_m2_by_type[tl]:,.0f} €/m²")

if not mixed_raw.empty:
    mixed_raw = assign_cluster_to_mixed(mixed_raw, raw, pure_cluster_labels)
    ventile_df = ventiler_mutations_mixtes(
        mixed_raw,
        median_m2_by_cluster_type,
        median_m2_by_parcelle_type,
        global_median_m2_by_type,
        min_parcelle_tx=5,
        seuil_m2_min=SEUIL_PRIX_M2_MIN,
    )
    if not ventile_df.empty:
        before = len(ventile_df)
        for tl, seuil in SEUIL_PRIX_M2_MAX.items():
            ventile_df = ventile_df[~((ventile_df["type_local"] == tl) & (ventile_df["prix_m2"] > seuil))]
        for tl, seuil in SEUIL_PRIX_M2_MIN.items():
            ventile_df = ventile_df[~((ventile_df["type_local"] == tl) & (ventile_df["prix_m2"] < seuil))]
        if len(ventile_df) < before:
            print(f"  Suppression {before - len(ventile_df)} ventilations aberrantes")
        raw = pd.concat([raw, ventile_df], ignore_index=True)
        print(f"  Total après ventilation : {len(raw)} transactions")

# ── Stats pour l'index ────────────────────────────────────────────────────────
n_appart = len(raw[raw["type_local"] == "Appartement"])
n_maison = len(raw[raw["type_local"] == "Maison"])
n_commerce = len(raw[raw["type_local"] == "Local industriel. commercial ou assimilé"])
total_tx = n_appart + n_maison + n_commerce
print(f"\n=== {COMMUNE_NOM} ===")
print(f"Total: {total_tx} tx | Appart: {n_appart} | Maisons: {n_maison} | Commerces: {n_commerce}")

# ── 5. Génération des trois cartes ────────────────────────────────────────────
appart_data = raw[raw["type_local"] == "Appartement"].copy()
maison_data = raw[raw["type_local"] == "Maison"].copy()
commerce_data = raw[raw["type_local"] == "Local industriel. commercial ou assimilé"].copy()

build_map(
    data=appart_data,
    title="Appartements",
    subtitle=f"{COMMUNE_NOM} · 2020–2025",
    min_cluster_size=max(5, int(len(appart_data) * 0.06)),
    min_samples=3,
    cluster_selection_method="eom",
    out_path=os.path.join(OUTPUT_DIR, "carte_lpr_appartements.html"),
)

build_map(
    data=maison_data,
    title="Maisons / Pavillons",
    subtitle=f"{COMMUNE_NOM} · 2020–2025",
    min_cluster_size=max(5, int(len(maison_data) * 0.08)),
    min_samples=2,
    cluster_selection_method="leaf",
    surface_col="surface_reelle_bati",
    surface_label="m² bâti",
    colormap_caption="Prix au m² bâti (€)",
    out_path=os.path.join(OUTPUT_DIR, "carte_lpr_maisons.html"),
)

build_map(
    data=commerce_data,
    title="Commerces / Locaux d'activités / Entrepôts",
    subtitle=f"{COMMUNE_NOM} · 2020–2025",
    min_cluster_size=max(5, int(len(commerce_data) * 0.08)),
    min_samples=2,
    cluster_selection_method="eom",
    out_path=os.path.join(OUTPUT_DIR, "carte_lpr_commerces.html"),
)

# ── Comptage micro-marchés pour l'index ───────────────────────────────────────
def count_clusters(data, min_cs, min_s, method):
    if data.empty or len(data) < min_cs:
        return 0
    coords = np.radians(data[["latitude", "longitude"]].values)
    cl = hdbscan.HDBSCAN(
        min_cluster_size=min_cs, min_samples=min_s,
        metric="haversine", cluster_selection_method=method,
    )
    labels = cl.fit_predict(coords)
    return int(np.unique(labels[labels >= 0]).size)

n_cl_appart = count_clusters(appart_data,
    max(5, int(len(appart_data) * 0.06)), 3, "eom")
n_cl_maison = count_clusters(maison_data,
    max(5, int(len(maison_data) * 0.08)), 2, "leaf")
n_cl_commerce = count_clusters(commerce_data,
    max(5, int(len(commerce_data) * 0.08)), 2, "eom")
total_clusters = n_cl_appart + n_cl_maison + n_cl_commerce

# ── Génération de l'index ─────────────────────────────────────────────────────
index_html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analyse Foncière · {COMMUNE_NOM}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{
      font-family: 'Segoe UI', Arial, sans-serif;
      background: linear-gradient(135deg, #0a0a1e 0%, #0d1b2a 50%, #0a0a1e 100%);
      min-height: 100vh; color: #e8e8f0;
      display: flex; flex-direction: column; align-items: center;
      padding: 60px 20px;
    }}
    .header {{ text-align: center; margin-bottom: 60px; }}
    .header .tag {{
      display: inline-block; background: rgba(0,212,255,0.15);
      color: #00d4ff; border: 1px solid rgba(0,212,255,0.3);
      border-radius: 20px; padding: 4px 16px; font-size: 12px;
      letter-spacing: 2px; text-transform: uppercase; margin-bottom: 20px;
    }}
    .header h1 {{
      font-size: clamp(28px, 5vw, 48px); font-weight: 800;
      background: linear-gradient(90deg, #00d4ff, #ffffff, #ff6600);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      background-clip: text; line-height: 1.2; margin-bottom: 16px;
    }}
    .header p {{
      font-size: 16px; color: rgba(255,255,255,0.5); max-width: 520px; margin: 0 auto;
      line-height: 1.6;
    }}
    .stats-bar {{
      display: flex; gap: 40px; justify-content: center;
      margin-bottom: 50px; flex-wrap: wrap;
    }}
    .stat {{ text-align: center; }}
    .stat .val {{ font-size: 32px; font-weight: 800; color: #00d4ff; }}
    .stat .lbl {{ font-size: 11px; color: rgba(255,255,255,.4);
      text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }}
    .cards {{ display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 600px; }}
    .card {{
      display: flex; align-items: center; gap: 20px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 14px; padding: 22px 24px;
      text-decoration: none; color: inherit;
      transition: all 0.2s ease; cursor: pointer;
    }}
    .card:hover {{
      background: rgba(0,212,255,0.08);
      border-color: rgba(0,212,255,0.3);
      transform: translateY(-2px);
      box-shadow: 0 8px 32px rgba(0,212,255,0.15);
    }}
    .card-icon {{ font-size: 32px; flex-shrink: 0; }}
    .card-body {{ flex: 1; }}
    .card-title {{ font-size: 18px; font-weight: 700; color: #fff; margin-bottom: 4px; }}
    .card-desc {{ font-size: 13px; color: rgba(255,255,255,0.45); }}
    .card-arrow {{ font-size: 20px; color: rgba(0,212,255,0.5); flex-shrink: 0; }}
    .card:hover .card-arrow {{ color: #00d4ff; }}
    .footer {{
      margin-top: 60px; text-align: center;
      font-size: 11px; color: rgba(255,255,255,0.2); line-height: 1.8;
    }}
    .method-badge {{
      display: inline-flex; align-items: center; gap: 8px;
      background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
      border-radius: 8px; padding: 10px 18px; margin-top: 30px; font-size: 13px;
      color: rgba(255,255,255,0.5);
    }}
    .method-badge span {{ color: #00d4ff; font-weight: 600; }}
  </style>
</head>
<body>
  <div class="header">
    <div class="tag">Service Foncier · {COMMUNE_CODE}</div>
    <h1>Analyse Foncière<br>{COMMUNE_NOM}</h1>
    <p>Cartographie interactive des transactions immobilières<br>
       2020–2025 · Source : Demandes de Valeurs Foncières</p>
  </div>

  <div class="stats-bar">
    <div class="stat"><div class="val">{total_tx:,}</div><div class="lbl">Transactions</div></div>
    <div class="stat"><div class="val">2020–25</div><div class="lbl">Période</div></div>
    <div class="stat"><div class="val">{total_clusters}</div><div class="lbl">Micro-marchés</div></div>
    <div class="stat"><div class="val">3</div><div class="lbl">Typologies</div></div>
  </div>

  <div class="cards">

    <a href="carte_lpr_appartements.html" class="card">
      <div class="card-icon">🏢</div>
      <div class="card-body">
        <div class="card-title">Appartements</div>
        <div class="card-desc">{n_appart} transactions · {n_cl_appart} micro-marchés</div>
      </div>
      <div class="card-arrow">→</div>
    </a>
    <a href="carte_lpr_maisons.html" class="card">
      <div class="card-icon">🏠</div>
      <div class="card-body">
        <div class="card-title">Maisons / Pavillons</div>
        <div class="card-desc">{n_maison} transactions · {n_cl_maison} micro-marchés</div>
      </div>
      <div class="card-arrow">→</div>
    </a>
    <a href="carte_lpr_commerces.html" class="card">
      <div class="card-icon">🏭</div>
      <div class="card-body">
        <div class="card-title">Commerces & Locaux</div>
        <div class="card-desc">{n_commerce} transactions · {n_cl_commerce} micro-marchés</div>
      </div>
      <div class="card-arrow">→</div>
    </a>
  </div>

  <div class="method-badge">
    Analyse géospatiale · <span>Micro-marchés</span> · Données DVF open data
  </div>

  <div class="footer">
    © 2026 Samuel Bruno · Service Foncier · {COMMUNE_NOM}<br>
    Source : data.gouv.fr · Demandes de Valeurs Foncières (DVF)
  </div>
</body>
</html>"""

with open(os.path.join(OUTPUT_DIR, "index.html"), "w") as f:
    f.write(index_html)
print(f"\n✅ {OUTPUT_DIR}/index.html généré")
