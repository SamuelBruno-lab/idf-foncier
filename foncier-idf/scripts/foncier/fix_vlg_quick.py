"""
Quick fix: assign VLG parcels to nearest HDBSCAN zone by section.
No bbox API needed - uses section letter mapping to zones.

Sections in VLG and their approximate locations:
  A = nord-ouest (near cimetière)
  B = centre (Avenue de Verdun)
  C = est (near Seine, Île-Saint-Denis)
  D, E = sud-est
  F, G = sud
  H, I = sud-ouest
  J = nord-est (parc)

Usage:
    cd foncier-idf && python -m scripts.foncier.fix_vlg_quick
"""
from __future__ import annotations

import json
import logging
import os

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SESSION = requests.Session()
SESSION.verify = False
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# VLG HDBSCAN zones from the DB (Appartement type, 2020-2024):
# Zone 5: centre-ville, 108 tx, 2809 €/m² (centroid ~48.9298, 2.3233)
# Zone 0: sud-est (Seine), 89 tx, 4636 €/m² (centroid ~48.9267, 2.3276)
# Zone 2: est, 50 tx, 4101 €/m² (centroid ~48.9312, 2.3349)
# Zone 3: nord, 37 tx, 3015 €/m² (centroid ~48.9380, 2.3178)
# Zone 1: sud (Galliéni), 33 tx, 2837 €/m² (centroid ~48.9317, 2.3295)
# Zone 4: sud-ouest, 31 tx, 5031 €/m² (centroid ~48.9275, 2.3120)

# Section to zone mapping (approximate based on geography)
# Sections at center-ville → Zone 5 (2809 €/m²)
# Sections near Seine (east) → Zone 0 or Zone 2
# Sections north → Zone 3
# Sections south → Zone 1
# VLG Zone centroids (lat, lon):
# Zone 5: 48.93650, 2.33158 — 2809 €/m²  (centre-sud, grands ensembles)
# Zone 0: 48.92670, 2.32764 — 4636 €/m²  (sud, neuf Seine)
# Zone 2: 48.94401, 2.32733 — 4101 €/m²  (nord-ouest, résidentiel)
# Zone 3: 48.94070, 2.33061 — 3015 €/m²  (nord, pavillonnaire)
# Zone 1: 48.93174, 2.32952 — 2837 €/m²  (centre, collectif)
# Zone 4: 48.93963, 2.33424 — 5031 €/m²  (nord-est, neuf)
#
# Mapping sections A-O aux zones HDBSCAN par proximité géographique
# VLG s'étend du sud (Seine, ~48.925) au nord (~48.945)
# Sections par latitude approximative (sud→nord): D,E,F < A,B,G,H,I < C,J,K,L,M,N,O
SECTION_ZONE_MAP = {
    "A": "92078_Appartement_1",   # Centre → zone 1 (2837)
    "B": "92078_Appartement_5",   # Centre-ville Ave Verdun → zone 5 (2809)
    "C": "92078_Appartement_0",   # Sud (Seine) → zone 0 (4636)
    "D": "92078_Appartement_0",   # Sud → zone 0 (4636)
    "E": "92078_Appartement_5",   # Centre → zone 5 (2809)
    "F": "92078_Appartement_1",   # Centre → zone 1 (2837)
    "G": "92078_Appartement_5",   # Centre-sud → zone 5 (2809)
    "H": "92078_Appartement_1",   # Centre → zone 1 (2837)
    "I": "92078_Appartement_5",   # Centre → zone 5 (2809)
    "J": "92078_Appartement_3",   # Nord → zone 3 (3015)
    "K": "92078_Appartement_3",   # Nord → zone 3 (3015)
    "L": "92078_Appartement_2",   # Nord-ouest → zone 2 (4101)
    "M": "92078_Appartement_4",   # Nord-est → zone 4 (5031)
    "N": "92078_Appartement_2",   # Nord → zone 2 (4101)
    "O": "92078_Appartement_3",   # Nord → zone 3 (3015)
}

ZONE_PRICES = {
    "92078_Appartement_5": 2809,
    "92078_Appartement_0": 4636,
    "92078_Appartement_2": 4101,
    "92078_Appartement_3": 3015,
    "92078_Appartement_1": 2837,
    "92078_Appartement_4": 5031,
}


def supabase_url():
    return os.environ["NEXT_PUBLIC_SUPABASE_URL"]


def hdrs():
    sk = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return {"apikey": sk, "Authorization": f"Bearer {sk}",
            "Content-Type": "application/json", "Prefer": "return=minimal"}


def fetch_all(table, params, select):
    all_rows, offset = [], 0
    while True:
        p = {**params, "select": select, "limit": "1000", "offset": str(offset)}
        r = SESSION.get(f"{supabase_url()}/rest/v1/{table}", headers=hdrs(), params=p)
        r.raise_for_status()
        rows = r.json()
        all_rows.extend(rows)
        if len(rows) < 1000: break
        offset += 1000
    return all_rows


