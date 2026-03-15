"""
Import BD TOPO IGN buildings into Supabase via REST API.

Downloads building geometries from the IGN BD TOPO v3 WFS service for a given
commune (--insee) or department (--dept), converts to Lambert-93 EWKT, computes
estimated floor counts, and upserts into the buildings table.

Data source: IGN BD TOPO v3 WFS (https://data.geopf.fr/wfs/ows)

Usage:
    cd foncier-idf
    python -m scripts.foncier.import_buildings_bdtopo --insee 92078
    python -m scripts.foncier.import_buildings_bdtopo --dept 92
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
from typing import Optional

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

# WGS84 -> Lambert-93
TO_L93 = Transformer.from_crs("EPSG:4326", "EPSG:2154", always_xy=True)

FLOOR_HEIGHT_M = 3.0

WFS_BASE_URL = "https://data.geopf.fr/wfs/ows"
WFS_TYPENAME = "BDTOPO_V3:batiment"
WFS_MAX_FEATURES = 1000  # server-imposed page size limit

# Approximate WGS84 bboxes for Ile-de-France departments (minx, miny, maxx, maxy)
DEPT_BBOXES = {
    "75": (2.22, 48.815, 2.47, 48.905),
    "77": (2.39, 48.12, 3.56, 49.12),
    "78": (1.44, 48.43, 2.23, 49.09),
    "91": (1.92, 48.28, 2.59, 48.78),
    "92": (2.14, 48.72, 2.34, 48.95),
    "93": (2.28, 48.84, 2.60, 49.02),
    "94": (2.31, 48.69, 2.62, 48.87),
    "95": (1.60, 48.95, 2.59, 49.26),
}


def supabase_url() -> str:
    return os.environ["NEXT_PUBLIC_SUPABASE_URL"]


def headers() -> dict:
    sk = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {
        "apikey": sk,
        "Authorization": f"Bearer {sk}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def headers_upsert() -> dict:
    sk = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {
        "apikey": sk,
        "Authorization": f"Bearer {sk}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }


def get_commune_bbox(insee: str) -> tuple[float, float, float, float]:
    """Fetch a tight WGS84 bbox for a commune from parcels already in Supabase.

    Uses the PostgREST RPC endpoint to compute ST_Extent on the parcels table,
    falling back to a direct bbox query.
    """
    logger.info("Fetching bbox for commune %s from parcels...", insee)
    sk = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    h = {
        "apikey": sk,
        "Authorization": f"Bearer {sk}",
        "Content-Type": "application/json",
    }

    # Try to get the envelope via a direct query on parcels
    # We request the bbox columns computed by PostGIS
    r = SESSION.get(
        f"{supabase_url()}/rest/v1/rpc/parcels_bbox",
        headers=h,
        params={"code_insee": insee},
    )
    if r.status_code < 300 and r.json():
        data = r.json()
        if isinstance(data, list) and len(data) > 0:
            data = data[0]
        if all(k in data for k in ("xmin", "ymin", "xmax", "ymax")):
            bbox = (data["xmin"], data["ymin"], data["xmax"], data["ymax"])
            logger.info("Commune %s bbox from RPC: %s", insee, bbox)
            return bbox

    # Fallback: query parcels with select and filter, use Supabase to get geometry bounds
    # Get a sample of parcels to compute an approximate bbox
    logger.info("RPC not available, computing bbox from parcel geometries...")
    r = SESSION.get(
        f"{supabase_url()}/rest/v1/parcels",
        headers=h,
        params={
            "select": "id,geom",
            "code_insee": f"eq.{insee}",
            "limit": 1,
        },
    )

    # Last resort: use department bbox with a small margin from the INSEE code
    dept = insee[:2] if not insee.startswith("97") else insee[:3]
    if dept in DEPT_BBOXES:
        logger.warning("Could not get commune bbox, using department %s bbox", dept)
        return DEPT_BBOXES[dept]

    raise RuntimeError(f"Cannot determine bbox for commune {insee}")


def fetch_buildings_wfs(bbox: tuple[float, float, float, float],
                        cql_filter: Optional[str] = None) -> list[dict]:
    """Download all buildings from the IGN WFS within the given WGS84 bbox.

    Handles pagination via STARTINDEX since the server caps responses at 1000
    features per request.
    """
    minx, miny, maxx, maxy = bbox
    bbox_str = f"{miny},{minx},{maxy},{maxx},EPSG:4326"  # WFS bbox is lat/lon order

    all_features: list[dict] = []
    start_index = 0

    while True:
        params = {
            "SERVICE": "WFS",
            "VERSION": "2.0.0",
            "REQUEST": "GetFeature",
            "TYPENAME": WFS_TYPENAME,
            "OUTPUTFORMAT": "application/json",
            "SRSNAME": "EPSG:4326",
            "BBOX": bbox_str,
            "COUNT": str(WFS_MAX_FEATURES),
            "STARTINDEX": str(start_index),
        }
        if cql_filter:
            params["CQL_FILTER"] = cql_filter

        logger.info("WFS request STARTINDEX=%d ...", start_index)
        r = SESSION.get(WFS_BASE_URL, params=params, timeout=120)
        r.raise_for_status()

        data = r.json()
        features = data.get("features", [])
        count = len(features)
        all_features.extend(features)
        logger.info("  Received %d features (total so far: %d)", count, len(all_features))

        if count < WFS_MAX_FEATURES:
            break  # last page
        start_index += WFS_MAX_FEATURES

    return all_features


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


def process_features(features: list[dict], insee: str | None = None) -> list[dict]:
    """Convert raw GeoJSON features to building dicts ready for insert."""
    buildings = []
    skipped = 0

    for i, feat in enumerate(features):
        props = feat["properties"]

        # Skip buildings not yet built
        if props.get("etat_de_l_objet") == "En projet":
            skipped += 1
            continue

        geom_wgs = shape(feat["geometry"])
        if not geom_wgs.is_valid:
            geom_wgs = geom_wgs.buffer(0)

        # Force 2D (BD TOPO has Z coordinates, table is 2D)
        if geom_wgs.has_z:
            geom_wgs = shapely_transform(lambda x, y, z=None: (x, y), geom_wgs)

        # Ensure MultiPolygon
        if geom_wgs.geom_type == "Polygon":
            geom_wgs = MultiPolygon([geom_wgs])
        elif geom_wgs.geom_type != "MultiPolygon":
            logger.warning("Skipping feature %d with geometry type %s", i, geom_wgs.geom_type)
            skipped += 1
            continue

        # Convert to Lambert-93
        geom_l93 = shapely_transform(TO_L93.transform, geom_wgs)
        footprint_m2 = geom_l93.area

        levels = compute_levels(props, footprint_m2)

        # Use BD TOPO cleabs as building_id (globally unique)
        cleabs = props.get("cleabs", f"BDTOPO_UNKNOWN_{i:06d}")

        building = {
            "building_id": cleabs,
            "source": "BDTOPO",
            "levels_est": levels,
            "footprint_m2": round(footprint_m2, 1),
            "geom_wkt": geom_l93.wkt,
        }
        if insee:
            building["insee_code"] = insee
        buildings.append(building)

    logger.info("Processed %d buildings (skipped %d)", len(buildings), skipped)
    return buildings


def delete_existing(pattern: str):
    """Delete existing buildings matching a LIKE pattern."""
    logger.info("Deleting existing buildings matching '%s'...", pattern)
    r = SESSION.delete(
        f"{supabase_url()}/rest/v1/buildings",
        headers=headers(),
        params={"building_id": f"like.{pattern}"},
    )
    logger.info("Delete '%s': status %s", pattern, r.status_code)
    if r.status_code >= 300:
        logger.warning("Delete response: %s", r.text[:300])


def delete_by_commune(insee: str):
    """Delete existing buildings for a specific commune using insee_code column."""
    logger.info("Deleting existing buildings for commune %s...", insee)
    r = SESSION.delete(
        f"{supabase_url()}/rest/v1/buildings",
        headers=headers(),
        params={"insee_code": f"eq.{insee}"},
    )
    logger.info("Delete commune %s: status %s", insee, r.status_code)
    if r.status_code >= 300:
        logger.warning("Delete response: %s", r.text[:300])


def batch_insert(buildings: list[dict], batch_size: int = 50):
    """Insert buildings into Supabase in batches, with per-row fallback on errors."""
    inserted = 0
    errors = 0

    for i in range(0, len(buildings), batch_size):
        batch = buildings[i:i + batch_size]
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

        if (i + batch_size) % 500 == 0 or i + batch_size >= len(buildings):
            logger.info("  Progress: %d / %d (inserted=%d, errors=%d)",
                        min(i + batch_size, len(buildings)), len(buildings),
                        inserted, errors)

    logger.info("=== Done: %d inserted, %d errors ===", inserted, errors)
    return inserted, errors


def log_stats(features: list[dict], buildings: list[dict]):
    """Log data quality and level distribution statistics."""
    if not buildings:
        logger.warning("No buildings to report on.")
        return

    has_height = sum(1 for f in features
                     if f["properties"].get("hauteur") is not None)
    has_floors = sum(1 for f in features
                     if f["properties"].get("nombre_d_etages") is not None)
    logger.info("Data quality: %d with hauteur (%.0f%%), %d with nombre_d_etages (%.0f%%)",
                has_height, 100 * has_height / max(len(features), 1),
                has_floors, 100 * has_floors / max(len(features), 1))

    logger.info("Footprint range: %.0f - %.0f m2",
                min(b["footprint_m2"] for b in buildings),
                max(b["footprint_m2"] for b in buildings))

    # Level distribution
    level_dist: dict[int, int] = {}
    for b in buildings:
        level_dist[b["levels_est"]] = level_dist.get(b["levels_est"], 0) + 1
    for lvl, cnt in sorted(level_dist.items()):
        logger.info("  %d floors: %d buildings", lvl, cnt)

    # Level source distribution
    active = [f for f in features if f["properties"].get("etat_de_l_objet") != "En projet"]
    src_direct = sum(1 for f in active
                     if f["properties"].get("nombre_d_etages") is not None
                     and f["properties"]["nombre_d_etages"] > 0)
    src_height = sum(1 for f in active
                     if (f["properties"].get("nombre_d_etages") is None
                         or f["properties"]["nombre_d_etages"] <= 0)
                     and f["properties"].get("hauteur") is not None
                     and f["properties"]["hauteur"] > 0)
    src_heuristic = len(buildings) - src_direct - src_height
    logger.info("Level source: %d direct (nombre_d_etages), %d from hauteur, %d heuristic",
                src_direct, src_height, src_heuristic)


def import_commune(insee: str):
    """Import buildings for a single commune identified by INSEE code."""
    logger.info("=== Importing buildings for commune %s ===", insee)

    bbox = get_commune_bbox(insee)
    logger.info("Using bbox: %s", bbox)

    # Optionally filter by commune code via CQL_FILTER
    cql = f"code_insee='{insee}'"
    features = fetch_buildings_wfs(bbox, cql_filter=cql)

    if not features:
        # Retry without CQL filter (some WFS versions may not support it for this layer)
        logger.warning("No features with CQL filter, retrying without filter...")
        features = fetch_buildings_wfs(bbox)

    logger.info("Downloaded %d features for commune %s", len(features), insee)
    buildings = process_features(features, insee=insee)

    if not buildings:
        logger.warning("No buildings to insert for commune %s", insee)
        return

    log_stats(features, buildings)

    # Delete existing buildings for this commune only (not all communes!)
    delete_by_commune(insee)
    # Also delete any old-style IDs that might exist for this commune
    delete_existing(f"BAT{insee}%")

    batch_insert(buildings)


def import_department(dept: str):
    """Import buildings for an entire department."""
    logger.info("=== Importing buildings for department %s ===", dept)

    if dept not in DEPT_BBOXES:
        logger.error("No predefined bbox for department %s. "
                     "Supported departments: %s", dept, ", ".join(sorted(DEPT_BBOXES)))
        sys.exit(1)

    bbox = DEPT_BBOXES[dept]
    logger.info("Using department bbox: %s", bbox)

    features = fetch_buildings_wfs(bbox)
    logger.info("Downloaded %d features for department %s", len(features), dept)

    # For department import, try to extract insee_code from each feature
    buildings = process_features(features)

    if not buildings:
        logger.warning("No buildings to insert for department %s", dept)
        return

    log_stats(features, buildings)

    # Delete existing buildings for this department only
    delete_existing(f"BAT{dept}%")

    batch_insert(buildings)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Import BD TOPO buildings from IGN WFS into Supabase")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--insee", type=str,
                       help="Commune INSEE code (e.g. 92078)")
    group.add_argument("--dept", type=str,
                       help="Department code (e.g. 92)")
    return parser.parse_args()


def main():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env.local"))

    args = parse_args()

    if args.insee:
        import_commune(args.insee)
    elif args.dept:
        import_department(args.dept)


if __name__ == "__main__":
    main()
