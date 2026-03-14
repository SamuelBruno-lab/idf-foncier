"""
Import cadastre buildings for VLG into Supabase via REST API.
Converts WGS84 GeoJSON to Lambert-93 WKT for PostGIS storage.

The cadastre doesn't have height data, so we estimate levels from
building footprint area (heuristic: large footprint = likely tall building).

Usage:
    cd foncier-idf && python -m scripts.foncier.import_buildings_vlg
"""
from __future__ import annotations

import json
import logging
import os

import requests
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform as shapely_transform

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SESSION = requests.Session()
SESSION.verify = False
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# WGS84 → Lambert-93
TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)


def supabase_url():
    return os.environ["NEXT_PUBLIC_SUPABASE_URL"]


def headers():
    sk = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {"apikey": sk, "Authorization": f"Bearer {sk}",
            "Content-Type": "application/json", "Prefer": "return=minimal"}


def headers_upsert():
    sk = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {"apikey": sk, "Authorization": f"Bearer {sk}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal"}


def estimate_levels(footprint_m2: float) -> int:
    """Estimate building levels from footprint area.

    Heuristic based on VLG building stock:
    - Very large footprint (>2000m²): likely a tall residential tower (8-15 floors)
    - Large (800-2000m²): mid-rise apartment block (4-8 floors)
    - Medium (300-800m²): small apartment/office (3-5 floors)
    - Small (100-300m²): house or small building (2-3 floors)
    - Very small (<100m²): shed, garage (1 floor)
    """
    if footprint_m2 >= 2000:
        return 10
    elif footprint_m2 >= 800:
        return 6
    elif footprint_m2 >= 300:
        return 4
    elif footprint_m2 >= 100:
        return 2
    else:
        return 1


def main():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env.local"))

    geojson_path = os.path.join(os.path.dirname(__file__), "../../data/buildings/cadastre-92078-batiments.json")

    logger.info("Loading cadastre buildings from %s", geojson_path)
    with open(geojson_path) as f:
        data = json.load(f)

    features = data.get("features", [])
    logger.info("Loaded %d building features", len(features))

    # Convert to Lambert-93 and prepare for insert
    buildings = []
    for i, feat in enumerate(features):
        geom_wgs = shape(feat["geometry"])
        if not geom_wgs.is_valid:
            geom_wgs = geom_wgs.buffer(0)

        # Convert to Lambert-93
        geom_l93 = shapely_transform(TO_L93.transform, geom_wgs)
        footprint_m2 = geom_l93.area

        levels = estimate_levels(footprint_m2)
        building_id = f"BAT92078{i:06d}"

        # Convert to WKT for PostGIS (SRID 2154)
        wkt = geom_l93.wkt

        buildings.append({
            "building_id": building_id,
            "levels_est": levels,
            "footprint_m2": round(footprint_m2, 1),
            "geom_wkt": wkt,  # For use in SQL INSERT with ST_GeomFromText
        })

    logger.info("Prepared %d buildings (footprint range: %.0f - %.0f m²)",
                len(buildings),
                min(b["footprint_m2"] for b in buildings),
                max(b["footprint_m2"] for b in buildings))

    # Level distribution
    level_dist = {}
    for b in buildings:
        level_dist[b["levels_est"]] = level_dist.get(b["levels_est"], 0) + 1
    for lvl, cnt in sorted(level_dist.items()):
        logger.info("  %d floors: %d buildings", lvl, cnt)

    # Since we can't execute INSERT with ST_GeomFromText via REST,
    # we need to use a different approach. Let's create an RPC or use
    # the Supabase JS client. Actually, PostgREST supports geometry
    # columns if we send GeoJSON format.

    # Supabase PostgREST can accept geometry as GeoJSON string in SRID 4326
    # But our buildings table uses SRID 2154. Let's try sending in WGS84
    # and see if PostGIS auto-transforms, or send as EWKT.

    # Actually, the simplest: send geometry as EWKT string
    # PostgREST/PostGIS will parse it if the column type is geometry

    # First, delete existing VLG buildings
    logger.info("Deleting existing VLG buildings...")
    r = SESSION.delete(
        f"{supabase_url()}/rest/v1/buildings",
        headers=headers(),
        params={"building_id": "like.BAT92078*"},
    )
    logger.info("Delete response: %s", r.status_code)

    # Insert in batches
    batch_size = 50
    inserted = 0
    errors = 0

    for i in range(0, len(buildings), batch_size):
        batch = buildings[i:i+batch_size]
        rows = []
        for b in batch:
            rows.append({
                "building_id": b["building_id"],
                "levels_est": b["levels_est"],
                # Send geometry as EWKT (Extended WKT with SRID)
                "geom": f"SRID=2154;{b['geom_wkt']}",
            })

        r = SESSION.post(
            f"{supabase_url()}/rest/v1/buildings",
            headers=headers_upsert(),
            json=rows,
        )

        if r.status_code < 300:
            inserted += len(batch)
        else:
            # Try one by one on failure
            if i == 0:
                logger.warning("Batch insert failed: %s", r.text[:300])
                logger.info("Trying individual inserts...")

            for b in batch:
                row = {
                    "building_id": b["building_id"],
                    "levels_est": b["levels_est"],
                    "geom": f"SRID=2154;{b['geom_wkt']}",
                }
                r2 = SESSION.post(
                    f"{supabase_url()}/rest/v1/buildings",
                    headers=headers_upsert(),
                    json=row,
                )
                if r2.status_code < 300:
                    inserted += 1
                else:
                    errors += 1
                    if errors <= 3:
                        logger.warning("Insert error for %s: %s", b["building_id"], r2.text[:200])

        if (i + batch_size) % 200 == 0 or i + batch_size >= len(buildings):
            logger.info("  Progress: %d / %d (inserted=%d, errors=%d)",
                        min(i + batch_size, len(buildings)), len(buildings), inserted, errors)

    logger.info("=== Done: %d inserted, %d errors ===", inserted, errors)


if __name__ == "__main__":
    main()
