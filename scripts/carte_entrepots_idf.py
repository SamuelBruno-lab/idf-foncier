#!/usr/bin/env python3
"""
Carte des unités foncières en zone d'activités/entrepôts en IDF + Oise,
surface entre 2 et 3 hectares.

Source :
  - Zones industrielles/logistique : OpenStreetMap (Overpass API)
  - Parcelles cadastrales : Géoplateforme IGN WFS (CADASTRALPARCELS)

Usage :
  python scripts/carte_entrepots_idf.py
  python scripts/carte_entrepots_idf.py --min-ha 2 --max-ha 3
  python scripts/carte_entrepots_idf.py --depts 93 94
"""

import argparse
import os
import time
import requests
import geopandas as gpd
import pandas as pd
import folium
from shapely.geometry import Polygon, MultiPolygon, mapping, shape

# ── Config ──────────────────────────────────────────────────────────────────

IDF_OISE_DEPTS = ["60", "75", "77", "78", "91", "92", "93", "94", "95"]

# Bbox IDF + Oise (lat_min, lon_min, lat_max, lon_max)
IDF_BBOX = (48.0, 1.4, 49.3, 3.6)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
WFS_URL = "https://data.geopf.fr/wfs/ows"


# ── Fonctions ───────────────────────────────────────────────────────────────

def fetch_industrial_zones() -> gpd.GeoDataFrame:
    """Récupère les zones industrielles/entrepôts depuis OpenStreetMap."""
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
    print("  Téléchargement zones industrielles OSM (IDF + Oise)...")
    resp = requests.post(OVERPASS_URL, data={"data": query}, timeout=300)
    if resp.status_code != 200:
        print(f"    ⚠ Overpass HTTP {resp.status_code}")
        return gpd.GeoDataFrame()

    data = resp.json()
    elements = data.get("elements", [])

    # Build node index
    nodes = {}
    for e in elements:
        if e["type"] == "node":
            nodes[e["id"]] = (e["lon"], e["lat"])

    # Build way geometries
    ways = {}
    for e in elements:
        if e["type"] == "way" and "nodes" in e:
            coords = [nodes[n] for n in e["nodes"] if n in nodes]
            if len(coords) >= 3:
                ways[e["id"]] = coords

    # Build polygons from ways and relations
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
                        "name": e.get("tags", {}).get("name", ""),
                        "landuse": e.get("tags", {}).get("landuse", "industrial"),
                    })
            except Exception:
                pass

        elif e["type"] == "relation":
            # Simple relation handling: combine outer ways
            outers = []
            for m in e.get("members", []):
                if m["type"] == "way" and m.get("role", "outer") == "outer":
                    if m["ref"] in ways:
                        coords = ways[m["ref"]]
                        if coords[0] != coords[-1]:
                            coords.append(coords[0])
                        try:
                            outers.append(Polygon(coords))
                        except Exception:
                            pass
            if outers:
                try:
                    multi = MultiPolygon(outers) if len(outers) > 1 else outers[0]
                    if multi.is_valid:
                        features.append({
                            "geometry": multi,
                            "osm_id": e["id"],
                            "name": e.get("tags", {}).get("name", ""),
                            "landuse": e.get("tags", {}).get("landuse", "industrial"),
                        })
                except Exception:
                    pass

    if not features:
        return gpd.GeoDataFrame()

    gdf = gpd.GeoDataFrame(features, crs="EPSG:4326")
    # Calculate area
    gdf_proj = gdf.to_crs("EPSG:2154")
    gdf["zone_area_ha"] = gdf_proj.geometry.area / 10000

    print(f"    → {len(gdf)} zones industrielles ({gdf['zone_area_ha'].sum():.0f} ha total)")
    return gdf


