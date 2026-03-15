"""
Import BD TOPO IGN buildings for VLG (92078) into Supabase via REST API.

Uses real height data from BD TOPO (hauteur, nombre_d_etages) instead of
heuristic estimates. Converts WGS84 GeoJSON to Lambert-93 EWKT for PostGIS.

Data source: IGN BD TOPO v3.5 WFS (https://data.geopf.fr/wfs/ows)

Usage:
    cd foncier-idf && python -m scripts.foncier.import_buildings_vlg
"""
from __future__ import annotations

import json
import logging
import math
import os

import requests
from pyproj import Transformer
from shapely.geometry import shape, MultiPolygon
from shapely.ops import transform as shapely_transform

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SESSION = requests.Session()
SESSION.verify = False
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# WGS84 → Lambert-93
TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)

FLOOR_HEIGHT_M = 3.0  # standard floor height


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


def compute_levels(props: dict, footprint_m2: float) -> int:
    """Compute building levels from BD TOPO data.

    Priority:
    1. nombre_d_etages (direct from BD TOPO)
    2. hauteur / 3m (from measured height)
    3. Heuristic from footprint area (fallback)
    """
    etages = props.get("nombre_d_etages")
    if etages is not None and etages > 0:
        return int(etages)

    hauteur = props.get("hauteur")
    if hauteur is not None and hauteur > 0:
        return max(1, math.floor(hauteur / FLOOR_HEIGHT_M))

    # Fallback heuristic
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

    geojson_path = os.path.join(os.path.dirname(__file__),
                                "../../../data/buildings/bdtopo-92078-batiments.json")

    logger.info("Loading BD TOPO buildings from %s", geojson_path)
    with open(geojson_path) as f:
        data = json.load(f)

    features = data.get("features", [])
    logger.info("Loaded %d building features", len(features))

    # Stats on data quality
    has_height = sum(1 for f in features if f["properties"].get("hauteur") is not None)
    has_floors = sum(1 for f in features if f["properties"].get("nombre_d_etages") is not None)
    logger.info("Data quality: %d with hauteur (%.0f%%), %d with nombre_d_etages (%.0f%%)",
                has_height, 100 * has_height / len(features),
                has_floors, 100 * has_floors / len(features))

    # Convert to Lambert-93 and prepare for insert
    buildings = []
    skipped = 0
    for i, feat in enumerate(features):
        props = feat["properties"]

        # Skip "En projet" buildings (not yet built)
        if props.get("etat_de_l_objet") == "En projet":
            skipped += 1
            continue

        geom_wgs = shape(feat["geometry"])
        if not geom_wgs.is_valid:
            geom_wgs = geom_wgs.buffer(0)

        # Force 2D (BD TOPO has Z coordinates, table is 2D)
        if geom_wgs.has_z:
            from shapely.ops import transform as _t
            geom_wgs = _t(lambda x, y, z=None: (x, y), geom_wgs)

        # Ensure MultiPolygon (table expects MultiPolygon)
        if geom_wgs.geom_type == "Polygon":
            geom_wgs = MultiPolygon([geom_wgs])

        # Convert to Lambert-93
        geom_l93 = shapely_transform(TO_L93.transform, geom_wgs)
        footprint_m2 = geom_l93.area

        levels = compute_levels(props, footprint_m2)

        # Use BD TOPO cleabs as building_id (globally unique)
        cleabs = props.get("cleabs", f"BAT92078{i:06d}")

        buildings.append({
            "building_id": cleabs,
            "source": "BDTOPO",
            "levels_est": levels,
            "footprint_m2": round(footprint_m2, 1),
            "geom_wkt": geom_l93.wkt,
            "insee_code": "92078",
        })

    logger.info("Prepared %d buildings (skipped %d 'en projet')", len(buildings), skipped)
    logger.info("Footprint range: %.0f - %.0f m²",
                min(b["footprint_m2"] for b in buildings),
                max(b["footprint_m2"] for b in buildings))

    # Level distribution
    level_dist = {}
    for b in buildings:
        level_dist[b["levels_est"]] = level_dist.get(b["levels_est"], 0) + 1
    for lvl, cnt in sorted(level_dist.items()):
        logger.info("  %d floors: %d buildings", lvl, cnt)

    # Level source distribution
    src_direct = sum(1 for f in features
                     if f["properties"].get("nombre_d_etages") is not None
                     and f["properties"].get("etat_de_l_objet") != "En projet")
    src_height = sum(1 for f in features
                     if f["properties"].get("nombre_d_etages") is None
                     and f["properties"].get("hauteur") is not None
                     and f["properties"].get("etat_de_l_objet") != "En projet")
    src_heuristic = len(buildings) - src_direct - src_height
    logger.info("Level source: %d direct (nombre_d_etages), %d from hauteur, %d heuristic",
                src_direct, src_height, src_heuristic)

    # Delete existing VLG buildings (commune-specific only, not all!)
    logger.info("Deleting existing VLG buildings...")
    # Delete by insee_code (commune-specific)
    r = SESSION.delete(
        f"{supabase_url()}/rest/v1/buildings",
        headers=headers(),
        params={"insee_code": "eq.92078"},
    )
    logger.info("Delete insee_code=92078: %s", r.status_code)
    # Also delete old-style BAT92078* IDs
    r = SESSION.delete(
        f"{supabase_url()}/rest/v1/buildings",
        headers=headers(),
        params={"building_id": "like.BAT92078*"},
    )
    logger.info("Delete BAT92078*: %s", r.status_code)

    # Insert in batches
    batch_size = 50
    inserted = 0
    errors = 0

    for i in range(0, len(buildings), batch_size):
        batch = buildings[i:i+batch_size]
        rows = []
        for b in batch:
            row = {
                "building_id": b["building_id"],
                "source": b["source"],
                "levels_est": b["levels_est"],
                "footprint_m2": b["footprint_m2"],
                "geom": f"SRID=2154;{b['geom_wkt']}",
            }
            if "insee_code" in b:
                row["insee_code"] = b["insee_code"]
            rows.append(row)

        r = SESSION.post(
            f"{supabase_url()}/rest/v1/buildings",
            headers=headers_upsert(),
            json=rows,
        )

        if r.status_code < 300:
            inserted += len(batch)
        else:
            # Try one by one on failure
            if errors == 0:
                logger.warning("Batch insert failed: %s", r.text[:300])
                logger.info("Trying individual inserts...")

            for b in batch:
                row = {
                    "building_id": b["building_id"],
                    "source": b["source"],
                    "levels_est": b["levels_est"],
                    "footprint_m2": b["footprint_m2"],
                    "geom": f"SRID=2154;{b['geom_wkt']}",
                }
                if "insee_code" in b:
                    row["insee_code"] = b["insee_code"]
                r2 = SESSION.post(
                    f"{supabase_url()}/rest/v1/buildings",
                    headers=headers_upsert(),
                    json=row,
                )
                if r2.status_code < 300:
                    inserted += 1
                else:
                    errors += 1
                    if errors <= 5:
                        logger.warning("Insert error for %s: %s",
                                       b["building_id"], r2.text[:200])

        if (i + batch_size) % 200 == 0 or i + batch_size >= len(buildings):
            logger.info("  Progress: %d / %d (inserted=%d, errors=%d)",
                        min(i + batch_size, len(buildings)), len(buildings),
                        inserted, errors)

    logger.info("=== Done: %d inserted, %d errors ===", inserted, errors)


if __name__ == "__main__":
    main()
