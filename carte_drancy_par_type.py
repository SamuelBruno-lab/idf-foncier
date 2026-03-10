"""
Pipeline HDBSCAN — Carte foncière Drancy (93029)
Génère carte_appartements.html, carte_maisons.html, carte_commerces.html + index.html
Usage: python carte_drancy_par_type.py
"""
import pandas as pd
import numpy as np
import folium
from folium.plugins import HeatMap, MiniMap, Fullscreen
import hdbscan
from scipy.spatial import ConvexHull
import branca.colormap as cm
import os

COMMUNE_CODE = "93029"
COMMUNE_NOM  = "Drancy"
OUT_DIR      = f"/home/user/maps_{COMMUNE_CODE}"
COLOR        = "#00d4ff"

def aggregate_mutations(data):
    """Une ligne par mutation pour les mutations pures :
    - Sépare les mutations mixtes (plusieurs type_local) pour ventilation ultérieure
    - Agrège surface_terrain (somme des parcelles) pour les maisons
    - Agrège surface_reelle_bati (somme Carrez) pour les appartements
    Retourne : (pure_dedup, mixed_raw)
    """
    if "id_mutation" not in data.columns:
        return data, pd.DataFrame()
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


def ventiler_mutations_mixtes(mixed_data, median_m2_by_type):
    """Ventile le prix total de chaque mutation mixte entre ses composantes."""
    if mixed_data.empty:
        return pd.DataFrame()
    results = []
    for id_mut, group in mixed_data.groupby("id_mutation"):
        total_val = float(group["valeur_fonciere"].iloc[0])
        type_groups = []
        for tl, tl_grp in group.groupby("type_local", dropna=False):
            template = tl_grp.iloc[0].copy()
            surf_bati    = tl_grp["surface_reelle_bati"].sum() if "surface_reelle_bati" in tl_grp.columns else np.nan
            surf_terrain = tl_grp["surface_terrain"].sum()     if "surface_terrain"     in tl_grp.columns else np.nan
            template["surface_reelle_bati"] = surf_bati    if (pd.notna(surf_bati)    and surf_bati    > 0) else np.nan
            template["surface_terrain"]     = surf_terrain if (pd.notna(surf_terrain) and surf_terrain > 0) else np.nan
            surf   = surf_bati if (pd.notna(surf_bati) and surf_bati > 0) else np.nan
            m2_med = median_m2_by_type.get(tl, np.nan)
            theorique = float(surf) * float(m2_med) if (pd.notna(surf) and pd.notna(m2_med)) else np.nan
            type_groups.append({"row": template, "type_local": tl, "theorique": theorique, "surface": surf})
        total_theorique = sum(c["theorique"] for c in type_groups if pd.notna(c["theorique"]))
        for c in type_groups:
            new_row = c["row"].copy()
            if total_theorique > 0 and pd.notna(c["theorique"]):
                new_row["valeur_fonciere"] = total_val * (c["theorique"] / total_theorique)
            else:
                new_row["valeur_fonciere"] = total_val / len(type_groups)
            new_row["is_ventile"]             = True
            new_row["valeur_fonciere_totale"] = total_val
            surf = c["surface"]
            new_row["prix_m2"] = (new_row["valeur_fonciere"] / float(surf)
                                  if pd.notna(surf) and float(surf) > 0 else np.nan)
            results.append(new_row)
    if not results:
        return pd.DataFrame()
    ventile_df = pd.DataFrame(results)
    n_mut = mixed_data["id_mutation"].nunique()
    print(f"  Mutations mixtes ventilées : {n_mut} mutations → {len(ventile_df)} composantes")
    return ventile_df

# ── 1. Chargement & nettoyage ─────────────────────────────────────────────────
raw = pd.read_csv(f"/home/user/dvf_{COMMUNE_CODE}.csv", low_memory=False)
raw = raw.dropna(subset=["latitude", "longitude", "valeur_fonciere"])
raw = raw[raw["valeur_fonciere"] > 0]
raw = raw.drop_duplicates(subset=["id_mutation", "id_parcelle"])  # doublons bruts
# Exclusion des caves et dépendances
raw = raw[raw["type_local"] != "Dépendance"]
# Exclusion des VEFA maisons
raw = raw[~((raw["nature_mutation"] == "Vente en l'état futur d'achèvement") &
            (raw["type_local"] == "Maison"))]
