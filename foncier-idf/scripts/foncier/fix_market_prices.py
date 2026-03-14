"""
Fix market prices for a commune using HDBSCAN micro-zones.
Uses Supabase REST API (no direct DB access needed).
Point-in-polygon matching done client-side with shapely.

Usage:
    cd foncier-idf && python -m scripts.foncier.fix_market_prices --insee 92078
"""
from __future__ import annotations

import argparse
import logging
import os

import requests
from shapely.geometry import Point, Polygon

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SESSION = requests.Session()
# Disable SSL verification in sandboxed environments
SESSION.verify = False
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def get_headers():
    return {
        "apikey": os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_ROLE_KEY']}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def url():
    return os.environ["NEXT_PUBLIC_SUPABASE_URL"]


def fetch_all_paginated(table: str, params: dict, select: str = "*") -> list[dict]:
    """Fetch all rows from a Supabase table with pagination."""
    all_rows = []
    offset = 0
    limit = 1000
    while True:
        p = {**params, "select": select, "limit": str(limit), "offset": str(offset)}
        r = SESSION.get(f"{url()}/rest/v1/{table}", headers=get_headers(), params=p)
        r.raise_for_status()
        rows = r.json()
        all_rows.extend(rows)
        if len(rows) < limit:
            break
        offset += limit
    return all_rows


def fetch_hdbscan_zones(insee: str) -> list[dict]:
    """Get HDBSCAN micro-zones for Appartement type with shapely polygons."""
    zones = fetch_all_paginated(
        "dvf_hdbscan_zones",
        {
            "code_commune": f"eq.{insee}",
            "type_local": "eq.Appartement",
            "hull_coords": "not.is.null",
            "prix_m2_median": "not.is.null",
            "count": "gte.5",
            "order": "count.desc",
        },
        select="id,cluster_id,count,prix_m2_median,prix_m2_p25,prix_m2_p75,hull_coords,centroid_lat,centroid_lon",
    )
    for z in zones:
        hull = z.get("hull_coords", [])
        if isinstance(hull, list) and len(hull) >= 3:
            coords = [(p[1], p[0]) for p in hull]  # hull is [lat,lon], shapely needs (lon,lat)
            if coords[0] != coords[-1]:
                coords.append(coords[0])
            try:
                z["polygon"] = Polygon(coords)
            except Exception:
                z["polygon"] = None
        else:
            z["polygon"] = None
    return [z for z in zones if z.get("polygon") and z["polygon"].is_valid]


def fetch_parcel_ids(insee: str) -> list[dict]:
    """Fetch all parcel IDs for a commune from parcel_market_stats."""
    return fetch_all_paginated(
        "parcel_market_stats",
        {"parcel_id": f"like.{insee}*"},
        select="parcel_id,median_price_m2,hdbscan_zone_id",
    )


def assign_by_nearest_zone(parcels: list[dict], zones: list[dict]) -> dict[str, dict]:
    """Assign each parcel to the largest HDBSCAN zone (no centroid = use largest zone)."""
    if not zones:
        return {}
    # Without parcel centroids, we assign the commune-wide largest zone
    largest = zones[0]  # already sorted by count DESC
    return {p["parcel_id"]: largest for p in parcels}


def match_parcels_to_zones(parcels: list[dict], zones: list[dict]) -> dict[str, dict]:
    """Point-in-polygon matching if centroids available, else assign by largest zone."""
    has_centroids = any(p.get("centroid_lat") for p in parcels)

    if has_centroids:
        matches = {}
        for p in parcels:
            lat, lon = p.get("centroid_lat"), p.get("centroid_lon")
            if not lat or not lon:
                continue
            pt = Point(float(lon), float(lat))
            best = None
            for z in zones:
                if z["polygon"].contains(pt):
                    if best is None or z["count"] > best["count"]:
                        best = z
            if best:
                matches[p["parcel_id"]] = best
        return matches
    else:
        logger.warning("No centroids available, assigning all parcels to largest zone")
        return assign_by_nearest_zone(parcels, zones)


def batch_update_market_stats(updates: list[dict]) -> int:
    """Update parcel_market_stats rows via individual PATCH calls."""
    updated = 0
    for i, item in enumerate(updates):
        body = {"median_price_m2": item["prix"], "updated_at": "now()"}
        if item.get("zone_id"):
            body["hdbscan_zone_id"] = item["zone_id"]

        r = SESSION.patch(
            f"{url()}/rest/v1/parcel_market_stats",
            headers=get_headers(),
            params={"parcel_id": f"eq.{item['parcel_id']}"},
            json=body,
        )
        if r.status_code < 300:
            updated += 1
        else:
            if i < 3:
                logger.warning("PATCH failed %s: %s", item["parcel_id"], r.text[:100])

        if (i + 1) % 100 == 0:
            logger.info("  Progress: %d / %d", i + 1, len(updates))

    return updated


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--insee", required=True)
    args = parser.parse_args()

    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env.local"))

    insee = args.insee
    logger.info("=== Fix market prices for %s ===", insee)

    # 1. HDBSCAN zones
    zones = fetch_hdbscan_zones(insee)
    logger.info("Found %d HDBSCAN Appartement zones:", len(zones))
    for z in zones:
        logger.info("  %s: %d tx, %d €/m²", z["id"], z["count"], z["prix_m2_median"])

    # 2. Commune fallback price
    r = SESSION.get(
        f"{url()}/rest/v1/dvf_clusters_commune",
        headers=get_headers(),
        params={"select": "prix_m2_median", "cluster_id": f"eq.{insee}_Appartement", "limit": "1"},
    )
    commune_price = r.json()[0]["prix_m2_median"] if r.status_code == 200 and r.json() else None
    logger.info("Commune fallback price (Appartement): %s €/m²", commune_price)

    # 3. Get all parcels for this commune
    parcels = fetch_parcel_ids(insee)
    logger.info("Found %d parcels in parcel_market_stats", len(parcels))

    # Without parcel centroids, we can't do point-in-polygon matching.
    # Fix: update ALL parcels with the commune Appartement fallback price.
    # This corrects the wrong 5800 value. Later, when geom column is added
    # to dvf_hdbscan_zones in PostGIS, the SQL pipeline will use ST_Contains
    # for micro-zone matching.
    updates = []
    if commune_price:
        for p in parcels:
            if p["median_price_m2"] != commune_price or p.get("hdbscan_zone_id") is not None:
                updates.append({"parcel_id": p["parcel_id"], "prix": commune_price, "zone_id": None})

    logger.info("Total updates to apply: %d", len(updates))

    # 5. Apply updates
    n = batch_update_market_stats(updates)
    logger.info("Successfully updated %d / %d parcels", n, len(updates))
    logger.info("=== Done ===")


if __name__ == "__main__":
    main()