def fetch_large_parcels(dept: str, min_area: int, max_area: int) -> gpd.GeoDataFrame:
    """Récupère les parcelles cadastrales de 2-3 ha dans un département."""
    cql = f"code_dep='{dept}' AND contenance>={min_area} AND contenance<={max_area}"
    print(f"    Parcelles dept {dept} ({min_area/10000:.0f}–{max_area/10000:.0f} ha)...", end="", flush=True)

    for attempt in range(3):
        try:
            resp = requests.get(WFS_URL, params={
                "service": "WFS", "version": "2.0.0", "request": "GetFeature",
                "typeName": "CADASTRALPARCELS.PARCELLAIRE_EXPRESS:parcelle",
                "outputFormat": "application/json",
                "count": 10000,
                "CQL_FILTER": cql,
            }, timeout=180)
            if resp.status_code == 200:
                data = resp.json()
                feats = data.get("features", [])
                print(f" {len(feats)} parcelles")
                if not feats:
                    return gpd.GeoDataFrame()
                gdf = gpd.GeoDataFrame.from_features(feats, crs="EPSG:4326")
                gdf["area_m2"] = gdf["contenance"].astype(float)
                return gdf
        except Exception as e:
            print(f" ⚠ {e}")
        if attempt < 2:
            time.sleep(2 ** (attempt + 1))

    print(" erreur")
    return gpd.GeoDataFrame()