raw["valeur_fonciere"]     = pd.to_numeric(raw["valeur_fonciere"],     errors="coerce")
raw["surface_reelle_bati"] = pd.to_numeric(raw["surface_reelle_bati"], errors="coerce")
raw["surface_terrain"]     = pd.to_numeric(raw["surface_terrain"],     errors="coerce")
raw["date_mutation"]       = pd.to_datetime(raw["date_mutation"],       errors="coerce")
raw["annee"] = raw["date_mutation"].dt.year.fillna(2024).astype(int)
# Agréger par mutation : séparation pures/mixtes + somme surfaces parcelles/Carrez
raw, mixed_raw = aggregate_mutations(raw)
# Prix/m² : surface bâtie pour appartements et maisons (agrégée)
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

# Suppression des outliers DVF aberrants
SEUIL_PRIX_M2 = {"Maison": 9000, "Appartement": 12000,
                 "Local industriel. commercial ou assimilé": 12000}
for tl, seuil in SEUIL_PRIX_M2.items():
    mask = (raw["type_local"] == tl) & (raw["prix_m2"] > seuil)
    n = mask.sum()
    if n:
        print(f"Suppression {n} outliers {tl} > {seuil} €/m²")
    raw = raw[~mask]

# ── Ventilation des mutations mixtes ──────────────────────────────────────────
median_m2_by_type = {}
for tl in raw["type_local"].dropna().unique():
    subset = raw[(raw["type_local"] == tl) & raw["prix_m2"].notna() & (raw["prix_m2"] > 0)]
    if len(subset) > 0:
        median_m2_by_type[tl] = subset["prix_m2"].median()
        print(f"  Médiane {tl}: {median_m2_by_type[tl]:,.0f} €/m²")

if not mixed_raw.empty:
    ventile_df = ventiler_mutations_mixtes(mixed_raw, median_m2_by_type)
    if not ventile_df.empty:
        raw = pd.concat([raw, ventile_df], ignore_index=True)
        print(f"  Total après ventilation : {len(raw)} transactions")

# ── 2. Jitter ─────────────────────────────────────────────────────────────────
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

# ── 3. Utilitaires ────────────────────────────────────────────────────────────
CLUSTER_COLORS = [
    "#00d4ff","#00ff88","#ff6600","#ff0055","#cc00ff",
    "#ffdd00","#00ffcc","#ff3399","#66ff00","#0099ff",
    "#ff9900","#ff00aa","#00ff44","#aa00ff","#ffcc00",
    "#00ccff","#ff4400","#44ffaa","#ff44cc","#aaff00",
]
YEAR_ICONS = {2020:"🔵",2021:"🟢",2022:"🟡",2023:"🟠",2024:"🔴",2025:"🟣"}

def c_color(cid):
    return CLUSTER_COLORS[cid % len(CLUSTER_COLORS)] if cid >= 0 else "#666666"

extra_css = """
<style>
  .leaflet-popup-content-wrapper {
    border-radius: 8px !important; padding: 0 !important;
    overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.35) !important;
  }
  .leaflet-popup-content { margin: 0 !important; }
  .leaflet-popup-tip { background: #fdfdfd !important; }
  .leaflet-control-layers {
    background: rgba(15,15,35,0.95) !important; color: #ddd !important;
    border: 1px solid rgba(255,255,255,0.15) !important; border-radius: 8px !important;
  }
  .leaflet-control-layers label { color: #ccc !important; }
  .leaflet-control-layers-separator { border-top: 1px solid rgba(255,255,255,0.1) !important; }
</style>
"""
copyright_css = """
<style>
#copyright-banner {
    position: fixed; bottom: 8px; left: 50%; transform: translateX(-50%);
    z-index: 9999; background: rgba(10,10,20,0.75); color: rgba(255,255,255,0.7);
    font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px;
    padding: 4px 12px; border-radius: 20px;
    border: 1px solid rgba(255,255,255,0.1); backdrop-filter: blur(4px);
    pointer-events: none; letter-spacing: 0.3px;
}
</style>
"""
copyright_div = '<div id="copyright-banner">© 2026 Samuel Bruno — Tous droits réservés</div>'


