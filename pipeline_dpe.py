#!/usr/bin/env python3
"""
Pipeline DPE — Carte des Diagnostics de Performance Énergétique par département
Génère carte_dpe.html + index_dpe.html pour chaque département IDF

Source : API ADEME (data.ademe.fr) — dataset dpe03existant
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

# ── Config par département ─────────────────────────────────────────────────
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
    "A": "#319834",  # vert foncé
    "B": "#33cc31",  # vert clair
    "C": "#cbfc34",  # jaune-vert
    "D": "#fbfe06",  # jaune
    "E": "#fbcc05",  # orange clair
    "F": "#f58221",  # orange
    "G": "#ef1d29",  # rouge
}

DPE_LABELS = ["A", "B", "C", "D", "E", "F", "G"]

CLUSTER_COLORS = [
    "#00d4ff", "#00ff88", "#ff6600", "#ff0055", "#cc00ff",
    "#ffdd00", "#00ffcc", "#ff3399", "#66ff00", "#0099ff",
    "#ff9900", "#ff00aa", "#00ff44", "#aa00ff", "#ffcc00",
    "#00ccff", "#ff4400", "#44ffaa", "#ff44cc", "#aaff00",
]


def c_color(cid):
    return CLUSTER_COLORS[int(cid) % len(CLUSTER_COLORS)] if cid >= 0 else "#666666"


# ── Fetching DPE data from ADEME API ──────────────────────────────────────
API_BASE = "https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines"
FIELDS = (
    "_geopoint,etiquette_dpe,etiquette_ges,surface_habitable_logement,"
    "type_batiment,date_reception_dpe,nom_commune_ban,code_postal_ban,"
    "adresse_ban,periode_construction,type_energie_principale_chauffage,"
    "conso_5_usages_par_m2_ep,emission_ges_5_usages_par_m2"
)
PAGE_SIZE = 1000
MAX_RECORDS = 10000  # sample cap per department (keeps HTML < 35 MB)


def fetch_dpe_dept(dept_code, max_records=MAX_RECORDS):
    """Fetch DPE data for a department from ADEME API, sorted by most recent."""
    print(f"  Fetching DPE data for dept {dept_code} (max {max_records})...")
    records = []
    after = None
    while len(records) < max_records:
        params = {
            "size": PAGE_SIZE,
            "select": FIELDS,
            "qs": f"code_departement_ban:{dept_code}",
            "sort": "-date_reception_dpe",
        }
        if after:
            params["after"] = after
        for attempt in range(4):
            try:
                resp = requests.get(API_BASE, params=params, timeout=30)
                resp.raise_for_status()
                break
            except Exception as e:
                wait = 2 ** (attempt + 1)
                print(f"    Retry {attempt+1}/4 after {wait}s: {e}")
                time.sleep(wait)
        else:
            print(f"    Failed after 4 retries, stopping at {len(records)} records")
            break
        data = resp.json()
        results = data.get("results", [])
        if not results:
            break
        records.extend(results)
        next_url = data.get("next")
        if not next_url:
            break
        # Extract 'after' cursor from next URL
        from urllib.parse import urlparse, parse_qs
        parsed = parse_qs(urlparse(next_url).query)
        after = parsed.get("after", [None])[0]
        if not after:
            break
        print(f"    Fetched {len(records)} records...", end="\r")
    print(f"  Fetched {len(records)} DPE records for dept {dept_code}")
    return records


def records_to_dataframe(records):
    """Convert API records to a clean DataFrame."""
    df = pd.DataFrame(records)
    if df.empty:
        return df
    # Parse geopoint
    gp = df["_geopoint"].dropna().str.split(",", expand=True)
    df.loc[gp.index, "latitude"] = pd.to_numeric(gp[0], errors="coerce")
    df.loc[gp.index, "longitude"] = pd.to_numeric(gp[1], errors="coerce")
    df = df.dropna(subset=["latitude", "longitude", "etiquette_dpe"])
    # Filter valid DPE labels
    df = df[df["etiquette_dpe"].isin(DPE_LABELS)].copy()
    # Numeric conversions
    df["surface_habitable_logement"] = pd.to_numeric(df.get("surface_habitable_logement"), errors="coerce")
    df["conso_5_usages_par_m2_ep"] = pd.to_numeric(df.get("conso_5_usages_par_m2_ep"), errors="coerce")
    df["emission_ges_5_usages_par_m2"] = pd.to_numeric(df.get("emission_ges_5_usages_par_m2"), errors="coerce")
    df["date_reception_dpe"] = pd.to_datetime(df.get("date_reception_dpe"), errors="coerce")
    # DPE numeric score (A=1, G=7) for clustering analysis
    dpe_score = {"A": 1, "B": 2, "C": 3, "D": 4, "E": 5, "F": 6, "G": 7}
    df["dpe_score"] = df["etiquette_dpe"].map(dpe_score)
    print(f"  Clean DataFrame: {len(df)} rows")
    return df


# ── HDBSCAN clustering ────────────────────────────────────────────────────
def run_hdbscan(data, min_cluster_size=30):
    coords = np.radians(data[["latitude", "longitude"]].values)
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=5,
        metric="haversine",
        cluster_selection_method="eom",
    )
    data = data.copy()
    data["cluster"] = clusterer.fit_predict(coords)
    n_clusters = int(data[data["cluster"] >= 0]["cluster"].nunique())
    print(f"  Micro-zones DPE : {n_clusters}")
    return data


def apply_jitter(df, radius_deg=0.00008):
    df = df.copy()
    df["lat_j"] = df["latitude"].astype(float)
    df["lon_j"] = df["longitude"].astype(float)
    groups = df.groupby(["latitude", "longitude"])
    for (lat, lon), idx in groups.groups.items():
        n = len(idx)
        if n == 1:
            continue
        angles = np.linspace(0, 2 * np.pi * (1 + n // 8), n, endpoint=False)
        radii = np.linspace(radius_deg * 0.3, radius_deg, n)
        df.loc[idx, "lat_j"] = lat + radii * np.sin(angles)
        df.loc[idx, "lon_j"] = lon + radii * np.cos(angles)
    return df


# ── Cluster stats ─────────────────────────────────────────────────────────
def cluster_dpe_distribution(sub):
    """Return DPE distribution string for a cluster."""
    dist = sub["etiquette_dpe"].value_counts()
    total = len(sub)
    parts = []
    for label in DPE_LABELS:
        n = dist.get(label, 0)
        if n > 0:
            pct = n / total * 100
            parts.append(f"<span style='color:{DPE_COLORS[label]};font-weight:700;'>{label}</span>: {pct:.0f}%")
    return " · ".join(parts)


def dominant_dpe(sub):
    """Return the most frequent DPE label."""
    return sub["etiquette_dpe"].mode().iloc[0] if len(sub) > 0 else "D"


# ── Map generation ────────────────────────────────────────────────────────
def make_dpe_map(data, cfg, out_path):
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

    # ── Heatmap: consommation énergie (kWh/m²/an) ──
    heat_data = data[["latitude", "longitude", "conso_5_usages_par_m2_ep"]].dropna().copy()
    if len(heat_data) > 0:
        vmin_h = heat_data["conso_5_usages_par_m2_ep"].quantile(0.05)
        vmax_h = heat_data["conso_5_usages_par_m2_ep"].quantile(0.95)
        if vmin_h < vmax_h:
            heat_data["w"] = (heat_data["conso_5_usages_par_m2_ep"] - vmin_h) / (vmax_h - vmin_h)
            heat_data["w"] = heat_data["w"].clip(0, 1)
        else:
            heat_data["w"] = 0.5
        hm_fg = folium.FeatureGroup(name="🌡️ Heatmap conso. énergie (kWh/m²/an)", show=False)
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
            color = DPE_COLORS.get(dom, "#666666")
            dist_html = cluster_dpe_distribution(sub)
            med_conso = sub["conso_5_usages_par_m2_ep"].median()
            med_conso_s = f"{med_conso:.0f} kWh/m²/an" if pd.notna(med_conso) else "—"
            med_ges = sub["emission_ges_5_usages_par_m2"].median()
            med_ges_s = f"{med_ges:.1f} kgCO₂/m²/an" if pd.notna(med_ges) else "—"

            popup_html = f"""
            <div style="font-family:'Segoe UI',Arial,sans-serif; min-width:240px; color:#222;">
              <div style="background:{color};color:#000;padding:8px 12px;border-radius:6px 6px 0 0;font-weight:700;font-size:14px;">
                Micro-zone {cid} · DPE dominant : {dom}
              </div>
              <div style="padding:10px 12px;background:#f9f9f9;border-radius:0 0 6px 6px;">
                <div style="font-size:12px;margin-bottom:8px;">{dist_html}</div>
                <table style="width:100%;font-size:13px;border-collapse:collapse;">
                  <tr><td style="color:#666;padding:3px 0;">DPE diagnostiqués</td><td style="font-weight:600;text-align:right;">{len(sub)}</td></tr>
                  <tr><td style="color:#666;padding:3px 0;">Conso. médiane</td><td style="font-weight:600;text-align:right;">{med_conso_s}</td></tr>
                  <tr><td style="color:#666;padding:3px 0;">GES médian</td><td style="font-weight:600;text-align:right;">{med_ges_s}</td></tr>
                </table>
              </div>
            </div>"""
            folium.Polygon(
                locations=hull_pts, color=color,
                fill=True, fill_color=color, fill_opacity=0.12, weight=2,
                popup=folium.Popup(popup_html, max_width=280),
                tooltip=f"<b style='color:{color}'>Zone {cid}</b> · DPE {dom} · {len(sub)} diag.",
            ).add_to(poly_fg)
        except Exception:
            pass
    poly_fg.add_to(m)

    # ── Points par étiquette DPE ──
    for label in DPE_LABELS:
        sub_label = data[data["etiquette_dpe"] == label]
        if len(sub_label) == 0:
            continue
        color = DPE_COLORS[label]
        fg = folium.FeatureGroup(name=f"🏷️ DPE {label} ({len(sub_label)})", show=(label in ["F", "G"]))  # show passoires by default
        for _, row in sub_label.iterrows():
            cid = int(row.get("cluster", -1))
            zone_label = f"Micro-zone {cid}" if cid >= 0 else "Isolé"
            adresse = str(row.get("adresse_ban", "")) or "Adresse inconnue"
            commune = str(row.get("nom_commune_ban", "")) or ""
            surface = row.get("surface_habitable_logement")
            surface_s = f"{float(surface):.0f} m²" if pd.notna(surface) else "—"
            type_bat = str(row.get("type_batiment", "")) or "—"
            periode = str(row.get("periode_construction", "")) or "—"
            chauffage = str(row.get("type_energie_principale_chauffage", "")) or "—"
            conso = row.get("conso_5_usages_par_m2_ep")
            conso_s = f"{float(conso):.0f} kWh/m²/an" if pd.notna(conso) else "—"
            ges = row.get("emission_ges_5_usages_par_m2")
            ges_s = f"{float(ges):.1f} kgCO₂/m²/an" if pd.notna(ges) else "—"
            ges_label = str(row.get("etiquette_ges", "")) or "—"
            date_dpe = row.get("date_reception_dpe")
            date_s = date_dpe.strftime("%d/%m/%Y") if pd.notna(date_dpe) else "—"

            popup_html = (
                f"<div style='font-family:Segoe UI,sans-serif;min-width:200px;color:#222;'>"
                f"<div style='background:#1a1a2e;color:#fff;padding:8px 12px;border-radius:6px 6px 0 0;'>"
                f"<b style='font-size:13px;'>{adresse[:50]}</b><br>"
                f"<span style='font-size:11px;opacity:.7;'>{commune} · {type_bat}</span></div>"
                f"<div style='padding:10px 12px;background:#fdfdfd;border-radius:0 0 6px 6px;'>"
                f"<span style='font-size:26px;font-weight:900;color:{color};'>{label}</span>"
                f" <span style='color:#888;'>GES {ges_label}</span> · {surface_s}<br>"
                f"<span style='font-size:12px;color:#555;'>{conso_s} · {ges_s}<br>"
                f"{periode} · {chauffage}<br>{date_s} · {zone_label}</span></div></div>"
            )
            folium.CircleMarker(
                location=[row.get("lat_j", row["latitude"]), row.get("lon_j", row["longitude"])],
                radius=4, color="#ffffff22", fill=True,
                fill_color=color, fill_opacity=0.85, weight=0.5,
                popup=folium.Popup(popup_html, max_width=270),
                tooltip=f"<span style='font-size:12px;'><b style='color:{color}'>DPE {label}</b> · {surface_s} · {conso_s}</span>",
            ).add_to(fg)
        fg.add_to(m)

    folium.LayerControl(collapsed=False, position="topright").add_to(m)

    # ── Dashboard overlay ──
    n_clusters = int(data[data["cluster"] >= 0]["cluster"].nunique()) if "cluster" in data.columns else 0
    dpe_dist = data["etiquette_dpe"].value_counts()
    n_passoires = int(dpe_dist.get("F", 0) + dpe_dist.get("G", 0))
    pct_passoires = n_passoires / len(data) * 100 if len(data) > 0 else 0
    med_conso = data["conso_5_usages_par_m2_ep"].median()
    med_conso_s = f"{med_conso:.0f}" if pd.notna(med_conso) else "—"

    # DPE distribution bar
    dist_bar_parts = ""
    for label in DPE_LABELS:
        n = dpe_dist.get(label, 0)
        pct = n / len(data) * 100 if len(data) > 0 else 0
        if pct > 0:
            dist_bar_parts += f'<div style="width:{pct}%;background:{DPE_COLORS[label]};height:100%;display:inline-block;" title="DPE {label}: {pct:.0f}%"></div>'

    dashboard = f"""
