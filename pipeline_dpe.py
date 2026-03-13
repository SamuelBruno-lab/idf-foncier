#!/usr/bin/env python3
"""
Pipeline DPE — Carte des Diagnostics de Performance Énergétique par département
Fusionne 3 sources : Logements existants, Logements neufs, Tertiaire
Génère carte_dpe.html pour chaque département IDF

Source : API ADEME (data.ademe.fr)
Usage : python pipeline_dpe.py <CODE_DEPT>
Ex :    python pipeline_dpe.py 92
"""
import sys, os, json, time
import pandas as pd
import numpy as np
import folium
from folium.plugins import HeatMap, MiniMap, Fullscreen
import hdbscan
from scipy.spatial import ConvexHull
import requests
from urllib.parse import urlparse, parse_qs
from sklearn.neighbors import BallTree

# ── Config par département ─────────────────────────────────────────────────
DVF_CSV = {
    "60": "/home/user/dvf_60.csv",
    "75": "/home/user/dvf_75.csv",
    "77": "/home/user/dvf_77.csv",
    "78": "/home/user/dvf_78.csv",
    "91": "/home/user/dvf_91.csv",
    "92": "/home/user/dvf_92.csv",
    "93": "/home/user/dvf_93.csv",
    "94": "/home/user/dvf_94.csv",
    "95": "/home/user/dvf_95.csv",
}

DEPT_CONFIG = {
    "60": {"nom": "Oise", "code": "60", "color": "#ec4899", "zoom": 10,
           "gradient": ("90deg", "#ffdd00", "#ffffff", "#ec4899")},
    "75": {"nom": "Paris", "code": "75", "color": "#ef4444", "zoom": 12,
           "gradient": ("90deg", "#00d4ff", "#ffffff", "#ef4444")},
    "77": {"nom": "Seine-et-Marne", "code": "77", "color": "#f97316", "zoom": 10,
           "gradient": ("90deg", "#00d4ff", "#ffffff", "#f97316")},
    "78": {"nom": "Yvelines", "code": "78", "color": "#8b5cf6", "zoom": 11,
           "gradient": ("90deg", "#00d4ff", "#ffffff", "#8b5cf6")},
    "91": {"nom": "Essonne", "code": "91", "color": "#10b981", "zoom": 11,
           "gradient": ("90deg", "#00d4ff", "#ffffff", "#10b981")},
    "92": {"nom": "Hauts-de-Seine", "code": "92", "color": "#00d4ff", "zoom": 12,
           "gradient": ("90deg", "#00d4ff", "#ffffff", "#ff6600")},
    "93": {"nom": "Seine-Saint-Denis", "code": "93", "color": "#00ff88", "zoom": 12,
           "gradient": ("90deg", "#00d4ff", "#ffffff", "#00ff88")},
    "94": {"nom": "Val-de-Marne", "code": "94", "color": "#a78bfa", "zoom": 12,
           "gradient": ("90deg", "#00d4ff", "#ffffff", "#a78bfa")},
    "95": {"nom": "Val-d'Oise", "code": "95", "color": "#f59e0b", "zoom": 11,
           "gradient": ("90deg", "#00d4ff", "#ffffff", "#f59e0b")},
}

# Couleurs DPE officielles
DPE_COLORS = {
    "A": "#319834", "B": "#33cc31", "C": "#cbfc34",
    "D": "#fbfe06", "E": "#fbcc05", "F": "#f58221", "G": "#ef1d29",
}
DPE_LABELS = ["A", "B", "C", "D", "E", "F", "G"]

# ── 3 sources ADEME ───────────────────────────────────────────────────────
DATASETS = {
    "existant": {
        "id": "dpe03existant",
        "label": "Logement existant",
        "fields": "_geopoint,etiquette_dpe,etiquette_ges,surface_habitable_logement,"
                  "type_batiment,date_reception_dpe,nom_commune_ban,code_postal_ban,"
                  "adresse_ban,periode_construction,type_energie_principale_chauffage,"
                  "conso_5_usages_par_m2_ep,emission_ges_5_usages_par_m2,_rand",
        "max_records": 800000,
        "sort": "_rand",
        "conso_field": "conso_5_usages_par_m2_ep",
        "ges_field": "emission_ges_5_usages_par_m2",
        "surface_field": "surface_habitable_logement",
    },
    "neuf": {
        "id": "g3cgx7jb3cmys5voxz1mrm22",
        "label": "Logement neuf",
        "fields": "_geopoint,etiquette_dpe,etiquette_ges,surface_habitable_logement,"
                  "type_batiment,date_reception_dpe,nom_commune_ban,code_postal_ban,"
                  "adresse_ban,periode_construction,type_energie_principale_chauffage,"
                  "conso_5_usages_par_m2_ep,emission_ges_5_usages_par_m2,_rand",
        "max_records": 100000,  # take all (usually < 60K per dept)
        "sort": "_rand",
        "conso_field": "conso_5_usages_par_m2_ep",
        "ges_field": "emission_ges_5_usages_par_m2",
        "surface_field": "surface_habitable_logement",
    },
    "tertiaire": {
        "id": "j9ol0fwjqckyf49vr29nknbu",
        "label": "Tertiaire",
        "fields": "_geopoint,etiquette_dpe,etiquette_ges,surface_utile,"
                  "date_reception_dpe,nom_commune_ban,code_postal_ban,"
                  "adresse_ban,secteur_activite,"
                  "conso_kwhep_m2_an,emission_ges_kg_co2_m2_an,_rand",
        "max_records": 100000,  # take all (usually < 40K per dept)
        "sort": "_rand",
        "conso_field": "conso_kwhep_m2_an",
        "ges_field": "emission_ges_kg_co2_m2_an",
        "surface_field": "surface_utile",
    },
}

PAGE_SIZE = 1000