# ── 4. Génération d'une carte ─────────────────────────────────────────────────
def build_map(data, title, subtitle, min_cluster_size, out_path,
              cluster_selection_method="eom", min_samples=3,
              surface_col="surface_reelle_bati", surface_label="m² Carrez",
              colormap_caption="Prix au m² (€)"):
    if data.empty:
        print(f"Aucune donnée pour {title}, skip.")
        return

    data = apply_jitter(data)

    coords = np.radians(data[["latitude", "longitude"]].values)
    cl = hdbscan.HDBSCAN(
        min_cluster_size=min_cluster_size,
        min_samples=min_samples,
        metric="haversine",
        cluster_selection_method=cluster_selection_method,
    )
    data = data.copy()
    data["cluster"] = cl.fit_predict(coords)
    n_clusters = int(data[data["cluster"] >= 0]["cluster"].nunique())
    n_noise    = int((data["cluster"] == -1).sum())
    print(f"\n{title} → {len(data)} tx | Clusters: {n_clusters} | Isolés: {n_noise}")

    valid = data["prix_m2"].dropna()
    if len(valid) > 0:
        p5, p95 = valid.quantile(0.05), valid.quantile(0.95)
    else:
        p5, p95 = 0, 1
    colormap = cm.LinearColormap(
        colors=["#00d4ff","#00ff88","#ffdd00","#ff6600","#ff0055"],
        vmin=p5, vmax=p95, caption=colormap_caption,
    )
    def price_color(v):
        if pd.isna(v): return "#aaaaaa"
        return colormap(max(p5, min(p95, v)))

    total_tx  = len(data)
    med_prix  = data["valeur_fonciere"].median()
    med_m2    = data["prix_m2"].median()
    prix_by_y = data.groupby("annee")["valeur_fonciere"].median().to_dict()
    m2_by_y   = data.groupby("annee")["prix_m2"].median().to_dict()

    year_rows = ""
    for y in sorted(prix_by_y):
        m2v = m2_by_y.get(y, float("nan"))
        m2s = f"{m2v:,.0f} €/m²" if pd.notna(m2v) and not np.isnan(m2v) else "—"
        year_rows += f"<tr><td>{y}</td><td>{prix_by_y[y]:,.0f} €</td><td>{m2s}</td></tr>"

    cluster_rows = ""
    for cid in sorted(data[data["cluster"] >= 0]["cluster"].unique()):
        sub = data[data["cluster"] == cid]
        m2v = sub["prix_m2"].median()
        m2s = f"{m2v:,.0f}" if pd.notna(m2v) and not np.isnan(m2v) else "—"
        cluster_rows += f"<tr><td>Zone {cid}</td><td>{len(sub)}</td><td>{m2s} €/m²</td></tr>"

    type_counts = data["type_local"].value_counts(dropna=False)
    badge_html = ""
    BADGE_COLORS = {
        "Appartement": ("#00d4ff22","#00d4ff","#00d4ff44","🏢"),
        "Maison":      ("#ff660022","#ff8844","#ff660044","🏠"),
        "Local industriel. commercial ou assimilé": ("#ffdd0022","#ffdd00","#ffdd0044","🏭"),
    }
    for tl, cnt in type_counts.items():
        if pd.isna(tl):
            badge_html += f"<span class='badge' style='background:#ffffff11;color:#aaa;border:1px solid #ffffff22;'>📦 {cnt}</span>"
        else:
            bg, fg, border, icon = BADGE_COLORS.get(tl, ("#ffffff11","#aaa","#ffffff22","•"))
            label = tl if len(tl) < 22 else tl[:20]+"…"
            badge_html += f"<span class='badge' style='background:{bg};color:{fg};border:1px solid {border};'>{icon} {cnt} {label}</span>"

    med_m2_display = f"{med_m2:,.0f}€" if pd.notna(med_m2) else "—"

    center = [data["latitude"].mean(), data["longitude"].mean()]
    m = folium.Map(location=center, zoom_start=14, tiles=None, prefer_canvas=True)
    folium.TileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
        attr='&copy; OSM &copy; CARTO', name="Dark (défaut)", max_zoom=19, subdomains="abcd",
    ).add_to(m)
    folium.TileLayer(
        "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
        attr='&copy; OSM &copy; CARTO', name="Light", max_zoom=19, subdomains="abcd",
    ).add_to(m)
    Fullscreen(position="topright").add_to(m)
    MiniMap(position="bottomleft", tile_layer="CartoDB dark_matter", zoom_level_offset=-5).add_to(m)

    heat_w = data[["latitude","longitude","prix_m2"]].dropna(subset=["prix_m2"]).copy()
    if len(heat_w) > 0:
        p75_h = valid.quantile(0.75)
        vmin_h, vmax_h = p5, p75_h
        heat_w["w"] = (heat_w["prix_m2"].clip(vmin_h, vmax_h) - vmin_h) / (vmax_h - vmin_h + 1)
        hfg = folium.FeatureGroup(name="🌡️ pression foncière : densité des transactions", show=False)
        HeatMap(
            heat_w[["latitude","longitude","w"]].values.tolist(),
            radius=20, blur=15, min_opacity=0.3,
            gradient={0.2:"#00d4ff",0.5:"#ffdd00",0.8:"#ff6600",1.0:"#ff0055"},
        ).add_to(hfg)
        hfg.add_to(m)

    pfg = folium.FeatureGroup(name="🗺️ Micromarchés", show=True)
    for cid in sorted(data[data["cluster"] >= 0]["cluster"].unique()):
        pts = data[data["cluster"] == cid][["latitude","longitude"]].values
        if len(pts) < 3:
            continue
        try:
            hull = ConvexHull(pts)
            hull_pts = pts[hull.vertices].tolist()
            hull_pts.append(hull_pts[0])
            color = c_color(cid)
            sub = data[data["cluster"] == cid]
            n, med = len(sub), sub["valeur_fonciere"].median()
            med_m2v = sub["prix_m2"].median()
            med_m2s = f"{med_m2v:,.0f} €/m²" if pd.notna(med_m2v) and not np.isnan(med_m2v) else "—"
            popup_html = f"""
            <div style="font-family:'Segoe UI',Arial,sans-serif;min-width:210px;color:#222;">
              <div style="background:{color};color:#000;padding:8px 12px;border-radius:6px 6px 0 0;font-weight:700;font-size:14px;">Zone {cid}</div>
              <div style="padding:10px 12px;background:#f9f9f9;border-radius:0 0 6px 6px;">
                <table style="width:100%;font-size:13px;border-collapse:collapse;">
                  <tr><td style="color:#666;padding:3px 0;">Transactions</td><td style="font-weight:600;text-align:right;">{n}</td></tr>
                  <tr><td style="color:#666;padding:3px 0;">Prix médian</td><td style="font-weight:600;text-align:right;">{med:,.0f} €</td></tr>
                  <tr><td style="color:#666;padding:3px 0;">Prix/m² médian</td><td style="font-weight:600;text-align:right;">{med_m2s}</td></tr>
                </table>
              </div>
            </div>"""
            folium.Polygon(
                locations=hull_pts, color=color,
                fill=True, fill_color=color, fill_opacity=0.10, weight=2,
                popup=folium.Popup(popup_html, max_width=250),
                tooltip=f"<b style='color:{color}'>Zone {cid}</b> · {n} tx · {med:,.0f} €",
            ).add_to(pfg)
        except Exception:
            pass
    pfg.add_to(m)

    years_in_data = sorted(data["annee"].dropna().unique().astype(int).tolist())
    for year in years_in_data:
        fg = folium.FeatureGroup(name=f"{YEAR_ICONS.get(year,'•')} {year}", show=True)
        subset = data[data["annee"] == year]
        for _, row in subset.iterrows():
            cid   = int(row["cluster"])
            color = price_color(row["prix_m2"])
            zone_label = f"Zone {cid}" if cid >= 0 else "Isolé"
            surf_val   = row.get(surface_col)
            surface_s  = f"{float(surf_val):.0f} {surface_label}" if pd.notna(surf_val) and float(surf_val) > 0 else "—"
            prix_m2_s  = f"{row['prix_m2']:,.0f} €/m²" if pd.notna(row["prix_m2"]) else "—"
            adresse = " ".join(filter(lambda x: x and str(x) != "nan", [
                str(row.get("adresse_numero","") or ""),
                str(row.get("adresse_nom_voie","") or ""),
            ])).strip() or "Adresse inconnue"
            date_s  = row["date_mutation"].strftime("%d/%m/%Y") if pd.notna(row["date_mutation"]) else "—"
            type_s  = str(row.get("type_local","") or "—")
            pieces  = row.get("nombre_pieces_principales","")
            pieces_s = f"{int(pieces)} pce{'s' if pieces > 1 else ''}" if pd.notna(pieces) and pieces > 0 else ""

            jitter_note = ""
            if abs(row["lat_j"] - row["latitude"]) > 1e-8 or abs(row["lon_j"] - row["longitude"]) > 1e-8:
                jitter_note = "<div style='font-size:10px;color:#f90;margin-top:4px;'>⚠️ Position légèrement décalée (adresse groupée)</div>"

            is_ventile = bool(row.get("is_ventile", False))
            val_totale = row.get("valeur_fonciere_totale", np.nan)
            ventile_note = ""
            if is_ventile and pd.notna(val_totale):
                ventile_note = (
                    f"<div style='font-size:10px;color:#ff9900;margin-top:4px;"
                    f"background:rgba(255,153,0,0.1);padding:3px 7px;border-radius:4px;"
                    f"border-left:3px solid #ff9900;'>"
                    f"⚖️ Vente mixte ventilée · Prix total acte : {float(val_totale):,.0f} €</div>"
                )

            popup_html = f"""
            <div style="font-family:'Segoe UI',Arial,sans-serif;min-width:220px;color:#222;">
              <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);color:#fff;padding:10px 14px;border-radius:6px 6px 0 0;">
                <div style="font-size:13px;font-weight:700;">{adresse}</div>
                <div style="font-size:11px;opacity:.75;margin-top:2px;">{type_s}{(' · '+pieces_s) if pieces_s else ''}</div>
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
                location=[row["lat_j"], row["lon_j"]],
                radius=6, color="#ffffff22", fill=True,
                fill_color=color, fill_opacity=0.85, weight=0.5,
                popup=folium.Popup(popup_html, max_width=270),
                tooltip=(
                    f"<span style='font-size:12px;'>"
                    f"<b>{row['valeur_fonciere']:,.0f} €</b> · {prix_m2_s} · {date_s}"
                    f"</span>"
                ),
            ).add_to(fg)
        fg.add_to(m)

    colormap.add_to(m)
    folium.LayerControl(collapsed=False, position="topright").add_to(m)

    dashboard = f"""
