"""
Match VLG parcels to HDBSCAN micro-zones by nearest zone centroid.
Uses only Supabase REST API (no DB/geom needed).

Usage:
    cd foncier-idf && python -m scripts.foncier.fix_hdbscan_matching --insee 92078
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SESSION = requests.Session()
SESSION.verify = False
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def supabase_url():
    return os.environ["NEXT_PUBLIC_SUPABASE_URL"]


def headers():
    sk = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {
        "apikey": sk,
        "Authorization": f"Bearer {sk}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def fetch_paginated(table, params, select="*"):
    all_rows = []
    offset = 0
    while True:
        p = {**params, "select": select, "limit": "1000", "offset": str(offset)}
        r = SESSION.get(f"{supabase_url()}/rest/v1/{table}", headers=headers(), params=p)
        r.raise_for_status()
        rows = r.json()
        all_rows.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return all_rows


def haversine_km(lat1, lon1, lat2, lon2):
    """Quick haversine distance in km."""
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))


def compute_score(area_m2, underuse, zone_fam, prix, gfa, coverage):
    us = 10 if underuse >= 0.80 else 8 if underuse >= 0.60 else 6 if underuse >= 0.40 else 4 if underuse >= 0.20 else 1
    zs = {"U": 9, "AU": 7, "A": 2, "N": 1}.get(zone_fam, 3)
    ms = 10 if prix >= 6000 else 8 if prix >= 4500 else 6 if prix >= 3000 else 4 if prix >= 2000 else 2
    ss = 9 if area_m2 >= 1000 else 7 if area_m2 >= 600 else 5 if area_m2 >= 300 else 2
    pv = gfa * 0.75 * prix
    lv = pv - gfa * 1300 - gfa * 100 - pv * 0.03 - pv * 0.08
    ls = 10 if lv >= 1500000 else 8 if lv >= 800000 else 6 if lv >= 400000 else 4 if lv >= 150000 else 2
    total = round(0.30*us + 0.25*zs + 0.20*ms + 0.15*ss + 0.10*ls, 2)
    if zone_fam in ("U","AU") and area_m2 >= 600 and underuse >= 0.70:
        best_use = "densification_residentielle"
    elif zone_fam == "U" and 300 <= area_m2 <= 700 and underuse >= 0.60:
        best_use = "division_parcellaire"
    elif zone_fam == "U" and coverage < 0.15:
        best_use = "dent_creuse"
    else:
        best_use = "analyse_complementaire"
    return {"mutability_score": total, "underuse_score": us, "zoning_score": zs,
            "market_score": ms, "size_score": ss, "land_value_score": ls,
            "best_use": best_use, "land_value_est": round(lv, 2), "program_value_est": round(pv, 2)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--insee", required=True)
    args = parser.parse_args()

    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env.local"))

    insee = args.insee
    logger.info("=== HDBSCAN micro-zone matching for %s ===", insee)

    # 1. Fetch HDBSCAN zones with centroids
    zones = fetch_paginated(
        "dvf_hdbscan_zones",
        {"code_commune": f"eq.{insee}", "type_local": "eq.Appartement",
         "prix_m2_median": "not.is.null", "count": "gte.5", "order": "count.desc"},
        select="id,cluster_id,count,prix_m2_median,centroid_lat,centroid_lon,hull_coords",
    )
    logger.info("Found %d HDBSCAN zones:", len(zones))
    for z in zones:
        logger.info("  %s: %d tx, %d €/m², centroid=(%.4f, %.4f)",
                     z["id"], z["count"], z["prix_m2_median"], z["centroid_lat"], z["centroid_lon"])

    # 2. Build polygons for point-in-polygon (using shapely)
    from shapely.geometry import Point, Polygon
    for z in zones:
        hull = z.get("hull_coords", [])
        if isinstance(hull, list) and len(hull) >= 3:
            coords = [(p[1], p[0]) for p in hull]  # (lon,lat)
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            try:
                poly = Polygon(coords)
                z["polygon"] = poly if poly.is_valid else None
            except Exception:
                z["polygon"] = None
        else:
            z["polygon"] = None

    # 3. Commune fallback
    r = SESSION.get(f"{supabase_url()}/rest/v1/dvf_clusters_commune", headers=headers(),
                    params={"select": "prix_m2_median", "cluster_id": f"eq.{insee}_Appartement", "limit": "1"})
    commune_price = r.json()[0]["prix_m2_median"] if r.status_code == 200 and r.json() else 3581
    logger.info("Commune fallback: %d €/m²", commune_price)

    # 4. Fetch all parcels for this commune (market + constructibility + building stats)
    logger.info("Fetching parcel data...")
    market = {r["parcel_id"]: r for r in fetch_paginated(
        "parcel_market_stats", {"parcel_id": f"like.{insee}*"},
        select="parcel_id,median_price_m2,hdbscan_zone_id")}
    construct = {r["parcel_id"]: r for r in fetch_paginated(
        "parcel_constructibility", {"parcel_id": f"like.{insee}*"},
        select="parcel_id,dominant_zone_family,estimated_gfa,underuse_ratio,residual_potential_est")}
    bstats = {r["parcel_id"]: r for r in fetch_paginated(
        "parcel_building_stats", {"parcel_id": f"like.{insee}*"},
        select="parcel_id,coverage_ratio")}
    areas = {r["parcel_id"]: r.get("area_m2") or 0 for r in fetch_paginated(
        "parcels", {"insee_code": f"eq.{insee}"}, select="parcel_id,area_m2")}

    logger.info("Loaded: %d market, %d construct, %d building, %d areas",
                len(market), len(construct), len(bstats), len(areas))

    # 5. For each parcel, try to get its centroid from the bbox API (one page at a time)
    #    OR: use the zone centroid nearest-match approach
    #    Since we can't get parcel centroids from REST, use nearest zone centroid
    #    for ALL parcels. The zones are small enough that nearest centroid ≈ contains.

    # Actually, let's try fetching centroids via the Vercel API for just VLG parcels
    # using a tight bbox with min_score=0 and high limit
    logger.info("Fetching parcel centroids via Vercel bbox API...")

    from pyproj import Transformer
    to_l93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)
    # VLG tight bounds
    minx, miny = to_l93.transform(2.308, 48.924)
    maxx, maxy = to_l93.transform(2.345, 48.942)

    parcel_centroids = {}
    offset = 0
    while True:
        r = SESSION.get(
            "https://foncier-idf.vercel.app/api/foncier/bbox",
            params={"minx": f"{minx:.0f}", "miny": f"{miny:.0f}",
                    "maxx": f"{maxx:.0f}", "maxy": f"{maxy:.0f}",
                    "min_score": "0", "limit": "1000", "offset": str(offset)},
            timeout=60)
        if r.status_code != 200:
            logger.warning("bbox error: %s", r.text[:100])
            break
        items = r.json().get("items", [])
        for item in items:
            pid = item.get("parcel_id", "")
            if not pid.startswith(insee):
                continue
            gj = item.get("geojson")
            if isinstance(gj, str):
                try: gj = json.loads(gj)
                except: continue
            if not isinstance(gj, dict):
                continue
            # Compute centroid from first ring
            gtype = gj.get("type", "")
            coords = gj.get("coordinates", [])
            try:
                if gtype == "Polygon" and coords:
                    ring = coords[0]
                elif gtype == "MultiPolygon" and coords:
                    ring = coords[0][0]
                else:
                    continue
                lons = [c[0] for c in ring]
                lats = [c[1] for c in ring]
                parcel_centroids[pid] = (sum(lons)/len(lons), sum(lats)/len(lats))
            except:
                pass

        logger.info("  Page offset=%d: got %d items, VLG centroids so far: %d", offset, len(items), len(parcel_centroids))
        if len(items) < 1000:
            break
        offset += 1000

    logger.info("Got %d VLG parcel centroids", len(parcel_centroids))

    # 6. Point-in-polygon matching
    matched = {}
    for pid, (lon, lat) in parcel_centroids.items():
        pt = Point(lon, lat)
        best = None
        for z in zones:
            if z.get("polygon") and z["polygon"].contains(pt):
                if best is None or z["count"] > best["count"]:
                    best = z
        if best:
            matched[pid] = best

    # For unmatched parcels with centroids, use nearest zone centroid
    for pid, (lon, lat) in parcel_centroids.items():
        if pid in matched:
            continue
        best_dist = float("inf")
        best_zone = None
        for z in zones:
            d = haversine_km(lat, lon, z["centroid_lat"], z["centroid_lon"])
            if d < best_dist:
                best_dist = d
                best_zone = z
        if best_zone and best_dist < 1.0:  # within 1km
            matched[pid] = best_zone

    logger.info("Matched %d parcels (polygon=%d, nearest=%d)",
                len(matched),
                sum(1 for pid in matched if pid in parcel_centroids),
                len(matched) - sum(1 for pid in matched if pid in parcel_centroids))

    # Distribution
    zone_counts = {}
    for z in matched.values():
        zone_counts[z["id"]] = zone_counts.get(z["id"], 0) + 1
    for zid, cnt in sorted(zone_counts.items(), key=lambda x: -x[1]):
        z = next(zz for zz in zones if zz["id"] == zid)
        logger.info("  %s: %d parcels → %d €/m²", zid, cnt, z["prix_m2_median"])

    # 7. Apply updates to ALL parcels (matched get zone price, unmatched get commune)
    all_pids = set(market.keys())
    updates_applied = 0
    total = len(all_pids)
    for i, pid in enumerate(sorted(all_pids)):
        area = areas.get(pid, 0)
        c = construct.get(pid, {})
        b = bstats.get(pid, {})
        underuse = c.get("underuse_ratio") or 0
        zone_fam = c.get("dominant_zone_family") or "U"
        gfa = c.get("estimated_gfa") or 0
        coverage = b.get("coverage_ratio") or 0
        residual = c.get("residual_potential_est") or 0

        if pid in matched:
            prix = matched[pid]["prix_m2_median"]
            zone_id = matched[pid]["id"]
        else:
            prix = commune_price
            zone_id = None

        # Update market stats
        body_m = {"median_price_m2": prix, "updated_at": "now()"}
        if zone_id:
            body_m["hdbscan_zone_id"] = zone_id
        SESSION.patch(f"{supabase_url()}/rest/v1/parcel_market_stats",
                      headers=headers(), params={"parcel_id": f"eq.{pid}"}, json=body_m)

        # Recalculate score
        s = compute_score(area, underuse, zone_fam, prix, gfa, coverage)
        s["explanation_json"] = json.dumps({
            "area_m2": area, "underuse_ratio": underuse, "dominant_zone_family": zone_fam,
            "median_price_m2": prix, "estimated_gfa": gfa,
            "residual_potential_est": residual, "coverage_ratio": coverage,
        })
        s["computed_at"] = "now()"
        r2 = SESSION.patch(f"{supabase_url()}/rest/v1/parcel_scores",
                           headers=headers(), params={"parcel_id": f"eq.{pid}"}, json=s)
        if r2.status_code < 300:
            updates_applied += 1

        if (i+1) % 100 == 0:
            logger.info("  Progress: %d / %d", i+1, total)

    logger.info("=== Done: %d / %d parcels updated ===", updates_applied, total)


if __name__ == "__main__":
    main()