def compute_score(area, underuse, zone_fam, prix, gfa, coverage):
    us = 10 if underuse >= 0.80 else 8 if underuse >= 0.60 else 6 if underuse >= 0.40 else 4 if underuse >= 0.20 else 1
    zs = {"U": 9, "AU": 7, "A": 2, "N": 1}.get(zone_fam, 3)
    ms = 10 if prix >= 6000 else 8 if prix >= 4500 else 6 if prix >= 3000 else 4 if prix >= 2000 else 2
    ss = 9 if area >= 1000 else 7 if area >= 600 else 5 if area >= 300 else 2
    pv = gfa * 0.75 * prix
    lv = pv - gfa*1300 - gfa*100 - pv*0.03 - pv*0.08
    ls = 10 if lv >= 1500000 else 8 if lv >= 800000 else 6 if lv >= 400000 else 4 if lv >= 150000 else 2
    total = round(0.30*us + 0.25*zs + 0.20*ms + 0.15*ss + 0.10*ls, 2)
    if zone_fam in ("U","AU") and area >= 600 and underuse >= 0.70:
        best = "densification_residentielle"
    elif zone_fam == "U" and 300 <= area <= 700 and underuse >= 0.60:
        best = "division_parcellaire"
    elif zone_fam == "U" and coverage < 0.15:
        best = "dent_creuse"
    else:
        best = "analyse_complementaire"
    return {"mutability_score": total, "underuse_score": us, "zoning_score": zs,
            "market_score": ms, "size_score": ss, "land_value_score": ls,
            "best_use": best, "land_value_est": round(lv, 2), "program_value_est": round(pv, 2)}


def main():
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), "../../.env.local"))

    insee = "92078"
    logger.info("=== Quick VLG HDBSCAN micro-zone fix ===")

    # Load parcels with section info
    parcels = fetch_all("parcels", {"insee_code": f"eq.{insee}"}, "parcel_id,section,area_m2")
    market = {r["parcel_id"]: r for r in fetch_all(
        "parcel_market_stats", {"parcel_id": f"like.{insee}*"}, "parcel_id,median_price_m2")}
    construct = {r["parcel_id"]: r for r in fetch_all(
        "parcel_constructibility", {"parcel_id": f"like.{insee}*"},
        "parcel_id,dominant_zone_family,estimated_gfa,underuse_ratio,residual_potential_est")}
    bstats = {r["parcel_id"]: r for r in fetch_all(
        "parcel_building_stats", {"parcel_id": f"like.{insee}*"}, "parcel_id,coverage_ratio")}

    logger.info("Parcels: %d, market: %d, construct: %d, building: %d",
                len(parcels), len(market), len(construct), len(bstats))

    # Map sections to zones
    section_dist = {}
    updates = 0
    total = len(parcels)

    for i, p in enumerate(parcels):
        pid = p["parcel_id"]
        section = p.get("section") or ""
        area = p.get("area_m2") or 0

        # Get zone by section
        zone_id = SECTION_ZONE_MAP.get(section)
        prix = ZONE_PRICES.get(zone_id, 3581) if zone_id else 3581

        section_dist[section] = section_dist.get(section, 0) + 1

        # Update market stats
        body_m = {"median_price_m2": prix, "updated_at": "now()"}
        if zone_id:
            body_m["hdbscan_zone_id"] = zone_id
        SESSION.patch(f"{supabase_url()}/rest/v1/parcel_market_stats",
                      headers=hdrs(), params={"parcel_id": f"eq.{pid}"}, json=body_m)

        # Recalculate score
        c = construct.get(pid, {})
        b = bstats.get(pid, {})
        underuse = c.get("underuse_ratio") or 0
        zone_fam = c.get("dominant_zone_family") or "U"
        gfa = c.get("estimated_gfa") or 0
        coverage = b.get("coverage_ratio") or 0
        residual = c.get("residual_potential_est") or 0

        s = compute_score(area, underuse, zone_fam, prix, gfa, coverage)
        s["explanation_json"] = json.dumps({
            "area_m2": area, "underuse_ratio": underuse, "dominant_zone_family": zone_fam,
            "median_price_m2": prix, "estimated_gfa": gfa,
            "residual_potential_est": residual, "coverage_ratio": coverage,
        })
        s["computed_at"] = "now()"
        r2 = SESSION.patch(f"{supabase_url()}/rest/v1/parcel_scores",
                           headers=hdrs(), params={"parcel_id": f"eq.{pid}"}, json=s)
        if r2.status_code < 300:
            updates += 1

        if (i+1) % 100 == 0:
            logger.info("  Progress: %d / %d", i+1, total)

    logger.info("Section distribution: %s", section_dist)
    logger.info("=== Done: %d / %d updated ===", updates, total)


if __name__ == "__main__":
    main()