def make_map(results: gpd.GeoDataFrame, zones: gpd.GeoDataFrame, output_path: str, min_ha: float, max_ha: float):
    """Génère une carte Folium interactive."""
    center = [48.75, 2.4]
    m = folium.Map(location=center, zoom_start=9, tiles="CartoDB dark_matter")

    # Draw industrial zones in the background (semi-transparent)
    if not zones.empty:
        zone_group = folium.FeatureGroup(name="Zones industrielles", show=True)
        for _, row in zones.iterrows():
            folium.GeoJson(
                mapping(row.geometry),
                style_function=lambda x: {
                    "fillColor": "#334488",
                    "color": "#4466aa",
                    "weight": 1,
                    "fillOpacity": 0.15,
                },
            ).add_to(zone_group)
        zone_group.add_to(m)

    if results.empty:
        folium.Marker(center, popup="Aucune parcelle trouvée").add_to(m)
    else:
        mid_ha = (min_ha + max_ha) / 2
        parcel_group = folium.FeatureGroup(name="Parcelles 2-3 ha", show=True)

        for _, row in results.iterrows():
            area_ha = row.get("area_m2", 0) / 10000
            parcel_id = row.get("idu", "?")
            commune = row.get("nom_com", "?")
            zone_name = row.get("zone_name", "")
            color = "#ff6600" if area_ha < mid_ha else "#ff0044"

            popup_html = f"""
            <div style="font-family:Arial;font-size:12px;min-width:240px">
                <b style="font-size:13px">Parcelle {parcel_id}</b><br>
                📍 {commune} ({row.get('code_dep', '?')})<br>
                📐 <b>{area_ha:.2f} ha</b> ({row.get('area_m2', 0):,.0f} m²)<br>
                🏭 Zone : <b>{zone_name or 'industrielle'}</b>
            </div>
            """

            folium.GeoJson(
                mapping(row.geometry),
                style_function=lambda x, c=color: {
                    "fillColor": c, "color": c, "weight": 2, "fillOpacity": 0.5,
                },
                popup=folium.Popup(popup_html, max_width=320),
            ).add_to(parcel_group)

        parcel_group.add_to(m)

    # Layer control
    folium.LayerControl().add_to(m)

    # Legend
    n = len(results) if not results.empty else 0
    legend_html = f"""
    <div style="position:fixed;bottom:30px;left:30px;z-index:9999;
         background:rgba(0,0,0,0.88);color:#fff;padding:16px 22px;
         border-radius:10px;font-family:Arial;font-size:13px;
         border:1px solid rgba(255,255,255,0.2);max-width:320px">
        <div style="font-size:15px;font-weight:bold;margin-bottom:8px">
            🏭 Parcelles en zone industrielle
        </div>
        <div style="color:#aaa;margin-bottom:10px">IDF + Oise · {min_ha}–{max_ha} ha</div>
        <div><span style="color:#334488">■</span> Zones industrielles (landuse=industrial)</div>
        <div><span style="color:#ff6600">■</span> Parcelles {min_ha:.1f} – {(min_ha+max_ha)/2:.1f} ha</div>
        <div><span style="color:#ff0044">■</span> Parcelles {(min_ha+max_ha)/2:.1f} – {max_ha:.1f} ha</div>
        <div style="margin-top:10px;font-size:16px;font-weight:bold;color:#00d4ff">
            {n} parcelles trouvées
        </div>
        <div style="color:#666;font-size:10px;margin-top:8px">
            Source : OpenStreetMap · Cadastre IGN · datamerry.com
        </div>
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))

    if not results.empty:
        bounds = results.total_bounds
        m.fit_bounds([[bounds[1], bounds[0]], [bounds[3], bounds[2]]])

    m.save(output_path)
    print(f"\n🗺️  Carte sauvegardée : {output_path}")
    print(f"   {n} parcelles affichées")


def main():
    parser = argparse.ArgumentParser(description="Carte des parcelles en zone industrielle (IDF + Oise)")
    parser.add_argument("--depts", nargs="+", default=IDF_OISE_DEPTS)
    parser.add_argument("--min-ha", type=float, default=2.0)
    parser.add_argument("--max-ha", type=float, default=3.0)
    parser.add_argument("--output", default="carte_entrepots_idf.html")
    args = parser.parse_args()

    min_area = int(args.min_ha * 10000)
    max_area = int(args.max_ha * 10000)

    print(f"═══ Parcelles en zone industrielle/entrepôts ═══")
    print(f"    Départements : {', '.join(args.depts)}")
    print(f"    Surface : {args.min_ha}–{args.max_ha} ha ({min_area:,}–{max_area:,} m²)")
    print()

    # Step 1: Get industrial zones from OSM
    print("[1] Zones industrielles (OpenStreetMap)...")
    zones = fetch_industrial_zones()
    if zones.empty:
        print("    ⚠ Aucune zone industrielle trouvée")
        return

    # Step 2: Get large parcels for each department
    print(f"\n[2] Parcelles cadastrales {args.min_ha}–{args.max_ha} ha...")
    all_parcels = []
    for dept in args.depts:
        parcels = fetch_large_parcels(dept, min_area, max_area)
        if not parcels.empty:
            all_parcels.append(parcels)

    if not all_parcels:
        print("    ⚠ Aucune parcelle trouvée")
        output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", args.output)
        make_map(gpd.GeoDataFrame(), zones, output_path, args.min_ha, args.max_ha)
        return

    parcels_all = pd.concat(all_parcels, ignore_index=True)
    if "idu" in parcels_all.columns:
        parcels_all = parcels_all.drop_duplicates(subset=["idu"])
    print(f"    → Total : {len(parcels_all)} parcelles uniques")

    # Step 3: Spatial join - parcels intersecting industrial zones
    print(f"\n[3] Croisement spatial : parcelles × zones industrielles...")
    parcels_gdf = gpd.GeoDataFrame(parcels_all, geometry="geometry", crs="EPSG:4326")
    zones_join = zones[["geometry", "name", "osm_id"]].copy()
    zones_join = zones_join.rename(columns={"name": "zone_name"})

    joined = gpd.sjoin(parcels_gdf, zones_join, how="inner", predicate="intersects")
    if "idu" in joined.columns:
        joined = joined.drop_duplicates(subset=["idu"])

    print(f"    ✅ {len(joined)} parcelles en zone industrielle")

    if not joined.empty:
        print(f"\n{'═' * 55}")
        print(f"  TOTAL : {len(joined)} parcelles")
        if "code_dep" in joined.columns:
            print(f"\n  Par département :")
            for dept, group in joined.groupby("code_dep"):
                avg_ha = group["area_m2"].mean() / 10000
                print(f"    {dept}: {len(group)} parcelles (moy. {avg_ha:.2f} ha)")
        if "nom_com" in joined.columns:
            print(f"\n  Top communes :")
            top = joined.groupby("nom_com").size().sort_values(ascending=False).head(15)
            for com, n in top.items():
                print(f"    {com}: {n}")
        print(f"{'═' * 55}")

    output_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", args.output)
    make_map(joined, zones, output_path, args.min_ha, args.max_ha)


if __name__ == "__main__":
    main()
