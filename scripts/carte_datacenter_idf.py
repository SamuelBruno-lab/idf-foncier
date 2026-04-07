#!/usr/bin/env python3
"""
Carte des parcelles industrielles non-bâties ou peu bâties en IDF + Oise
pour implantation datacenter (2-3 ha).

Croise :
  1. Zones industrielles (OpenStreetMap landuse=industrial)
  2. Parcelles cadastrales 2-3 ha (Géoplateforme IGN)
  3. Bâtiments existants (BDTOPO IGN) → calcul emprise au sol

Filtre : emprise bâtie < 20% de la surface parcelle (peu bâti / non bâti)

Usage :
  python scripts/carte_datacenter_idf.py
  python scripts/carte_datacenter_idf.py --max-built-ratio 0.10   # < 10% bâti
  python scripts/carte_datacenter_idf.py --min-ha 1.5 --max-ha 5
"""

import argparse
import os
import time
import requests
import geopandas as gpd
import pandas as pd
import numpy as np
import folium
from shapely.geometry import Polygon, MultiPolygon, mapping
from shapely.ops import unary_union

IDF_OISE_DEPTS = ["60", "75", "77", "78", "91", "92", "93", "94", "95"]
IDF_BBOX = (48.0, 1.4, 49.3, 3.6)
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
WFS_URL = "https://data.geopf.fr/wfs/ows"


def wfs_get(params, timeout=120, retries=3):
    for attempt in range(retries):
        try:
            resp = requests.get(WFS_URL, params=params, timeout=timeout)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            if attempt == retries - 1:
                print(f" ⚠ {e}")
        if attempt < retries - 1:
            time.sleep(2 ** (attempt + 1))
    return None


def fetch_industrial_zones() -> gpd.GeoDataFrame:
    """Zones industrielles depuis OSM."""
    query = f"""
[out:json][timeout:180];
(
  way["landuse"="industrial"]({IDF_BBOX[0]},{IDF_BBOX[1]},{IDF_BBOX[2]},{IDF_BBOX[3]});
  relation["landuse"="industrial"]({IDF_BBOX[0]},{IDF_BBOX[1]},{IDF_BBOX[2]},{IDF_BBOX[3]});
);
out body;
>;
out skel qt;
"""
    print("  Téléchargement zones industrielles OSM...")
    resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=300)
    if resp.status_code != 200:
        return gpd.GeoDataFrame()

    elements = resp.json().get("elements", [])
    nodes = {e["id"]: (e["lon"], e["lat"]) for e in elements if e["type"] == "node"}
    ways = {}
    for e in elements:
        if e["type"] == "way" and "nodes" in e:
            coords = [nodes[n] for n in e["nodes"] if n in nodes]
            if len(coords) >= 3:
                ways[e["id"]] = coords

    features = []
    for e in elements:
        if e["type"] == "way" and e["id"] in ways:
            coords = ways[e["id"]]
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            try:
                poly = Polygon(coords)
                if poly.is_valid and poly.area > 0:
                    features.append({
                        "geometry": poly,
                        "osm_id": e["id"],
                        "zone_name": e.get("tags", {}).get("name", ""),
                    })
            except Exception:
                pass
        elif e["type"] == "relation":
            outers = []
            for m in e.get("members", []):
                if m["type"] == "way" and m.get("role", "outer") == "outer" and m["ref"] in ways:
                    coords = ways[m["ref"]]
                    if coords[0] != coords[-1]:
                        coords.append(coords[0])
                    try:
                        outers.append(Polygon(coords))
                    except Exception:
                        pass
            if outers:
                try:
                    geom = MultiPolygon(outers) if len(outers) > 1 else outers[0]
                    if geom.is_valid:
                        features.append({
                            "geometry": geom,
                            "osm_id": e["id"],
                            "zone_name": e.get("tags", {}).get("name", ""),
                        })
                except Exception:
                    pass

    gdf = gpd.GeoDataFrame(features, crs="EPSG:4326") if features else gpd.GeoDataFrame()
    print(f"    → {len(gdf)} zones industrielles")
    return gdf


def fetch_large_parcels(dept: str, min_area: int, max_area: int) -> gpd.GeoDataFrame:
    """Parcelles cadastrales d'un dept entre min_area et max_area m²."""
    cql = f"code_dep='{dept}' AND contenance>={min_area} AND contenance<={max_area}"
    print(f"    Dept {dept}...", end="", flush=True)
    data = wfs_get({
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeName": "CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle",
        "outputFormat": "application/json", "count": 10000, "CQL_FILTER": cql,
    }, timeout=180)
    if not data:
        print(" erreur")
        return gpd.GeoDataFrame()
    feats = data.get("features", [])
    print(f" {len(feats)}")
    if not feats:
        return gpd.GeoDataFrame()
    gdf = gpd.GeoDataFrame.from_features(feats, crs="EPSG:4326")
    gdf["area_m2"] = gdf["contenance"].astype(float)
    return gdf