<style>
  #dashdpe{dept_code} {{
    position: fixed; top: 10px; left: 10px; z-index: 9999;
    background: linear-gradient(135deg, rgba(10,10,30,0.97), rgba(20,20,50,0.97));
    color: #e8e8f0; font-family: 'Segoe UI', Arial, sans-serif;
    border-radius: 12px; padding: 0; width: 300px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.6);
    border: 1px solid rgba(255,255,255,0.1); overflow: hidden;
  }}
  #dashdpe{dept_code}-header {{
    background: linear-gradient(90deg, {dept_color}22, rgba(255,255,255,0.03));
    padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.1);
  }}
  #dashdpe{dept_code}-header h2 {{ margin: 0; font-size: 14px; font-weight: 700; color: #fff; }}
  #dashdpe{dept_code}-header p {{ margin: 3px 0 0; font-size: 11px; color: rgba(255,255,255,.5); }}
  #dashdpe{dept_code}-body {{ padding: 12px 16px; }}
  .dpe-kpi-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; }}
  .dpe-kpi {{ background: rgba(255,255,255,0.06); border-radius: 8px; padding: 9px; text-align: center; border: 1px solid rgba(255,255,255,0.08); }}
  .dpe-kpi .val {{ font-size: 16px; font-weight: 800; color: {dept_color}; }}
  .dpe-kpi .lbl {{ font-size: 10px; color: rgba(255,255,255,.45); margin-top: 2px; text-transform:uppercase; letter-spacing:.5px; }}
  .dpe-dist-bar {{ width: 100%; height: 10px; border-radius: 5px; overflow: hidden; background: rgba(255,255,255,0.08); margin-bottom: 12px; display: flex; }}
  #dashdpe{dept_code}-toggle {{ position: absolute; top: 8px; right: 12px; cursor: pointer; color: rgba(255,255,255,.5); font-size: 16px; user-select:none; }}
  #dashdpe{dept_code}-toggle:hover {{ color: #fff; }}
  .back-link {{ display:block; margin-top: 10px; padding: 7px 10px; border-radius: 7px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: rgba(255,255,255,0.5); font-size: 11px; text-decoration: none; text-align: center; transition: all 0.2s; }}
  .back-link:hover {{ background: rgba(255,255,255,0.1); color: #fff; }}
</style>
<div id="dashdpe{dept_code}">
  <div id="dashdpe{dept_code}-header">
    <span id="dashdpe{dept_code}-toggle" onclick="
      var b=document.getElementById('dashdpe{dept_code}-body');
      var t=document.getElementById('dashdpe{dept_code}-toggle');
      if(b.style.display==='none'){{b.style.display='block';t.textContent='▲'}}
      else{{b.style.display='none';t.textContent='▼'}}
    ">▲</span>
    <h2>🏷️ DPE · {dept_nom} ({dept_code})</h2>
    <p>Diagnostics de Performance Énergétique · Source ADEME</p>
  </div>
  <div id="dashdpe{dept_code}-body">
    <div class="dpe-dist-bar">{dist_bar_parts}</div>
    <div class="dpe-kpi-grid">
      <div class="dpe-kpi"><div class="val">{len(data):,}</div><div class="lbl">Diagnostics</div></div>
      <div class="dpe-kpi"><div class="val">{n_clusters}</div><div class="lbl">Micro-zones</div></div>
      <div class="dpe-kpi"><div class="val" style="color:#ef1d29;">{pct_passoires:.0f}%</div><div class="lbl">Passoires (F+G)</div></div>
      <div class="dpe-kpi"><div class="val">{med_conso_s}</div><div class="lbl">kWh/m²/an méd.</div></div>
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
    with open(out_path, "r") as f:
        html = f.read()
    extra = """<style>
  .leaflet-popup-content-wrapper { border-radius:8px!important; padding:0!important; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.35)!important; }
  .leaflet-popup-content { margin:0!important; }
  .leaflet-control-layers { background:rgba(15,15,35,0.95)!important; color:#ddd!important; border:1px solid rgba(255,255,255,0.15)!important; border-radius:8px!important; max-width:none!important; }
  .leaflet-control-layers label { color:#ccc!important; white-space:nowrap!important; }
  #copyright-banner { position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(10,10,20,0.75);color:rgba(255,255,255,0.7);font-family:'Segoe UI',Arial,sans-serif;font-size:11px;padding:4px 12px;border-radius:20px;border:1px solid rgba(255,255,255,0.1);backdrop-filter:blur(4px);pointer-events:none; }
</style>"""
    html = html.replace("</head>", extra + "</head>")
    html = html.replace("</body>", '<div id="copyright-banner">© 2026 Samuel Bruno — datamerry.com</div>\n</body>')
    with open(out_path, "w") as f:
        f.write(html)
    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f"  ✅ {out_path} ({size_mb:.1f} MB)")


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

    # 1. Fetch
    print("\n[1/3] Téléchargement DPE depuis ADEME...")
    records = fetch_dpe_dept(dept_code)
    if not records:
        print("Aucune donnée DPE récupérée.")
        sys.exit(1)

    # 2. Process
    print("\n[2/3] Traitement et clustering...")
    df = records_to_dataframe(records)
    if len(df) < 50:
        print(f"Trop peu de DPE ({len(df)}), abandon.")
        sys.exit(1)

    min_cs = 30 if len(df) > 5000 else 15
    df = run_hdbscan(df, min_cluster_size=min_cs)

    # 3. Generate map
    print("\n[3/3] Génération de la carte DPE...")
    out_path = os.path.join(out_dir, "carte_dpe.html")
    make_dpe_map(df, cfg, out_path)

    print(f"\n✅ Pipeline DPE terminé pour {cfg['nom']} ({dept_code})")
    print(f"   Fichiers dans : {out_dir}")


if __name__ == "__main__":
    main()
