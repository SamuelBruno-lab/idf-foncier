"""
One-off script to re-import BD TOPO buildings for commune 92078
and recompute building stats + scores via REST API.

Uses the local BD TOPO GeoJSON file (avoids WFS API issues).
Works without direct PostgreSQL access (REST API only).
Does NOT require the insee_code column (uses upsert by building_id).

Usage:
    cd foncier-idf && python -m scripts.foncier.reimport_92078
"""
from __future__ import annotations

import json
import logging
import os
import sys

import requests
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env.local"))

from .import_buildings_bdtopo import (
    process_features,
    log_stats,
    SESSION,
    supabase_url,
    headers_upsert,
    headers,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

LOCAL_FILE = os.path.join(os.path.dirname(__file__), "../../../data/buildings/bdtopo-92078-batiments.json")


def batch_upsert_no_insee(buildings: list[dict], batch_size: int = 50):
    """Upsert buildings without insee_code column (column may not exist)."""
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
            rows.append(row)

        r = SESSION.post(
            f"{supabase_url()}/rest/v1/buildings",
            headers=headers_upsert(),
            json=rows,
        )

        if r.status_code < 300:
            inserted += len(batch)
        else:
            if errors == 0:
                logger.warning("Batch upsert failed: %s", r.text[:300])
                logger.info("Trying individual upserts...")
            for b in batch:
                row = {
                    "building_id": b["building_id"],
                    "source": b["source"],
                    "levels_est": b["levels_est"],
                    "footprint_m2": b["footprint_m2"],
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
                    if errors <= 5:
                        logger.warning("Upsert error for %s: %s",
                                       b["building_id"], r2.text[:200])

        if (i + batch_size) % 500 == 0 or i + batch_size >= len(buildings):
            logger.info("  Progress: %d / %d (inserted=%d, errors=%d)",
                        min(i + batch_size, len(buildings)), len(buildings),
                        inserted, errors)

    logger.info("=== Upsert done: %d inserted, %d errors ===", inserted, errors)
    return inserted, errors


def recompute_building_stats_rest(insee: str):
    """Recompute building stats via Supabase RPC if available."""
    sk = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    h = {
        "apikey": sk,
        "Authorization": f"Bearer {sk}",
        "Content-Type": "application/json",
    }

    # Try to call score_commune_parcels RPC (includes building stats)
    logger.info("Calling score_commune_parcels RPC for %s...", insee)
    r = SESSION.post(
        f"{supabase_url()}/rest/v1/rpc/score_commune_parcels",
        headers=h,
        json={"p_insee_code": insee},
        timeout=300,
    )
    if r.status_code < 300:
        logger.info("RPC score_commune_parcels succeeded!")
        return True

    logger.warning("RPC failed (status %s): %s", r.status_code, r.text[:300])

    # Try compute_building_stats RPC
    logger.info("Trying compute_building_stats RPC...")
    r2 = SESSION.post(
        f"{supabase_url()}/rest/v1/rpc/compute_building_stats",
        headers=h,
        json={"p_insee_code": insee},
        timeout=300,
    )
    if r2.status_code < 300:
        logger.info("RPC compute_building_stats succeeded!")
        return True

    logger.warning("RPC compute_building_stats also failed: %s", r2.text[:300])
    return False


def main():
    insee = "92078"
    logger.info("=== Re-importing buildings for commune %s from local file ===", insee)

    # Step 1: Load buildings from local GeoJSON
    logger.info("Loading local file: %s", LOCAL_FILE)
    with open(LOCAL_FILE) as f:
        data = json.load(f)
    features = data.get("features", data if isinstance(data, list) else [])
    logger.info("Loaded %d features from local file", len(features))

    # Step 2: Process features (convert geom, compute levels)
    buildings = process_features(features, insee=insee)

    if not buildings:
        logger.error("No buildings to insert for commune %s", insee)
        sys.exit(1)

    log_stats(features, buildings)

    # Step 3: Upsert buildings (merge-duplicates handles existing records)
    logger.info("Upserting %d buildings (merge-duplicates, no insee_code column)...", len(buildings))
    inserted, errors = batch_upsert_no_insee(buildings)

    if inserted == 0:
        logger.error("No buildings were inserted!")
        sys.exit(1)

    # Step 4: Recompute building stats + scores
    rpc_ok = recompute_building_stats_rest(insee)

    if not rpc_ok:
        logger.info("RPC not available. Running fix_scores as fallback...")
        from .fix_scores import main as fix_scores_main
        sys.argv = ["fix_scores", "--insee", insee]
        fix_scores_main()

    logger.info("=== Done! ===")


if __name__ == "__main__":
    main()