# ── Fetching ──────────────────────────────────────────────────────────────
def fetch_dpe(dataset_key, dept_code):
    """Fetch DPE data from ADEME API with random sampling."""
    ds = DATASETS[dataset_key]
    api_url = f"https://data.ademe.fr/data-fair/api/v1/datasets/{ds['id']}/lines"
    max_records = ds["max_records"]
    print(f"  [{dataset_key}] Fetching (max {max_records})...")

    records = []
    after = None
    while len(records) < max_records:
        params = {
            "size": PAGE_SIZE,
            "select": ds["fields"],
            "qs": f"code_departement_ban:{dept_code}",
            "sort": ds["sort"],
        }
        if after:
            params["after"] = after
        ok = False
        for attempt in range(4):
            try:
                resp = requests.get(api_url, params=params, timeout=30)
                resp.raise_for_status()
                ok = True
                break
            except Exception as e:
                wait = 2 ** (attempt + 1)
                print(f"    Retry {attempt+1}/4 after {wait}s: {e}")
                time.sleep(wait)
        if not ok:
            print(f"    Failed after 4 retries, stopping at {len(records)}")
            break
        data = resp.json()
        results = data.get("results", [])
        if not results:
            break
        records.extend(results)
        next_url = data.get("next")
        if not next_url:
            break
        parsed = parse_qs(urlparse(next_url).query)
        after = parsed.get("after", [None])[0]
        if not after:
            break
        if len(records) % 5000 == 0:
            print(f"    {len(records)} records...", flush=True)

    print(f"  [{dataset_key}] {len(records)} DPE fetched for dept {dept_code}")
    return records, dataset_key


def records_to_dataframe(records, dataset_key):
    """Convert API records to a clean DataFrame with unified columns."""
    ds = DATASETS[dataset_key]
    df = pd.DataFrame(records)
    if df.empty:
        return df
    # Parse geopoint
    gp = df["_geopoint"].dropna().str.split(",", expand=True)
    df.loc[gp.index, "latitude"] = pd.to_numeric(gp[0], errors="coerce")
    df.loc[gp.index, "longitude"] = pd.to_numeric(gp[1], errors="coerce")
    df = df.dropna(subset=["latitude", "longitude", "etiquette_dpe"])
    df = df[df["etiquette_dpe"].isin(DPE_LABELS)].copy()

    # Unified columns
    df["source"] = dataset_key
    df["source_label"] = ds["label"]
    df["conso_m2"] = pd.to_numeric(df.get(ds["conso_field"]), errors="coerce")
    df["ges_m2"] = pd.to_numeric(df.get(ds["ges_field"]), errors="coerce")
    df["surface"] = pd.to_numeric(df.get(ds["surface_field"]), errors="coerce")
    df["date_reception_dpe"] = pd.to_datetime(df.get("date_reception_dpe"), errors="coerce")
    df["adresse"] = df.get("adresse_ban", "").fillna("").astype(str)
    df["commune"] = df.get("nom_commune_ban", "").fillna("").astype(str)
    df["ges_label"] = df.get("etiquette_ges", "").fillna("").astype(str)

    # Type info
    if "type_batiment" in df.columns:
        df["type_info"] = df["type_batiment"].fillna("").astype(str)
    elif "secteur_activite" in df.columns:
        df["type_info"] = df["secteur_activite"].fillna("").astype(str)
    else:
        df["type_info"] = ""

    dpe_score = {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7}
    df["dpe_score"] = df["etiquette_dpe"].map(dpe_score)
    return df


# ── HDBSCAN ───────────────────────────────────────────────────────────────
HDBSCAN_MAX_POINTS = 100_000  # au-delà, on échantillonne pour éviter OOM

def run_hdbscan(data, min_cluster_size=30):
    from sklearn.neighbors import BallTree
    data = data.copy()
    n_total = len(data)
    coords_all = np.radians(data[["latitude", "longitude"]].values)

    if n_total > HDBSCAN_MAX_POINTS:
        print(f"  {n_total:,} points > {HDBSCAN_MAX_POINTS:,} → échantillonnage pour HDBSCAN")
        sample_idx = np.random.choice(n_total, HDBSCAN_MAX_POINTS, replace=False)
        coords_sample = coords_all[sample_idx]
    else:
        sample_idx = None
        coords_sample = coords_all

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=5,
        metric="haversine",
        cluster_selection_method="eom",
    )
    labels_sample = clusterer.fit_predict(coords_sample)

    if sample_idx is not None:
        # Propager les labels aux points non-échantillonnés via nearest neighbor
        tree = BallTree(coords_sample, metric="haversine")
        _, idx = tree.query(coords_all, k=1)
        data["cluster"] = labels_sample[idx.flatten()]
    else:
        data["cluster"] = labels_sample

    n = int(data[data["cluster"] >= 0]["cluster"].nunique())
    print(f"  Micro-zones DPE : {n}")
    return data