<style>
  #drancy-dashboard {{
    position:fixed;top:10px;left:10px;z-index:9999;
    background:linear-gradient(135deg,rgba(10,10,30,0.97),rgba(20,20,50,0.97));
    color:#e8e8f0;font-family:'Segoe UI',Arial,sans-serif;
    border-radius:12px;padding:0;width:300px;
    box-shadow:0 8px 32px rgba(0,0,0,0.6);
    border:1px solid rgba(255,255,255,0.1);overflow:hidden;
  }}
  #drancy-header {{
    background:linear-gradient(90deg,#00d4ff22,#ff005522);
    padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.1);
  }}
  #drancy-header h2 {{margin:0;font-size:15px;font-weight:700;color:#fff;letter-spacing:.5px;}}
  #drancy-header p  {{margin:4px 0 0;font-size:11px;color:rgba(255,255,255,.55);}}
  #drancy-body {{padding:14px 18px;}}
  .kpi-grid {{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px;}}
  .kpi {{background:rgba(255,255,255,0.06);border-radius:8px;padding:10px;text-align:center;border:1px solid rgba(255,255,255,0.08);}}
  .kpi .val {{font-size:18px;font-weight:800;color:#00d4ff;line-height:1.1;}}
  .kpi .lbl {{font-size:10px;color:rgba(255,255,255,.5);margin-top:3px;text-transform:uppercase;letter-spacing:.5px;}}
  .section-title {{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,.4);margin:12px 0 6px;}}
  .year-table {{width:100%;border-collapse:collapse;font-size:12px;}}
  .year-table th {{color:rgba(255,255,255,.4);font-weight:600;text-align:left;padding:3px 0;font-size:10px;text-transform:uppercase;}}
  .year-table td {{padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);color:#ccc;}}
  .year-table td:not(:first-child) {{text-align:right;color:#fff;}}
  .badge {{display:inline-block;border-radius:4px;padding:2px 7px;font-size:11px;font-weight:700;margin:2px;}}
  #drancy-toggle {{position:absolute;top:8px;right:12px;cursor:pointer;color:rgba(255,255,255,.5);font-size:18px;user-select:none;}}
  #drancy-toggle:hover {{color:#fff;}}
</style>
<div id="drancy-dashboard">
  <div id="drancy-header">
    <span id="drancy-toggle" onclick="
      var b=document.getElementById('drancy-body');
      var t=document.getElementById('drancy-toggle');
      if(b.style.display==='none'){{b.style.display='block';t.textContent='▲'}}
      else{{b.style.display='none';t.textContent='▼'}}
    ">▲</span>
    <h2>{title}</h2>
    <p>{subtitle}</p>
  </div>
  <div id="drancy-body">
    <div class="kpi-grid">
      <div class="kpi"><div class="val">{total_tx:,}</div><div class="lbl">Transactions</div></div>
      <div class="kpi"><div class="val">{n_clusters}</div><div class="lbl">Micromarchés</div></div>
      <div class="kpi"><div class="val">{med_prix/1000:.0f}k€</div><div class="lbl">Prix médian</div></div>
      <div class="kpi"><div class="val">{med_m2_display}</div><div class="lbl">Médiane/m²</div></div>
    </div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px;">{badge_html}</div>
    <div class="section-title">Évolution annuelle</div>
    <table class="year-table">
      <tr><th>Année</th><th>Prix médian</th><th>€/m² médian</th></tr>
      {year_rows}
    </table>
    <div class="section-title" style="margin-top:14px;">Top zones</div>
    <table class="year-table">
      <tr><th>Zone</th><th>Tx</th><th>€/m²</th></tr>
      {cluster_rows if cluster_rows else '<tr><td colspan="3" style="color:#888;text-align:center;">Aucun cluster</td></tr>'}
    </table>
    <div style="margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);
      font-size:10px;color:rgba(255,255,255,.3);text-align:center;">
      Source : DVF · data.gouv.fr · HDBSCAN min_cluster_size={min_cluster_size}
    </div>
  </div>
</div>
"""
    m.get_root().html.add_child(folium.Element(dashboard))
    m.save(out_path)

    with open(out_path) as f:
        html = f.read()
    html = html.replace("</head>", extra_css + copyright_css + "</head>")
    html = html.replace("</body>", copyright_div + "\n</body>")
    with open(out_path, "w") as f:
        f.write(html)

    size_mb = os.path.getsize(out_path) / 1024 / 1024
    print(f"✅ {out_path} ({size_mb:.1f} MB)")


def make_index(stats):
    total_tx = stats["total"]
    med_m2   = stats["med_m2"]
    cards = ""
    TYPE_CONFIG = {
        "Appartement":      {"emoji": "🏢", "label": "Appartements",          "file": "carte_appartements.html"},
        "Maison":           {"emoji": "🏠", "label": "Maisons / Pavillons",    "file": "carte_maisons.html"},
        "Local commercial": {"emoji": "🏭", "label": "Commerces & Locaux",     "file": "carte_commerces.html"},
    }
    for tl, tc in TYPE_CONFIG.items():
        n = stats["by_type"].get(tl, 0)
        n_cl = stats["clusters_by_type"].get(tl, 0)
        if n == 0: continue
        cards += f"""
    <a href="{tc['file']}" class="card">
      <div class="card-icon">{tc['emoji']}</div>
      <div class="card-body">
        <div class="card-title">{tc['label']}</div>
        <div class="card-desc">{n:,} transactions · {n_cl} micro-marchés</div>
      </div>
      <div class="card-arrow">→</div>
    </a>"""

    html = f"""<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Analyse Foncière · {COMMUNE_NOM} ({COMMUNE_CODE})</title>
  <meta name="description" content="Carte interactive du marché immobilier à {COMMUNE_NOM} · {total_tx:,} transactions DVF 2020-2025 · datamerry">
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    body {{ font-family: 'Segoe UI', Arial, sans-serif; background: linear-gradient(135deg, #0a0a1e 0%, #0d1b2a 50%, #0a0a1e 100%); min-height: 100vh; color: #e8e8f0; display: flex; flex-direction: column; align-items: center; padding: 60px 20px; }}
    .header {{ text-align: center; margin-bottom: 50px; }}
    .tag {{ display: inline-block; background: {COLOR}22; color: {COLOR}; border: 1px solid {COLOR}55; border-radius: 20px; padding: 4px 16px; font-size: 12px; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 20px; }}
    .header h1 {{ font-size: clamp(28px, 5vw, 48px); font-weight: 800; background: linear-gradient(90deg, #00d4ff, #ffffff, {COLOR}); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; line-height: 1.2; margin-bottom: 16px; }}
    .header p {{ font-size: 16px; color: rgba(255,255,255,0.5); max-width: 520px; margin: 0 auto; line-height: 1.6; }}
    .stats-bar {{ display: flex; gap: 40px; justify-content: center; margin-bottom: 50px; flex-wrap: wrap; }}
    .stat {{ text-align: center; }}
    .stat .val {{ font-size: 30px; font-weight: 800; color: {COLOR}; }}
    .stat .lbl {{ font-size: 11px; color: rgba(255,255,255,.4); text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }}
    .cards {{ display: flex; flex-direction: column; gap: 14px; width: 100%; max-width: 600px; }}
    .card {{ display: flex; align-items: center; gap: 20px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 20px 24px; text-decoration: none; color: inherit; transition: all 0.2s ease; cursor: pointer; }}
    .card:hover {{ background: {COLOR}11; border-color: {COLOR}44; transform: translateY(-2px); box-shadow: 0 8px 32px {COLOR}22; }}
    .card-icon {{ font-size: 30px; flex-shrink: 0; }}
    .card-body {{ flex: 1; }}
    .card-title {{ font-size: 17px; font-weight: 700; color: #fff; margin-bottom: 3px; }}
    .card-desc {{ font-size: 13px; color: rgba(255,255,255,0.45); }}
    .card-arrow {{ font-size: 18px; color: {COLOR}66; flex-shrink: 0; }}
    .card:hover .card-arrow {{ color: {COLOR}; }}
    .footer {{ margin-top: 50px; text-align: center; font-size: 11px; color: rgba(255,255,255,0.2); line-height: 1.8; }}
  </style>
</head>
<body>
  <div class="header">
    <div class="tag">Analyse Foncière · {COMMUNE_NOM}</div>
    <h1>Marché Immobilier<br>{COMMUNE_NOM}</h1>
    <p>Cartographie interactive des transactions immobilières<br>2020 – 2025 · Source : Demandes de Valeurs Foncières</p>
  </div>
  <div class="stats-bar">
    <div class="stat"><div class="val">{total_tx:,}</div><div class="lbl">Transactions</div></div>
    <div class="stat"><div class="val">2020–25</div><div class="lbl">Période</div></div>
    <div class="stat"><div class="val">{med_m2:,.0f}€</div><div class="lbl">Prix médian/m²</div></div>
  </div>
  <div class="cards">{cards}</div>
  <a href="https://datamerry.com" style="margin-top:30px;display:inline-flex;align-items:center;gap:8px;padding:10px 20px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.5);text-decoration:none;font-size:13px;">← Retour sur datamerry.com</a>
  <div class="footer">
    © 2026 Samuel Bruno · Analyse Foncière · {COMMUNE_NOM} ({COMMUNE_CODE})<br>
    Source : data.gouv.fr · DVF · <a href="https://datamerry.com" style="color:rgba(255,255,255,0.3);">datamerry.com</a>
  </div>
</body>
</html>"""
    out = os.path.join(OUT_DIR, "index.html")
    with open(out, "w") as f:
        f.write(html)
    print(f"  ✅ {out}")


# ── 5. Génération des cartes ──────────────────────────────────────────────────
os.makedirs(OUT_DIR, exist_ok=True)

stats = {"total": 0, "med_m2": 0, "by_type": {}, "clusters_by_type": {}}

# Appartements
data_appt = raw[raw["type_local"] == "Appartement"].copy()
if len(data_appt) >= 50:
    min_cs = max(15, len(data_appt) // 50)
    build_map(
        data=data_appt,
        title="Appartements",
        subtitle=f"{COMMUNE_NOM} · 2020–2025",
        min_cluster_size=min_cs,
        min_samples=3,
        cluster_selection_method="eom",
        surface_col="surface_reelle_bati",
        surface_label="m² Carrez",
        out_path=os.path.join(OUT_DIR, "carte_appartements.html"),
    )
    stats["by_type"]["Appartement"] = len(data_appt)

# Maisons
data_mais = raw[raw["type_local"] == "Maison"].copy()
if len(data_mais) >= 50:
    min_cs = max(10, len(data_mais) // 50)
    build_map(
        data=data_mais,
        title="Maisons / Pavillons",
        subtitle=f"{COMMUNE_NOM} · 2020–2025",
        min_cluster_size=min_cs,
        min_samples=3,
        cluster_selection_method="eom",
        surface_col="surface_terrain",
        surface_label="m² terrain",
        colormap_caption="Prix au m² terrain (€)",
        out_path=os.path.join(OUT_DIR, "carte_maisons.html"),
    )
    stats["by_type"]["Maison"] = len(data_mais)

# Commerces
data_com = raw[raw["type_local"] == "Local industriel. commercial ou assimilé"].copy()
if len(data_com) >= 20:
    min_cs = max(5, len(data_com) // 30)
    build_map(
        data=data_com,
        title="Commerces / Locaux d'activités",
        subtitle=f"{COMMUNE_NOM} · 2020–2025",
        min_cluster_size=min_cs,
        min_samples=2,
        cluster_selection_method="eom",
        out_path=os.path.join(OUT_DIR, "carte_commerces.html"),
    )
    stats["by_type"]["Local commercial"] = len(data_com)

stats["total"] = sum(stats["by_type"].values())
stats["med_m2"] = raw["prix_m2"].median() if raw["prix_m2"].notna().any() else 0

# Reconstruct clusters_by_type from files (approximation)
for tl in ["Appartement", "Maison", "Local commercial"]:
    stats["clusters_by_type"][tl] = 0  # index page will show 0 if not computed

make_index(stats)
print(f"\n✅ Pipeline terminé pour {COMMUNE_NOM} ({COMMUNE_CODE})")
print(f"   Fichiers dans : {OUT_DIR}")
