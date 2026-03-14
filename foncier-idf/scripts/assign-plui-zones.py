#!/usr/bin/env python3
"""
Assign real PLUi BNS zones to VLG parcels via spatial join (point-in-polygon).
Outputs parcel_id → zone mapping as JSON for use by the ICH pipeline.
"""

import json, re, os, subprocess, sys
from pathlib import Path
from pyproj import Transformer

# ─── Config ──────────────────────────────────────────────────────
ROOT = Path(__file__).resolve().parent.parent
env = {}
for line in (ROOT / ".env.local").read_text().splitlines():
    m = re.match(r"^([^#=]+)=(.*)$", line)
    if m:
        env[m.group(1).strip()] = m.group(2).strip()

SUPABASE_URL = env["NEXT_PUBLIC_SUPABASE_URL"]
SERVICE_KEY = env["SUPABASE_SERVICE_ROLE_KEY"]

transformer = Transformer.from_crs("EPSG:2154", "EPSG:4326", always_xy=True)

# ─── Supabase REST helper ────────────────────────────────────────
def supa_get(table, params=""):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{params}"
    out = subprocess.check_output(
        ["curl", "-s", url, "-H", f"apikey: {SERVICE_KEY}", "-H", f"Authorization: Bearer {SERVICE_KEY}"],
        timeout=60
    )
    return json.loads(out)

# ─── PLUi density rules (Article 4.1) ────────────────────────────
DENSITY = {
    "a": {"ces": 1.00, "green": 0.00},
    "b": {"ces": 0.80, "green": 0.10},
    "c": {"ces": 0.70, "green": 0.20},
    "d": {"ces": 0.60, "green": 0.20},
    "e": {"ces": 0.60, "green": 0.30},
    "f": {"ces": 0.60, "green": 0.30},
    "g": {"ces": 0.50, "green": 0.30},
    "h": {"ces": 0.40, "green": 0.40},
    "i": {"ces": 0.40, "green": 0.50},
    "x": {"ces": 0.60, "green": 0.10},
    "z": {"ces": 0.10, "green": 0.70},
}

# PLUi height rules (Article 5.2): index → max height in meters
HEIGHT = {0: 4, 1: 7, 2: 10, 3: 13, 4: 16, 5: 19, 6: 22, 7: 25, 8: 28, 9: 31,
           10: 34, 11: 37, 12: 40, 17: 55, 18: 58, 20: 64}

# Destination vocation mapping
VOCATION = {"M": "mixte", "R": "residentiel", "A": "activite", "E": "equipement", "P": "projet"}

# ─── Parse zone libelle ──────────────────────────────────────────
def parse_zone(lib):
    if lib in ("A", "Ap"):
        return {"dest": "A", "forme": 0, "dens": None, "haut": 0, "vocation": "agricole", "plan_masse": False}
    if lib in ("N", "Ne", "Np"):
        return {"dest": "N", "forme": 0, "dens": None, "haut": 0, "vocation": "naturel", "plan_masse": False}
    if lib.startswith("UP"):
        return {"dest": "P", "forme": 0, "dens": None, "haut": 0, "vocation": "projet", "plan_masse": True}
    m = re.match(r"^U([MRAE][a-z]?)0", lib)
    if m:
        d = m.group(1)[0]
        return {"dest": d, "forme": 0, "dens": None, "haut": 0, "vocation": VOCATION.get(d, "mixte"), "plan_masse": True}
    m = re.match(r"^U([MRAE][a-z]?L?)(\d)([a-zA-Z])(\d+)$", lib)
    if m:
        d = m.group(1)[0]
        return {
            "dest": d,
            "forme": int(m.group(2)),
            "dens": m.group(3).lower(),
            "haut": int(m.group(4)),
            "vocation": VOCATION.get(d, "mixte"),
            "plan_masse": False,
        }
    return None

# ─── Point-in-polygon (ray casting) ─────────────────────────────
def point_in_ring(px, py, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside

def point_in_multipolygon(px, py, coords):
    for polygon in coords:
        if point_in_ring(px, py, polygon[0]):
            return True
    return False

# ─── Main ────────────────────────────────────────────────────────
def main():
    insee = sys.argv[1] if len(sys.argv) > 1 else "92078"
    print(f"=== Assign PLUi zones — {insee} ===")

    # 1. Load PLUi zones
    zones_file = ROOT.parent / "data" / "vlg_plu_zones.json"
    zones = json.loads(zones_file.read_text())
    print(f"[1/3] {len(zones)} PLUi zones loaded")

    # Parse each zone
    for z in zones:
        z["parsed"] = parse_zone(z["libelle"])

    # 2. Fetch parcel centroids
    print("[2/3] Fetching parcel geometries...")
    all_parcels = []
    offset = 0
    PAGE = 200
    while True:
        data = supa_get("parcels", f"select=parcel_id,area_m2,geom&insee_code=eq.{insee}&offset={offset}&limit={PAGE}")
        if not isinstance(data, list) or len(data) == 0:
            break
        all_parcels.extend(data)
        if len(data) < PAGE:
            break
        offset += PAGE
    print(f"  → {len(all_parcels)} parcels")

    # 3. Compute centroids and assign zones
    print("[3/3] Assigning zones via point-in-polygon...")
    results = {}
    no_zone = 0

    for p in all_parcels:
        geom = p.get("geom", {})
        coords = geom.get("coordinates", [])
        if not coords:
            no_zone += 1
            continue

        # Compute centroid from first polygon outer ring
        ring = coords[0][0] if coords else []
        if not ring:
            no_zone += 1
            continue

        cx = sum(pt[0] for pt in ring) / len(ring)
        cy = sum(pt[1] for pt in ring) / len(ring)

        # Convert Lambert 93 → WGS84
        lon, lat = transformer.transform(cx, cy)

        # Find matching zone
        matched = None
        for z in zones:
            zgeom = z.get("geometry", {})
            zcoords = zgeom.get("coordinates", [])
            gtype = zgeom.get("type", "")
            if gtype == "Polygon":
                zcoords = [zcoords]  # wrap as MultiPolygon
            if point_in_multipolygon(lon, lat, zcoords):
                matched = z
                break

        if matched and matched.get("parsed"):
            pp = matched["parsed"]
            dens = DENSITY.get(pp["dens"], DENSITY["c"])
            h = HEIGHT.get(pp["haut"], 13)
            results[p["parcel_id"]] = {
                "plu_zone_code": matched["libelle"],
                "zone_vocation": pp["vocation"],
                "destination": pp["dest"],
                "forme": pp["forme"],
                "densite_idx": pp["dens"],
                "hauteur_idx": pp["haut"],
                "ces": dens["ces"],
                "green_ratio": dens["green"],
                "max_height_m": h,
                "is_plan_masse": pp["plan_masse"],
            }
        else:
            no_zone += 1

    print(f"  → {len(results)} parcels with PLUi zone, {no_zone} without")

    # Stats
    from collections import Counter
    dest_counts = Counter(r["destination"] for r in results.values())
    print(f"  Destinations: {dict(dest_counts.most_common())}")
    voc_counts = Counter(r["zone_vocation"] for r in results.values())
    print(f"  Vocations: {dict(voc_counts.most_common())}")

    # Save
    out_file = ROOT.parent / "data" / "vlg_parcel_plui_zones.json"
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\n  Saved to {out_file}")

if __name__ == "__main__":
    main()