def apply_jitter(df, radius_deg=0.00008):
    df = df.copy()
    df["lat_j"] = df["latitude"].astype(float)
    df["lon_j"] = df["longitude"].astype(float)
    for (lat, lon), idx in df.groupby(["latitude", "longitude"]).groups.items():
        n = len(idx)
        if n <= 1:
            continue
        angles = np.linspace(0, 2 * np.pi * (1 + n // 8), n, endpoint=False)
        radii = np.linspace(radius_deg * 0.3, radius_deg, n)
        df.loc[idx, "lat_j"] = lat + radii * np.sin(angles)
        df.loc[idx, "lon_j"] = lon + radii * np.cos(angles)
    return df


# ── Cluster helpers ───────────────────────────────────────────────────────
def cluster_dpe_distribution(sub):
    dist = sub["etiquette_dpe"].value_counts()
    total = len(sub)
    parts = []
    for lb in DPE_LABELS:
        n = dist.get(lb, 0)
        if n > 0:
            parts.append(f"<span style='color:{DPE_COLORS[lb]};font-weight:700;'>{lb}</span>:{n/total*100:.0f}%")
    return " ".join(parts)


def dominant_dpe(sub):
    return sub["etiquette_dpe"].mode().iloc[0] if len(sub) > 0 else "D"


# ── Compact map generation with filters, search, dynamic dashboard ────────
def make_dpe_map(data, cfg, out_path, dvf_zone_stats=None):
    if dvf_zone_stats is None:
        dvf_zone_stats = {}
    dept_nom = cfg["nom"]
    dept_code = cfg["code"]
    dept_color = cfg["color"]

    data = apply_jitter(data)
    center = [data["latitude"].mean(), data["longitude"].mean()]
    m = folium.Map(location=center, zoom_start=cfg["zoom"], tiles=None, prefer_canvas=True)

    folium.TileLayer(
        tiles="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attr="&copy; OSM &copy; CARTO", name="Dark (défaut)", max_zoom=19, subdomains="abcd",
    ).add_to(m)
    folium.TileLayer(
        tiles="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        attr="&copy; OSM &copy; CARTO", name="Light", max_zoom=19, subdomains="abcd",
    ).add_to(m)
    Fullscreen(position="topright").add_to(m)
    MiniMap(position="bottomleft", tile_layer="CartoDB dark_matter", zoom_level_offset=-5).add_to(m)

    # ── Heatmap: consommation énergie ──
    heat_data = data[["latitude", "longitude", "conso_m2"]].dropna().copy()
    if len(heat_data) > 0:
        vmin_h = heat_data["conso_m2"].quantile(0.05)
        vmax_h = heat_data["conso_m2"].quantile(0.95)
        if vmin_h < vmax_h:
            heat_data["w"] = ((heat_data["conso_m2"] - vmin_h) / (vmax_h - vmin_h)).clip(0, 1)
        else:
            heat_data["w"] = 0.5
        hm_fg = folium.FeatureGroup(name="🌡️ Heatmap conso. énergie", show=False)
        HeatMap(
            data=heat_data[["latitude", "longitude", "w"]].values.tolist(),
            radius=18, blur=14, min_opacity=0.3,
            gradient={0.2: "#319834", 0.4: "#cbfc34", 0.6: "#fbfe06", 0.8: "#f58221", 1.0: "#ef1d29"},
        ).add_to(hm_fg)
        hm_fg.add_to(m)

    # ── Polygones micro-zones DPE ──
    poly_fg = folium.FeatureGroup(name="🗺️ Micro-zones DPE", show=True)
    for cid in sorted(data[data["cluster"] >= 0]["cluster"].unique()):
        pts = data[data["cluster"] == cid][["latitude", "longitude"]].values
        if len(pts) < 3:
            continue
        try:
            hull = ConvexHull(pts)
            hull_pts = pts[hull.vertices].tolist()
            hull_pts.append(hull_pts[0])
            sub = data[data["cluster"] == cid]
            dom = dominant_dpe(sub)
            color = DPE_COLORS.get(dom, "#666")
            dist_html = cluster_dpe_distribution(sub)
            mc = sub["conso_m2"].median()
            mc_s = f"{mc:.0f}" if pd.notna(mc) else "—"
            mg = sub["ges_m2"].median()
            mg_s = f"{mg:.1f}" if pd.notna(mg) else "—"
            src_counts = sub["source_label"].value_counts()
            src_s = " · ".join(f"{v} {k}" for k, v in src_counts.items())
            popup_html = (
                f"<div style='font-family:Segoe UI,sans-serif;min-width:230px;color:#222;'>"
                f"<div style='background:{color};color:#000;padding:8px 12px;border-radius:6px 6px 0 0;font-weight:700;font-size:14px;'>"
                f"Zone {cid} · DPE {dom}</div>"
                f"<div style='padding:10px 12px;background:#f9f9f9;border-radius:0 0 6px 6px;'>"
                f"<div style='font-size:11px;margin-bottom:6px;'>{dist_html}</div>"
                f"<div style='font-size:12px;color:#555;'>"
                f"{len(sub)} diagnostics · {mc_s} kWh/m²/an · {mg_s} kgCO₂/m²/an<br>"
                f"<span style='font-size:10px;color:#888;'>{src_s}</span>"
                f"</div></div></div>"
            )
            folium.Polygon(
                locations=hull_pts, color=color,
                fill=True, fill_color=color, fill_opacity=0.12, weight=2,
                popup=folium.Popup(popup_html, max_width=280),
                tooltip=f"<b style='color:{color}'>Zone {cid}</b> · DPE {dom} · {len(sub)}",
            ).add_to(poly_fg)
        except Exception:
            pass
    poly_fg.add_to(m)

    folium.LayerControl(collapsed=True, position="topright").add_to(m)

    # ── Build compact point data for JS ──
    # Format: [lat4, lon4, dpeIdx, srcIdx, surface, conso, communeIdx]
    src_map = {"existant": 0, "neuf": 1, "tertiaire": 2}
    dpe_map = {lb: i for i, lb in enumerate(DPE_LABELS)}

    # Build commune lookup
    communes_list = sorted(data["commune"].dropna().unique().tolist())
    commune_to_idx = {c: i for i, c in enumerate(communes_list)}

    # Build address lookup (indexed dict to save space)
    adresses_list = sorted(data["adresse"].dropna().unique().tolist())
    adresse_to_idx = {a: i for i, a in enumerate(adresses_list)}

    # Commune bounding boxes
    com_bboxes = []
    for commune in communes_list:
        csub = data[data["commune"] == commune]
        com_bboxes.append([
            round(float(csub["latitude"].min()), 4),
            round(float(csub["longitude"].min()), 4),
            round(float(csub["latitude"].max()), 4),
            round(float(csub["longitude"].max()), 4),
        ])

    # Build compact point array
    # Format: [lat4, lon4, dpeIdx, srcIdx, surface, conso, communeIdx, adresseIdx, dvfZone]
    pts_data = []
    for _, row in data.iterrows():
        lat = round(float(row.get("lat_j", row["latitude"])), 4)
        lon = round(float(row.get("lon_j", row["longitude"])), 4)
        dpe_idx = dpe_map.get(row["etiquette_dpe"], 3)
        src_idx = src_map.get(row.get("source", ""), 0)
        surf = int(round(float(row["surface"]), 0)) if pd.notna(row.get("surface")) else 0
        conso = int(round(float(row["conso_m2"]), 0)) if pd.notna(row.get("conso_m2")) else 0
        com_idx = commune_to_idx.get(str(row.get("commune", "")), 0)
        adr_idx = adresse_to_idx.get(str(row.get("adresse", "")), 0)
        dvf_z = int(row.get("dvf_zone", -1))
        pts_data.append([lat, lon, dpe_idx, src_idx, surf, conso, com_idx, adr_idx, dvf_z])

    # Stats for dashboard
    n_clusters = int(data[data["cluster"] >= 0]["cluster"].nunique()) if "cluster" in data.columns else 0
    dpe_dist = data["etiquette_dpe"].value_counts()
    dpe_counts = [int(dpe_dist.get(lb, 0)) for lb in DPE_LABELS]
    n_passoires = dpe_counts[5] + dpe_counts[6]
    pct_passoires = n_passoires / len(data) * 100 if len(data) > 0 else 0
    med_conso = data["conso_m2"].median()
    med_conso_s = f"{med_conso:.0f}" if pd.notna(med_conso) else "—"
    src_counts = data["source"].value_counts()
    src_totals = [int(src_counts.get(k, 0)) for k in ["existant", "neuf", "tertiaire"]]

    m.get_root().html.add_child(folium.Element("<div id='dpe-app'></div>"))
    m.save(out_path)

    # ── Post-process: inject compact data + full interactive system ──
    with open(out_path, "r") as f:
        html = f.read()

    # Find the Leaflet map variable name
    import re
    map_var_match = re.search(r'var (map_[a-f0-9]+)\s*=\s*L\.map', html)
    map_var = map_var_match.group(1) if map_var_match else "map_unknown"

    pts_json = json.dumps(pts_data, separators=(',', ':'))
    communes_json = json.dumps(communes_list, separators=(',', ':'), ensure_ascii=False)
    adresses_json = json.dumps(adresses_list, separators=(',', ':'), ensure_ascii=False)
    bboxes_json = json.dumps(com_bboxes, separators=(',', ':'))
    dvf_stats_json = json.dumps(dvf_zone_stats, separators=(',', ':'))

    custom_css = f"""<style>
  .leaflet-popup-content-wrapper {{ border-radius:8px!important; padding:0!important; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.35)!important; }}
  .leaflet-popup-content {{ margin:0!important; }}
  .leaflet-control-layers {{ background:rgba(15,15,35,0.95)!important; color:#ddd!important; border:1px solid rgba(255,255,255,0.15)!important; border-radius:8px!important; }}
  .leaflet-control-layers label {{ color:#ccc!important; white-space:nowrap!important; }}
  #dpe-dash {{
    position:fixed; top:10px; left:10px; z-index:9999; width:320px;
    background:linear-gradient(135deg,rgba(10,10,30,0.97),rgba(20,20,50,0.97));
    color:#e8e8f0; font-family:'Segoe UI',Arial,sans-serif;
    border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,0.6);
    border:1px solid rgba(255,255,255,0.1); overflow:hidden;
    max-height:calc(100vh - 20px); overflow-y:auto;
  }}
  #dpe-dash::-webkit-scrollbar {{ width:4px; }}
  #dpe-dash::-webkit-scrollbar-thumb {{ background:rgba(255,255,255,0.15); border-radius:2px; }}
  .dpe-hdr {{
    background:linear-gradient(90deg,{dept_color}22,rgba(255,255,255,0.03));
    padding:12px 16px; border-bottom:1px solid rgba(255,255,255,0.1);
    position:relative;
  }}
  .dpe-hdr h2 {{ margin:0; font-size:14px; font-weight:700; color:#fff; }}
  .dpe-hdr p {{ margin:3px 0 0; font-size:11px; color:rgba(255,255,255,.5); }}
  .dpe-toggle {{ position:absolute; top:8px; right:12px; cursor:pointer; color:rgba(255,255,255,.5); font-size:16px; user-select:none; }}
  .dpe-toggle:hover {{ color:#fff; }}
  .dpe-body {{ padding:12px 16px; }}
  .dpe-section {{ margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid rgba(255,255,255,0.06); }}
  .dpe-section:last-child {{ border-bottom:none; margin-bottom:0; padding-bottom:0; }}
  .dpe-section-title {{ font-size:10px; text-transform:uppercase; letter-spacing:1px; color:rgba(255,255,255,.35); margin-bottom:8px; font-weight:600; }}
  .dpe-kpi-grid {{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }}
  .dpe-kpi {{ background:rgba(255,255,255,0.06); border-radius:8px; padding:9px; text-align:center; border:1px solid rgba(255,255,255,0.08); }}
  .dpe-kpi .val {{ font-size:16px; font-weight:800; color:{dept_color}; }}
  .dpe-kpi .lbl {{ font-size:10px; color:rgba(255,255,255,.45); margin-top:2px; text-transform:uppercase; letter-spacing:.5px; }}
  .dpe-dist-bar {{ width:100%; height:10px; border-radius:5px; overflow:hidden; background:rgba(255,255,255,0.08); display:flex; }}
  .dpe-filter-row {{ display:flex; flex-wrap:wrap; gap:4px; }}
  .dpe-chip {{
    display:inline-flex; align-items:center; gap:3px; padding:4px 8px;
    border-radius:6px; cursor:pointer; font-size:11px; font-weight:600;
    border:1.5px solid; transition:all 0.15s; user-select:none;
  }}
  .dpe-chip.active {{ opacity:1; }}
  .dpe-chip.inactive {{ opacity:0.3; }}
  .dpe-chip:hover {{ opacity:0.8; }}
  .dpe-chip .dot {{ width:8px; height:8px; border-radius:50%; flex-shrink:0; }}
  .src-chip {{
    display:inline-flex; align-items:center; gap:4px; padding:4px 8px;
    border-radius:6px; cursor:pointer; font-size:11px; font-weight:500;
    border:1px solid rgba(255,255,255,0.15); color:rgba(255,255,255,.7);
    transition:all 0.15s; user-select:none;
  }}
  .src-chip.active {{ background:rgba(255,255,255,0.1); border-color:rgba(255,255,255,0.3); }}
  .src-chip.inactive {{ opacity:0.3; }}
  .dpe-search {{
    width:100%; padding:7px 10px; border-radius:8px;
    border:1px solid rgba(255,255,255,0.12); background:rgba(255,255,255,0.06);
    color:#fff; font-size:12px; font-family:'Segoe UI',sans-serif; outline:none;
    box-sizing:border-box;
  }}
  .dpe-search:focus {{ border-color:{dept_color}66; }}
  .dpe-search-results {{
    max-height:120px; overflow-y:auto; margin-top:4px;
  }}
  .dpe-search-item {{
    padding:6px 8px; cursor:pointer; font-size:12px; color:rgba(255,255,255,.7);
    border-radius:4px; transition:background 0.1s;
  }}
  .dpe-search-item:hover {{ background:rgba(255,255,255,0.1); color:#fff; }}
  .dpe-legend-row {{ display:flex; align-items:center; gap:6px; margin-bottom:3px; font-size:11px; }}
  .dpe-legend-swatch {{ width:12px; height:12px; border-radius:3px; flex-shrink:0; }}
  .back-link {{
    display:block; margin-top:10px; padding:7px 10px; border-radius:7px;
    background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
    color:rgba(255,255,255,0.5); font-size:11px; text-decoration:none; text-align:center;
    transition:all 0.2s;
  }}
  .back-link:hover {{ background:rgba(255,255,255,0.1); color:#fff; }}
  #copyright-banner {{
    position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:9999;
    background:rgba(10,10,20,0.75);color:rgba(255,255,255,0.7);
    font-family:'Segoe UI',Arial,sans-serif;font-size:11px;padding:4px 12px;
    border-radius:20px;border:1px solid rgba(255,255,255,0.1);
    backdrop-filter:blur(4px);pointer-events:none;
  }}
</style>"""

    custom_js = f"""<script>
(function() {{
  var DPE_LABELS = ['A','B','C','D','E','F','G'];
  var DPE_COLORS = ['#319834','#33cc31','#cbfc34','#fbfe06','#fbcc05','#f58221','#ef1d29'];
  var DPE_THRESHOLDS = ['\\u226470','71-110','111-180','181-250','251-330','331-420','\\u2265421'];
  var SRC_LABELS = ['Existant','Neuf','Tertiaire'];
  var SRC_TOTALS = {json.dumps(src_totals)};
  var DEPT_COLOR = '{dept_color}';

  var PTS = {pts_json};
  var COMMUNES = {communes_json};
  var ADRESSES = {adresses_json};
  var COM_BB = {bboxes_json};
  var DVF_ZONES = {dvf_stats_json};
  var TOTAL = PTS.length;
  var N_ZONES = {n_clusters};

  var map = {map_var};
  var currentLayer = null;

  // Filter state: F+G checked by default
  var fDpe = [false,false,false,false,false,true,true];
  var fSrc = [true,true,true];

  // ── Build dashboard HTML ──
  var dash = document.getElementById('dpe-app');
  dash.innerHTML = '<div id="dpe-dash">' +
    '<div class="dpe-hdr">' +
      '<span class="dpe-toggle" id="dpe-tog">\\u25B2</span>' +
      '<h2>\\uD83C\\uDFF7\\uFE0F DPE \\u00B7 {dept_nom} ({dept_code})</h2>' +
      '<p>Logements existants + neufs + tertiaire \\u00B7 ADEME</p>' +
    '</div>' +
    '<div class="dpe-body" id="dpe-body">' +
      '<div class="dpe-section">' +
        '<div class="dpe-dist-bar" id="dpe-bar"></div>' +
        '<div class="dpe-kpi-grid">' +
          '<div class="dpe-kpi"><div class="val" id="kpi-diag">-</div><div class="lbl">Affich\\u00E9s</div></div>' +
          '<div class="dpe-kpi"><div class="val">' + N_ZONES + '</div><div class="lbl">Micro-zones</div></div>' +
          '<div class="dpe-kpi"><div class="val" id="kpi-fg" style="color:#ef1d29">-</div><div class="lbl">Passoires (F+G)</div></div>' +
          '<div class="dpe-kpi"><div class="val" id="kpi-conso">-</div><div class="lbl">kWh/m\\u00B2/an m\\u00E9d.</div></div>' +
        '</div>' +
        '<div style="font-size:10px;color:rgba(255,255,255,.35);text-align:center;margin-top:6px" id="kpi-src"></div>' +
      '</div>' +
      '<div class="dpe-section">' +
        '<div class="dpe-section-title">Filtres DPE</div>' +
        '<div class="dpe-filter-row" id="dpe-filters"></div>' +
        '<div style="display:flex;gap:6px;margin-top:6px">' +
          '<span style="font-size:10px;color:rgba(255,255,255,.35);cursor:pointer;text-decoration:underline" id="dpe-all">Tout</span>' +
          '<span style="font-size:10px;color:rgba(255,255,255,.35);cursor:pointer;text-decoration:underline" id="dpe-none">Aucun</span>' +
          '<span style="font-size:10px;color:rgba(255,255,255,.35);cursor:pointer;text-decoration:underline" id="dpe-fg">F+G seul.</span>' +
        '</div>' +
      '</div>' +
      '<div class="dpe-section">' +
        '<div class="dpe-section-title">Sources</div>' +
        '<div class="dpe-filter-row" id="src-filters"></div>' +
      '</div>' +
      '<div class="dpe-section">' +
        '<div class="dpe-section-title">Chercher une commune</div>' +
        '<input type="text" class="dpe-search" id="dpe-search" placeholder="Tapez un nom de commune...">' +
        '<div class="dpe-search-results" id="dpe-search-res"></div>' +
      '</div>' +
      '<div class="dpe-section">' +
        '<div class="dpe-section-title">L\\u00E9gende DPE (kWh/m\\u00B2/an)</div>' +
        '<div id="dpe-legend"></div>' +
      '</div>' +
      '<a href="index.html" class="back-link">\\u2190 Vue d\\u2019ensemble {dept_nom}</a>' +
      '<a href="https://www.datamerry.com" target="_top" class="back-link">\\u2190 Retour \\u00E0 datamerry.com</a>' +
      '<div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08);font-size:10px;color:rgba(255,255,255,.25);text-align:center">' +
        '\\u00A9 2026 Samuel Bruno \\u00B7 datamerry.com' +
      '</div>' +
    '</div>' +
  '</div>';

  // ── Toggle collapse ──
  document.getElementById('dpe-tog').onclick = function() {{
    var b = document.getElementById('dpe-body');
    if (b.style.display === 'none') {{ b.style.display = 'block'; this.textContent = '\\u25B2'; }}
    else {{ b.style.display = 'none'; this.textContent = '\\u25BC'; }}
  }};

  // ── Build DPE filter chips ──
  var filtersEl = document.getElementById('dpe-filters');
  DPE_LABELS.forEach(function(lb, i) {{
    var chip = document.createElement('span');
    chip.className = 'dpe-chip ' + (fDpe[i] ? 'active' : 'inactive');
    chip.style.borderColor = DPE_COLORS[i];
    chip.style.color = DPE_COLORS[i];
    chip.style.background = fDpe[i] ? DPE_COLORS[i] + '22' : 'transparent';
    chip.innerHTML = '<span class="dot" style="background:' + DPE_COLORS[i] + '"></span>' + lb;
    chip.dataset.idx = i;
    chip.onclick = function() {{
      fDpe[i] = !fDpe[i];
      this.className = 'dpe-chip ' + (fDpe[i] ? 'active' : 'inactive');
      this.style.background = fDpe[i] ? DPE_COLORS[i] + '22' : 'transparent';
      applyFilters();
    }};
    filtersEl.appendChild(chip);
  }});

  // Quick select buttons
  document.getElementById('dpe-all').onclick = function() {{ fDpe = [true,true,true,true,true,true,true]; syncChips(); applyFilters(); }};
  document.getElementById('dpe-none').onclick = function() {{ fDpe = [false,false,false,false,false,false,false]; syncChips(); applyFilters(); }};
  document.getElementById('dpe-fg').onclick = function() {{ fDpe = [false,false,false,false,false,true,true]; syncChips(); applyFilters(); }};

  function syncChips() {{
    var chips = filtersEl.querySelectorAll('.dpe-chip');
    chips.forEach(function(c, i) {{
      c.className = 'dpe-chip ' + (fDpe[i] ? 'active' : 'inactive');
      c.style.background = fDpe[i] ? DPE_COLORS[i] + '22' : 'transparent';
    }});
  }}

  // ── Build source filter chips ──
  var srcEl = document.getElementById('src-filters');
  SRC_LABELS.forEach(function(lb, i) {{
    if (SRC_TOTALS[i] === 0) return;
    var chip = document.createElement('span');
    chip.className = 'src-chip active';
    chip.textContent = lb + ' (' + SRC_TOTALS[i].toLocaleString('fr') + ')';
    chip.dataset.idx = i;
    chip.onclick = function() {{
      fSrc[i] = !fSrc[i];
      this.className = 'src-chip ' + (fSrc[i] ? 'active' : 'inactive');
      applyFilters();
    }};
    srcEl.appendChild(chip);
  }});

  // ── Build legend ──
  var legEl = document.getElementById('dpe-legend');
  DPE_LABELS.forEach(function(lb, i) {{
    var row = document.createElement('div');
    row.className = 'dpe-legend-row';
    row.innerHTML = '<div class="dpe-legend-swatch" style="background:' + DPE_COLORS[i] + '"></div>' +
      '<span style="font-weight:700;color:' + DPE_COLORS[i] + ';width:14px">' + lb + '</span>' +
      '<span style="color:rgba(255,255,255,.5)">' + DPE_THRESHOLDS[i] + ' kWh/m\\u00B2/an</span>';
    legEl.appendChild(row);
  }});

  // ── Commune search ──
  var searchInput = document.getElementById('dpe-search');
  var searchRes = document.getElementById('dpe-search-res');

  searchInput.addEventListener('input', function() {{
    var q = this.value.toLowerCase().trim();
    searchRes.innerHTML = '';
    if (q.length < 2) return;
    var matches = [];
    COMMUNES.forEach(function(c, i) {{
      if (c.toLowerCase().indexOf(q) >= 0) matches.push(i);
    }});
    matches.slice(0, 8).forEach(function(ci) {{
      var item = document.createElement('div');
      item.className = 'dpe-search-item';
      item.textContent = COMMUNES[ci];
      item.onclick = function() {{
        var bb = COM_BB[ci];
        map.fitBounds([[bb[0], bb[1]], [bb[2], bb[3]]], {{padding: [30, 30], maxZoom: 15}});
        searchRes.innerHTML = '';
        searchInput.value = COMMUNES[ci];
      }};
      searchRes.appendChild(item);
    }});
  }});

  // ── Render points ──
  function applyFilters() {{
    if (currentLayer) {{ map.removeLayer(currentLayer); currentLayer = null; }}
    var group = L.layerGroup();
    var count = 0;
    var dpeCounts = [0,0,0,0,0,0,0];
    var consoSum = 0, consoN = 0;
    var srcCounts = [0,0,0];

    for (var i = 0; i < PTS.length; i++) {{
      var p = PTS[i];
      var dpe = p[2], src = p[3];
      if (!fDpe[dpe] || !fSrc[src]) continue;
      count++;
      dpeCounts[dpe]++;
      srcCounts[src]++;
      if (p[5] > 0) {{ consoSum += p[5]; consoN++; }}

      var marker = L.circleMarker([p[0], p[1]], {{
        radius: 3.5, color: '#ffffff22', weight: 0.5,
        fillColor: DPE_COLORS[dpe], fillOpacity: 0.8
      }});
      marker.bindTooltip(
        '<b style="color:' + DPE_COLORS[dpe] + '">DPE ' + DPE_LABELS[dpe] + '</b> · ' +
        p[4] + ' m\\u00B2 · ' + p[5] + ' kWh/m\\u00B2/an',
        {{direction: 'top', offset: [0, -6]}}
      );
      var addr = ADRESSES[p[7]] || '';
      var dvfZone = p[8];
      var zoneInfo = (dvfZone >= 0 && DVF_ZONES[dvfZone]) ? DVF_ZONES[dvfZone] : null;

      // Build DVF price + décote section
      var dvfHtml = '';
      if (zoneInfo) {{
        var medM2 = zoneInfo.median_m2;
        dvfHtml += '<hr style="margin:6px 0;border:none;border-top:1px solid #eee;">' +
          '<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">\\uD83D\\uDCCA Micro-march\\u00E9 DVF (zone ' + dvfZone + ')</div>' +
          '<div style="font-size:12px;color:#555;line-height:1.7">' +
          'M\\u00E9diane zone: <b style="color:#1a1a2e">' + Math.round(medM2).toLocaleString('fr') + ' \\u20AC/m\\u00B2</b>' +
          ' <span style="font-size:10px;color:#999">(' + zoneInfo.count + ' tx)</span><br>';
        if (zoneInfo.median_m2_good_dpe) {{
          dvfHtml += 'M\\u00E9diane DPE A-E: <b style="color:#319834">' + Math.round(zoneInfo.median_m2_good_dpe).toLocaleString('fr') + ' \\u20AC/m\\u00B2</b>' +
            ' <span style="font-size:10px;color:#999">(' + zoneInfo.n_good + ' tx)</span><br>';
        }}
        if (zoneInfo.median_m2_bad_dpe) {{
          dvfHtml += 'M\\u00E9diane DPE F-G: <b style="color:#ef1d29">' + Math.round(zoneInfo.median_m2_bad_dpe).toLocaleString('fr') + ' \\u20AC/m\\u00B2</b>' +
            ' <span style="font-size:10px;color:#999">(' + zoneInfo.n_bad + ' tx)</span><br>';
        }}
        // Décote calculation: compare bad DPE vs good DPE median
        if (zoneInfo.median_m2_good_dpe && zoneInfo.median_m2_bad_dpe) {{
          var decote = ((zoneInfo.median_m2_good_dpe - zoneInfo.median_m2_bad_dpe) / zoneInfo.median_m2_good_dpe * 100);
          if (decote > 0) {{
            var estVal = (dpe >= 5) ? Math.round(p[4] * zoneInfo.median_m2_bad_dpe) : Math.round(p[4] * zoneInfo.median_m2_good_dpe);
            dvfHtml += '<div style="margin-top:4px;padding:5px 8px;background:#ef1d2912;border-left:3px solid #ef1d29;border-radius:0 4px 4px 0;font-size:11px;line-height:1.5">' +
              '\\u26A0\\uFE0F <b>D\\u00E9cote passoire \\u00E9nerg\\u00E9tique: -' + decote.toFixed(0) + '%</b><br>' +
              '<span style="color:#666">Valeur estim\\u00E9e (' + p[4] + ' m\\u00B2): <b>' + estVal.toLocaleString('fr') + ' \\u20AC</b></span>' +
              '</div>';
          }}
        }}
        dvfHtml += '</div>';
      }}

      marker.bindPopup(
        '<div style="font-family:Segoe UI,sans-serif;padding:10px;min-width:220px">' +
        '<div style="font-size:15px;font-weight:800;color:' + DPE_COLORS[dpe] + ';margin-bottom:6px">DPE ' + DPE_LABELS[dpe] + '</div>' +
        (addr ? '<div style="font-size:12px;color:#333;font-weight:600;margin-bottom:4px">' + addr + '</div>' : '') +
        '<div style="font-size:12px;color:#555;line-height:1.7">' +
        'Commune: <b>' + COMMUNES[p[6]] + '</b><br>' +
        'Surface: <b>' + p[4] + ' m\\u00B2</b><br>' +
        'Conso: <b>' + p[5] + ' kWh/m\\u00B2/an</b><br>' +
        'Source: ' + SRC_LABELS[src] +
        '</div>' + dvfHtml + '</div>',
        {{maxWidth: 320}}
      );
      group.addLayer(marker);
    }}
    group.addTo(map);
    currentLayer = group;

    // Update KPIs
    document.getElementById('kpi-diag').textContent = count.toLocaleString('fr') + ' / ' + TOTAL.toLocaleString('fr');
    var nFG = dpeCounts[5] + dpeCounts[6];
    var pctFG = count > 0 ? (nFG / count * 100).toFixed(0) : '0';
    document.getElementById('kpi-fg').textContent = pctFG + '%';
    // Median approximation: use mean for speed
    var medConso = consoN > 0 ? Math.round(consoSum / consoN) : '\\u2014';
    document.getElementById('kpi-conso').textContent = medConso;

    // Source breakdown
    var srcParts = [];
    SRC_LABELS.forEach(function(lb, i) {{ if (srcCounts[i] > 0) srcParts.push(srcCounts[i].toLocaleString('fr') + ' ' + lb); }});
    document.getElementById('kpi-src').textContent = srcParts.join(' + ');

    // Update distribution bar
    var barEl = document.getElementById('dpe-bar');
    barEl.innerHTML = '';
    DPE_LABELS.forEach(function(lb, i) {{
      if (dpeCounts[i] <= 0 || count <= 0) return;
      var pct = dpeCounts[i] / count * 100;
      var seg = document.createElement('div');
      seg.style.cssText = 'width:' + pct + '%;background:' + DPE_COLORS[i] + ';height:100%';
      seg.title = 'DPE ' + lb + ': ' + pct.toFixed(0) + '% (' + dpeCounts[i].toLocaleString('fr') + ')';
      barEl.appendChild(seg);
    }});
  }}

  // Initial render
  applyFilters();
}})();
</script>"""

    html = html.replace("</head>", custom_css + "</head>")
    html = html.replace("</body>",
        '<div id="copyright-banner">© 2026 Samuel Bruno — datamerry.com</div>\n' +
        "\n</body>")
    # Inject custom JS after </html> so it runs AFTER Folium's map init scripts
    html = html.replace("</html>", custom_js + "\n</html>")

    with open(out_path, "w") as f:
        f.write(html)
    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f"  ✅ {out_path} ({size_mb:.1f} MB)")


# ── DVF cross-referencing ─────────────────────────────────────────────────

def load_dvf(dept_code):
    """Load DVF CSV for the department, filter apartments, compute prix/m²."""
    csv_path = DVF_CSV.get(dept_code)
    if not csv_path or not os.path.exists(csv_path):
        print(f"  DVF CSV not found for {dept_code}")
        return pd.DataFrame()
    df = pd.read_csv(csv_path, low_memory=False)
    df = df.dropna(subset=["latitude", "longitude", "valeur_fonciere"])
    # Keep only residential (Appartement + Maison) for meaningful €/m² comparison
    df = df[df["type_local"].isin(["Appartement", "Maison"])].copy()
    df["surface_reelle_bati"] = pd.to_numeric(df["surface_reelle_bati"], errors="coerce")
    df = df[df["surface_reelle_bati"] > 10].copy()
    df["prix_m2"] = df["valeur_fonciere"] / df["surface_reelle_bati"]
    # Remove outliers
    df = df[(df["prix_m2"] > 500) & (df["prix_m2"] < 25000)].copy()
    # Deduplicate by id_mutation
    if "id_mutation" in df.columns:
        df = df.drop_duplicates(subset=["id_mutation"], keep="first")
    print(f"  DVF chargé : {len(df):,} transactions résidentielles")
    return df


def dvf_hdbscan(dvf, min_cluster_size=30):
    """Run HDBSCAN on DVF transactions, return dvf with 'dvf_cluster' column."""
    if dvf.empty:
        return dvf
    coords = np.radians(dvf[["latitude", "longitude"]].values)
    n = len(dvf)
    mcs = max(min_cluster_size, int(n * 0.005))
    mcs = min(mcs, 200)
    cl = hdbscan.HDBSCAN(
        min_cluster_size=mcs, min_samples=3,
        metric="haversine", cluster_selection_method="eom",
    )
    dvf = dvf.copy()
    dvf["dvf_cluster"] = cl.fit_predict(coords)
    n_cl = int(dvf[dvf["dvf_cluster"] >= 0]["dvf_cluster"].nunique())
    print(f"  DVF micro-marchés : {n_cl}")
    return dvf


def compute_dvf_zone_stats(dvf):
    """Compute per-zone stats: median €/m² global, and by DPE grade if available."""
    if dvf.empty or "dvf_cluster" not in dvf.columns:
        return {}
    stats = {}
    for cid, sub in dvf[dvf["dvf_cluster"] >= 0].groupby("dvf_cluster"):
        zone = {
            "median_m2": float(sub["prix_m2"].median()),
            "count": len(sub),
        }
        # If DPE grades have been matched, compute per-grade medians
        if "matched_dpe" in sub.columns:
            matched = sub.dropna(subset=["matched_dpe"])
            if len(matched) >= 3:
                good = matched[matched["matched_dpe"].isin(["A", "B", "C", "D", "E"])]
                bad = matched[matched["matched_dpe"].isin(["F", "G"])]
                zone["median_m2_good_dpe"] = float(good["prix_m2"].median()) if len(good) >= 3 else None
                zone["median_m2_bad_dpe"] = float(bad["prix_m2"].median()) if len(bad) >= 3 else None
                zone["n_matched"] = len(matched)
                zone["n_good"] = len(good)
                zone["n_bad"] = len(bad)
        stats[int(cid)] = zone
    return stats


def match_dpe_dvf_proximity(dpe_data, dvf, radius_m=150):
    """Match each DVF transaction to the nearest DPE record within radius.
    Returns dvf with 'matched_dpe' column (DPE grade)."""
    if dvf.empty or dpe_data.empty:
        return dvf

    dvf = dvf.copy()
    dpe_coords = np.radians(dpe_data[["latitude", "longitude"]].values)
    dvf_coords = np.radians(dvf[["latitude", "longitude"]].values)

    # BallTree for fast nearest-neighbor lookup
    tree = BallTree(dpe_coords, metric="haversine")
    radius_rad = radius_m / 6_371_000  # Earth radius in meters

    dists, indices = tree.query(dvf_coords, k=1)
    dists_m = dists.flatten() * 6_371_000

    matched_dpe = []
    for i, (d, idx) in enumerate(zip(dists_m, indices.flatten())):
        if d <= radius_m:
            matched_dpe.append(dpe_data.iloc[idx]["etiquette_dpe"])
        else:
            matched_dpe.append(None)

    dvf["matched_dpe"] = matched_dpe
    n_matched = dvf["matched_dpe"].notna().sum()
    print(f"  DVF↔DPE matching : {n_matched:,}/{len(dvf):,} transactions matchées ({radius_m}m)")
    return dvf


def assign_dpe_to_dvf_zone(dpe_data, dvf):
    """Assign each DPE point to the nearest DVF micro-marché centroid."""
    if dvf.empty or "dvf_cluster" not in dvf.columns:
        dpe_data = dpe_data.copy()
        dpe_data["dvf_zone"] = -1
        return dpe_data

    clustered = dvf[dvf["dvf_cluster"] >= 0]
    centroids = clustered.groupby("dvf_cluster")[["latitude", "longitude"]].mean()
    if centroids.empty:
        dpe_data = dpe_data.copy()
        dpe_data["dvf_zone"] = -1
        return dpe_data

    centroid_coords = np.radians(centroids[["latitude", "longitude"]].values)
    centroid_ids = centroids.index.tolist()

    dpe_coords = np.radians(dpe_data[["latitude", "longitude"]].values)
    tree = BallTree(centroid_coords, metric="haversine")
    dists, indices = tree.query(dpe_coords, k=1)
    dists_m = dists.flatten() * 6_371_000

    dpe_data = dpe_data.copy()
    zones = []
    for d, idx in zip(dists_m, indices.flatten()):
        if d <= 2000:  # within 2km of a DVF zone centroid
            zones.append(centroid_ids[idx])
        else:
            zones.append(-1)
    dpe_data["dvf_zone"] = zones
    assigned = sum(1 for z in zones if z >= 0)
    print(f"  DPE→DVF zone : {assigned:,}/{len(dpe_data):,} assignés")
    return dpe_data


# ── Main ──────────────────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print("Usage: python pipeline_dpe.py <CODE_DEPT>")
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
    print(f"  Pipeline DPE : {cfg['nom']} ({dept_code})")
    print(f"  Sortie   : {out_dir}")
    print(f"{'='*60}")

    # 1. Fetch from all 3 sources
    print("\n[1/3] Téléchargement DPE depuis ADEME (3 sources)...")
    all_frames = []
    for ds_key in ["existant", "neuf", "tertiaire"]:
        try:
            records, key = fetch_dpe(ds_key, dept_code)
            if records:
                df = records_to_dataframe(records, key)
                if len(df) > 0:
                    all_frames.append(df)
                    print(f"    {ds_key}: {len(df)} DPE valides")
        except Exception as e:
            print(f"    {ds_key}: erreur — {e}")

    if not all_frames:
        print("Aucune donnée DPE récupérée.")
        sys.exit(1)

    data = pd.concat(all_frames, ignore_index=True)
    print(f"  Total combiné : {len(data)} DPE ({', '.join(f'{k}: {v}' for k, v in data['source'].value_counts().items())})")

    # 2. Cluster DPE
    print("\n[2/5] Clustering HDBSCAN DPE...")
    min_cs = 50 if len(data) > 20000 else (30 if len(data) > 5000 else 15)
    data = run_hdbscan(data, min_cluster_size=min_cs)

    # 3. Load DVF + HDBSCAN micro-marchés
    print("\n[3/5] Chargement DVF + micro-marchés...")
    dvf = load_dvf(dept_code)
    dvf_zone_stats = {}
    if not dvf.empty:
        dvf = dvf_hdbscan(dvf, min_cluster_size=30)

        # 4. Match DVF↔DPE by spatial proximity
        print("\n[4/5] Matching DVF↔DPE par proximité spatiale...")
        dvf = match_dpe_dvf_proximity(data, dvf, radius_m=150)
        dvf_zone_stats = compute_dvf_zone_stats(dvf)

        # 5. Assign each DPE point to nearest DVF zone
        data = assign_dpe_to_dvf_zone(data, dvf)
        print(f"  Stats zones DVF calculées : {len(dvf_zone_stats)} zones avec données prix")
    else:
        data["dvf_zone"] = -1

    # 6. Generate map
    print("\n[5/5] Génération de la carte DPE enrichie...")
    out_path = os.path.join(out_dir, "carte_dpe.html")
    make_dpe_map(data, cfg, out_path, dvf_zone_stats=dvf_zone_stats)

    print(f"\n✅ Pipeline DPE terminé pour {cfg['nom']} ({dept_code})")
    print(f"   {len(data):,} DPE · {len(dvf_zone_stats)} zones DVF · Fichiers dans : {out_dir}")


if __name__ == "__main__":
    main()