def fetch_buildings_for_dept(dept: str) -> gpd.GeoDataFrame:
    """Récupère TOUS les bâtiments cadastraux d'un département (paginé)."""
    all_feats = []
    offset = 0
    page_size = 10000

    while True:
        print(f"\r    Bâtiments dept {dept} (offset {offset})...", end="", flush=True)
        data = wfs_get({
            "service": "WFS", "version": "2.0.0", "request": "GetFeature",
            "typeName": "CADASTRALPARCELS.PARCELLAIRE_EXPRESS:batiment",
            "outputFormat": "application/json",
            "count": page_size,
            "startIndex": offset,
            "CQL_FILTER": f"code_dep='{dept}'",
        }, timeout=180)

        if not data:
            break
        feats = data.get("features", [])
        if not feats:
            break
        all_feats.extend(feats)
        if len(feats) < page_size:
            break
        offset += page_size
        # Safety limit: 200k buildings per dept should be enough
        if offset >= 200000:
            break

    print(f"\r    Dept {dept}: {len(all_feats)} bâtiments                ")
    if not all_feats:
        return gpd.GeoDataFrame()
    return gpd.GeoDataFrame.from_features(all_feats, crs="EPSG:4326")


def fetch_buildings_for_parcels(parcels: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Récupère les bâtiments cadastraux pour les départements concernés."""
    if parcels.empty:
        return gpd.GeoDataFrame()

    depts = parcels["code_dep"].unique()
    all_buildings = []

    for dept in sorted(depts):
        buildings = fetch_buildings_for_dept(dept)
        if not buildings.empty:
            all_buildings.append(buildings)

    if not all_buildings:
        return gpd.GeoDataFrame()

    result = pd.concat(all_buildings, ignore_index=True)
    print(f"    → Total: {len(result)} bâtiments")
    return result


def compute_built_ratio(parcels: gpd.GeoDataFrame, buildings: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Calcule le ratio d'emprise bâtie pour chaque parcelle."""
    parcels = parcels.copy()

    if buildings.empty:
        parcels["built_m2"] = 0.0
        parcels["built_ratio"] = 0.0
        parcels["built_pct"] = 0
        return parcels

    # Project to Lambert 93 for area calculations
    parcels_proj = parcels.to_crs("EPSG:2154")
    buildings_proj = buildings.to_crs("EPSG:2154")

    built_areas = []
    for idx, parcel in parcels_proj.iterrows():
        # Find buildings that intersect this parcel
        candidates = buildings_proj[buildings_proj.intersects(parcel.geometry)]
        if candidates.empty:
            built_areas.append(0.0)
        else:
            # Calculate intersection area
            intersections = candidates.geometry.intersection(parcel.geometry)
            built_areas.append(intersections.area.sum())

    parcels["built_m2"] = built_areas
    parcels["built_ratio"] = parcels["built_m2"] / parcels["area_m2"]
    parcels["built_pct"] = (parcels["built_ratio"] * 100).round(1)
    return parcels


def make_map(results: gpd.GeoDataFrame, zones: gpd.GeoDataFrame, output_path: str,
             min_ha: float, max_ha: float, max_built_ratio: float):
    """Carte Folium interactive avec score datacenter."""
    center = [48.75, 2.4]
    m = folium.Map(location=center, zoom_start=9, tiles="CartoDB dark_matter")

    # Industrial zones background
    if not zones.empty:
        zone_group = folium.FeatureGroup(name="Zones industrielles (OSM)", show=True)
        for _, row in zones.iterrows():
            folium.GeoJson(
                mapping(row.geometry),
                style_function=lambda x: {
                    "fillColor": "#1a2744", "color": "#2a4477", "weight": 1, "fillOpacity": 0.2,
                },
            ).add_to(zone_group)
        zone_group.add_to(m)

    if results.empty:
        folium.Marker(center, popup="Aucune parcelle trouvée").add_to(m)
        m.save(output_path)
        return

    # Color by built ratio: green = empty, orange = light, red = more built
    def get_color(ratio):
        if ratio < 0.02:
            return "#00ff88"  # Terrain nu
        elif ratio < 0.10:
            return "#00d4ff"  # Quasi vide
        elif ratio < 0.20:
            return "#ff9900"  # Peu bâti
        else:
            return "#ff3366"  # Plus bâti

    def get_label(ratio):
        if ratio < 0.02:
            return "🟢 Terrain nu"
        elif ratio < 0.10:
            return "🔵 Quasi vide"
        else:
            return "🟠 Peu bâti"

    # Group parcels by department into separate FeatureGroups
    dept_names = {
        "60": "60 - Oise", "75": "75 - Paris", "77": "77 - Seine-et-Marne",
        "78": "78 - Yvelines", "91": "91 - Essonne", "92": "92 - Hauts-de-Seine",
        "93": "93 - Seine-Saint-Denis", "94": "94 - Val-de-Marne", "95": "95 - Val-d'Oise",
    }

    depts_in_data = sorted(results["code_dep"].unique())
    dept_groups = {}
    dept_counts = {}

    for dept in depts_in_data:
        label = dept_names.get(dept, f"Dept {dept}")
        count = len(results[results["code_dep"] == dept])
        dept_counts[dept] = count
        fg = folium.FeatureGroup(name=f"{label} ({count})", show=True)
        dept_groups[dept] = fg

    for _, row in results.iterrows():
        area_ha = row["area_m2"] / 10000
        built_pct = row.get("built_pct", 0)
        color = get_color(row.get("built_ratio", 0))
        dept = row.get("code_dep", "?")

        popup_html = f"""
        <div style="font-family:Arial;font-size:12px;min-width:260px;line-height:1.6">
            <div style="font-size:14px;font-weight:bold;margin-bottom:6px;color:{color}">
                {get_label(row.get('built_ratio', 0))}
            </div>
            <b>Parcelle {row.get('idu', '?')}</b><br>
            📍 <b>{row.get('nom_com', '?')}</b> ({dept})<br>
            📐 Surface : <b>{area_ha:.2f} ha</b> ({row['area_m2']:,.0f} m²)<br>
            🏗️ Emprise bâtie : <b>{built_pct:.0f}%</b> ({row.get('built_m2', 0):,.0f} m²)<br>
            📊 Surface libre : <b>{(row['area_m2'] - row.get('built_m2', 0)):,.0f} m²</b><br>
            🏭 Zone : {row.get('zone_name', 'industrielle')}<br>
            <hr style="border-color:rgba(255,255,255,0.1)">
            <div style="font-size:10px;color:#888">
                Section {row.get('section', '?')} n°{row.get('numero', '?')}
            </div>
        </div>
        """

        folium.GeoJson(
            mapping(row.geometry),
            style_function=lambda x, c=color: {
                "fillColor": c, "color": c, "weight": 2.5, "fillOpacity": 0.5,
            },
            popup=folium.Popup(popup_html, max_width=340),
        ).add_to(dept_groups.get(dept, list(dept_groups.values())[0]))

    for fg in dept_groups.values():
        fg.add_to(m)

    folium.LayerControl(collapsed=False).add_to(m)

    # Stats for legend
    n_nu = len(results[results["built_ratio"] < 0.02])
    n_quasi = len(results[(results["built_ratio"] >= 0.02) & (results["built_ratio"] < 0.10)])
    n_peu = len(results[results["built_ratio"] >= 0.10])

    legend_html = f"""
    <div style="position:fixed;bottom:30px;left:30px;z-index:9999;
         background:rgba(0,0,0,0.92);color:#fff;padding:18px 24px;
         border-radius:12px;font-family:Arial;font-size:13px;
         border:1px solid rgba(255,255,255,0.15);max-width:340px;
         box-shadow:0 4px 20px rgba(0,0,0,0.5)">
        <div style="font-size:16px;font-weight:bold;margin-bottom:4px">
            ⚡ Terrains datacenter — IDF + Oise
        </div>
        <div style="color:#aaa;margin-bottom:12px;font-size:11px">
            Parcelles {min_ha}–{max_ha} ha · Zone industrielle · Emprise bâtie &lt;{int(max_built_ratio*100)}%
        </div>
        <div style="margin-bottom:4px"><span style="color:#00ff88">■</span> Terrain nu (&lt;2%) — <b>{n_nu}</b></div>
        <div style="margin-bottom:4px"><span style="color:#00d4ff">■</span> Quasi vide (2-10%) — <b>{n_quasi}</b></div>
        <div style="margin-bottom:4px"><span style="color:#ff9900">■</span> Peu bâti (10-{int(max_built_ratio*100)}%) — <b>{n_peu}</b></div>
        <div style="margin-top:12px;font-size:18px;font-weight:bold;color:#00ff88">
            {len(results)} parcelles
        </div>
        <div style="color:#555;font-size:10px;margin-top:8px">
            Source : OSM · Cadastre IGN · BDTOPO · datamerry.com
        </div>
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))

    bounds = results.total_bounds
    m.fit_bounds([[bounds[1], bounds[0]], [bounds[3], bounds[2]]])

    m.save(output_path)
    print(f"\n🗺️  Carte sauvegardée : {output_path}")
    print(f"   {len(results)} parcelles ({n_nu} terrains nus, {n_quasi} quasi vides, {n_peu} peu bâtis)")


def main():
    parser = argparse.ArgumentParser(description="Parcelles datacenter IDF + Oise")
    parser.add_argument("--depts", nargs="+", default=IDF_OISE_DEPTS)
    parser.add_argument("--min-ha", type=float, default=2.0)
    parser.add_argument("--max-ha", type=float, default=3.0)
    parser.add_argument("--max-built-ratio", type=float, default=0.20,
                        help="Ratio max d'emprise bâtie (0.20 = 20%%)")
    parser.add_argument("--output", default="carte_datacenter_idf.html")
    args = parser.parse_args()

    min_area = int(args.min_ha * 10000)
    max_area = int(args.max_ha * 10000)

    print(f"═══ Terrains datacenter — IDF + Oise ═══")
    print(f"    Surface : {args.min_ha}–{args.max_ha} ha")
    print(f"    Emprise bâtie max : {args.max_built_ratio*100:.0f}%")
    print(f"    Départements : {', '.join(args.depts)}")
    print()

    # Step 1: Industrial zones
    print("[1] Zones industrielles (OSM)...")
    zones = fetch_industrial_zones()

    # Step 2: Large parcels
    print(f"\n[2] Parcelles {args.min_ha}–{args.max_ha} ha...")
    all_parcels = []
    for dept in args.depts:
        p = fetch_large_parcels(dept, min_area, max_area)
        if not p.empty:
            all_parcels.append(p)

    if not all_parcels:
        print("    ⚠ Aucune parcelle")
        return

    parcels = pd.concat(all_parcels, ignore_index=True)
    if "idu" in parcels.columns:
        parcels = parcels.drop_duplicates(subset=["idu"])
    parcels = gpd.GeoDataFrame(parcels, geometry="geometry", crs="EPSG:4326")
    print(f"    → {len(parcels)} parcelles")

    # Step 3: Spatial join with industrial zones
    print(f"\n[3] Croisement zones industrielles × parcelles...")
    if zones.empty:
        print("    ⚠ Zones industrielles vides (Overpass rate-limit?). Réessayer dans 30s...")
        time.sleep(30)
        zones = fetch_industrial_zones()
        if zones.empty:
            print("    ⚠ Impossible de charger les zones. Abandon.")
            return
    zones_join = zones[["geometry", "zone_name"]].copy()
    joined = gpd.sjoin(parcels, zones_join, how="inner", predicate="intersects")
    if "idu" in joined.columns:
        joined = joined.drop_duplicates(subset=["idu"])
    print(f"    → {len(joined)} parcelles en zone industrielle")

    if joined.empty:
        print("    ⚠ Aucune parcelle en zone industrielle")
        return

    # Step 4: Building coverage analysis
    print(f"\n[4] Analyse emprise bâtie (bâtiments BDTOPO/Cadastre)...")
    buildings = fetch_buildings_for_parcels(joined)
    joined = compute_built_ratio(joined, buildings)

    # Step 5: Filter by built ratio
    results = joined[joined["built_ratio"] <= args.max_built_ratio].copy()
    results = results.sort_values("built_ratio")

    print(f"\n{'═' * 55}")
    print(f"  {len(results)} parcelles avec emprise bâtie ≤ {args.max_built_ratio*100:.0f}%")
    print(f"  (sur {len(joined)} en zone industrielle)")

    if not results.empty and "code_dep" in results.columns:
        print(f"\n  Par département :")
        for dept, group in results.groupby("code_dep"):
            print(f"    {dept}: {len(group)} parcelles")

        print(f"\n  Par taux d'emprise :")
        n_nu = len(results[results["built_ratio"] < 0.02])
        n_quasi = len(results[(results["built_ratio"] >= 0.02) & (results["built_ratio"] < 0.10)])
        n_peu = len(results[results["built_ratio"] >= 0.10])
        print(f"    Terrain nu (<2%)  : {n_nu}")
        print(f"    Quasi vide (2-10%): {n_quasi}")
        print(f"    Peu bâti (10-20%) : {n_peu}")

        print(f"\n  Top communes :")
        top = results.groupby("nom_com").size().sort_values(ascending=False).head(15)
        for com, n in top.items():
            print(f"    {com}: {n}")
    print(f"{'═' * 55}")

    # Export CSV
    csv_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..",
                            args.output.replace(".html", ".csv"))
    if not results.empty:
        export_cols = ["idu", "nom_com", "code_dep", "section", "numero",
                       "area_m2", "built_m2", "built_pct", "zone_name"]
        export_cols = [c for c in export_cols if c in results.columns]
        results[export_cols].to_csv(csv_path, index=False)
        print(f"\n📊 CSV exporté : {csv_path}")

    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", args.output)
    make_map(results, zones, output_path, args.min_ha, args.max_ha, args.max_built_ratio)


if __name__ == "__main__":
    main()
