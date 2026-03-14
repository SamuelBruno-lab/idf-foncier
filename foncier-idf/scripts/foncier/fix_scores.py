"""
Recalculates parcel_scores for a commune after market prices have been fixed.
Uses Supabase REST API.

Usage:
    cd foncier-idf && python -m scripts.foncier.fix_scores --insee 92078
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

# Config (matching config.py defaults)
SELLABLE_RATIO = 0.75
CONSTRUCTION_COST_M2 = 1300.0
VRD_COST_M2 = 100.0
SALES_FEE_RATIO = 0.03
MARGIN_RATIO = 0.08


def get_headers():
    return {
        "apikey": os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        "Authorization": f"Bearer {os.environ['SUPABASE_SERVICE_ROLE_KEY']}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def url():
    return os.environ["NEXT_PUBLIC_SUPABASE_URL"]


def fetch_all(table, params, select="*"):
    all_rows = []
    offset = 0
    while True:
        p = {**params, "select": select, "limit": "1000", "offset": str(offset)}
        r = SESSION.get(f"{url()}/rest/v1/{table}", headers=get_headers(), params=p)
        r.raise_for_status()
        rows = r.json()
        all_rows.extend(rows)
        if len(rows) < 1000:
            break
        offset += 1000
    return all_rows


def compute_score(area_m2, underuse_ratio, zone_family, price_m2, estimated_gfa, coverage_ratio):
    """Recompute mutability score and sub-scores."""
    # Sub-scores
    if underuse_ratio >= 0.80:
        underuse_score = 10
    elif underuse_ratio >= 0.60:
        underuse_score = 8
    elif underuse_ratio >= 0.40:
        underuse_score = 6
    elif underuse_ratio >= 0.20:
        underuse_score = 4
    else:
        underuse_score = 1

    zone_scores = {"U": 9, "AU": 7, "A": 2, "N": 1}
    zoning_score = zone_scores.get(zone_family, 3)

    if price_m2 >= 6000:
        market_score = 10
    elif price_m2 >= 4500:
        market_score = 8
    elif price_m2 >= 3000:
        market_score = 6
    elif price_m2 >= 2000:
        market_score = 4
    else:
        market_score = 2

    if area_m2 >= 1000:
        size_score = 9
    elif area_m2 >= 600:
        size_score = 7
    elif area_m2 >= 300:
        size_score = 5
    else:
        size_score = 2

    # Land value
    program_value = estimated_gfa * SELLABLE_RATIO * price_m2
    land_value = (
        program_value
        - estimated_gfa * CONSTRUCTION_COST_M2
        - estimated_gfa * VRD_COST_M2
        - program_value * SALES_FEE_RATIO
        - program_value * MARGIN_RATIO
    )

    if land_value >= 1_500_000:
        lv_score = 10
    elif land_value >= 800_000:
        lv_score = 8
    elif land_value >= 400_000:
        lv_score = 6
    elif land_value >= 150_000:
        lv_score = 4
    else:
        lv_score = 2

    total = round(
        0.30 * underuse_score
        + 0.25 * zoning_score
        + 0.20 * market_score
        + 0.15 * size_score
        + 0.10 * lv_score,
        2,
    )

    # Best use
    if zone_family in ("U", "AU") and area_m2 >= 600 and underuse_ratio >= 0.70:
        best_use = "densification_residentielle"
    elif zone_family == "U" and 300 <= area_m2 <= 700 and underuse_ratio >= 0.60:
        best_use = "division_parcellaire"
    elif zone_family == "U" and coverage_ratio < 0.15:
        best_use = "dent_creuse"
    else:
        best_use = "analyse_complementaire"

    return {
        "mutability_score": total,
        "underuse_score": underuse_score,
        "zoning_score": zoning_score,
        "market_score": market_score,
        "size_score": size_score,
        "land_value_score": lv_score,
        "best_use": best_use,
        "land_value_est": round(land_value, 2),
        "program_value_est": round(program_value, 2),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--insee", required=True)
    args = parser.parse_args()

    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env.local"))

    insee = args.insee
    logger.info("=== Recalculate scores for %s ===", insee)

    # Fetch all data
    market = {r["parcel_id"]: r for r in fetch_all(
        "parcel_market_stats", {"parcel_id": f"like.{insee}*"},
        select="parcel_id,median_price_m2",
    )}
    construct = {r["parcel_id"]: r for r in fetch_all(
        "parcel_constructibility", {"parcel_id": f"like.{insee}*"},
        select="parcel_id,dominant_zone_family,estimated_gfa,underuse_ratio,residual_potential_est",
    )}
    building = {r["parcel_id"]: r for r in fetch_all(
        "parcel_building_stats", {"parcel_id": f"like.{insee}*"},
        select="parcel_id,coverage_ratio",
    )}
    scores_raw = fetch_all(
        "parcel_scores", {"parcel_id": f"like.{insee}*"},
        select="parcel_id,mutability_score,land_value_est,explanation_json",
    )

    # Fetch areas from parcels table
    areas = {}
    for r in fetch_all("parcels", {"insee_code": f"eq.{insee}"}, select="parcel_id,area_m2"):
        areas[r["parcel_id"]] = r.get("area_m2", 0) or 0

    logger.info("Loaded: %d market, %d construct, %d building, %d scores, %d areas",
                len(market), len(construct), len(building), len(scores_raw), len(areas))

    updates = []
    for s in scores_raw:
        pid = s["parcel_id"]
        m = market.get(pid, {})
        c = construct.get(pid, {})
        b = building.get(pid, {})

        price_m2 = m.get("median_price_m2") or 0
        area_m2 = areas.get(pid, 0)
        underuse = c.get("underuse_ratio") or 0
        zone = c.get("dominant_zone_family") or "U"
        gfa = c.get("estimated_gfa") or 0
        coverage = b.get("coverage_ratio") or 0
        residual = c.get("residual_potential_est") or 0

        new = compute_score(area_m2, underuse, zone, price_m2, gfa, coverage)
        new["explanation_json"] = json.dumps({
            "area_m2": area_m2,
            "underuse_ratio": underuse,
            "dominant_zone_family": zone,
            "median_price_m2": price_m2,
            "estimated_gfa": gfa,
            "residual_potential_est": residual,
            "coverage_ratio": coverage,
        })

        # Only update if score changed
        old_score = s.get("mutability_score")
        old_lv = s.get("land_value_est")
        if old_score != new["mutability_score"] or old_lv != new["land_value_est"]:
            updates.append({"parcel_id": pid, **new})

    logger.info("Scores to recalculate: %d / %d", len(updates), len(scores_raw))

    # Apply updates
    updated = 0
    for i, item in enumerate(updates):
        pid = item.pop("parcel_id")
        item["computed_at"] = "now()"
        r = SESSION.patch(
            f"{url()}/rest/v1/parcel_scores",
            headers=get_headers(),
            params={"parcel_id": f"eq.{pid}"},
            json=item,
        )
        if r.status_code < 300:
            updated += 1
        elif i < 3:
            logger.warning("Failed %s: %s", pid, r.text[:200])

        if (i + 1) % 100 == 0:
            logger.info("  Progress: %d / %d", i + 1, len(updates))

    logger.info("Updated %d / %d scores", updated, len(updates))
    logger.info("=== Done ===")


if __name__ == "__main__":
    main()
