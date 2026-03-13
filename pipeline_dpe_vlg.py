#!/usr/bin/env python3
"""
Pipeline DPE — Carte DPE pour Villeneuve-la-Garenne (commune-level)
Récupère TOUS les DPE de la commune via l'API ADEME (3 sources)
Génère carte_dpe.html avec filtres interactifs, légende, dashboard dynamique

Source : API ADEME (data.ademe.fr)
Usage : python pipeline_dpe_vlg.py
"""
import os, sys, time, json
import pandas as pd
import numpy as np
import requests
from urllib.parse import urlparse, parse_qs

# Import shared functions from pipeline_dpe
from pipeline_dpe import (
    DPE_COLORS, DPE_LABELS, DATASETS, PAGE_SIZE,
    records_to_dataframe, run_hdbscan, apply_jitter,
    cluster_dpe_distribution, dominant_dpe, make_dpe_map,
)

# ── VLG Config ────────────────────────────────────────────────────────────
COMMUNE_NAME = "Villeneuve-la-Garenne"
VLG_CONFIG = {
    "nom": "Villeneuve-la-Garenne",
    "code": "VLG",
    "color": "#00d4ff",
    "zoom": 15,
}


def fetch_dpe_commune(dataset_key, commune_name):
    """Fetch ALL DPE for a specific commune from ADEME API."""
    ds = DATASETS[dataset_key]
    api_url = f"https://data.ademe.fr/data-fair/api/v1/datasets/{ds['id']}/lines"
    max_records = 100000  # fetch all (communes have < 10K typically)
    print(f"  [{dataset_key}] Fetching all DPE for {commune_name}...")

    records = []
    after = None
    while len(records) < max_records:
        params = {
            "size": PAGE_SIZE,
            "select": ds["fields"],
            "qs": f'nom_commune_ban:"{commune_name}"',
            "sort": ds["sort"],
        }
        if after:
            params["after"] = after
        ok = False
        for attempt in range(4):
            try:
                resp = requests.get(api_url, params=params, timeout=30)
                resp.raise_for_status()
                ok = True
                break
            except Exception as e:
                wait = 2 ** (attempt + 1)
                print(f"    Retry {attempt+1}/4 after {wait}s: {e}")
                time.sleep(wait)
        if not ok:
            print(f"    Failed after 4 retries, stopping at {len(records)}")
            break
        data = resp.json()
        results = data.get("results", [])
        if not results:
            break
        records.extend(results)
        next_url = data.get("next")
        if not next_url:
            break
        parsed = parse_qs(urlparse(next_url).query)
        after = parsed.get("after", [None])[0]
        if not after:
            break
        if len(records) % 2000 == 0:
            print(f"    {len(records)} records...", end="\r")

    print(f"  [{dataset_key}] {len(records)} DPE fetched for {commune_name}")
    return records, dataset_key


def main():
    cfg = VLG_CONFIG
    out_dir = "/home/user/maps_vlg"
    os.makedirs(out_dir, exist_ok=True)
    print(f"\n{'='*60}")
    print(f"  Pipeline DPE : {cfg['nom']} (commune)")
    print(f"  Sortie   : {out_dir}")
    print(f"{'='*60}")

    # 1. Fetch from all 3 sources — commune-level query
    print(f"\n[1/3] Téléchargement DPE depuis ADEME pour {COMMUNE_NAME}...")
    all_frames = []
    for ds_key in ["existant", "neuf", "tertiaire"]:
        try:
            records, key = fetch_dpe_commune(ds_key, COMMUNE_NAME)
            if records:
                df = records_to_dataframe(records, key)
                if len(df) > 0:
                    all_frames.append(df)
                    print(f"    {ds_key}: {len(df)} DPE valides")
        except Exception as e:
            print(f"    {ds_key}: erreur — {e}")

    if not all_frames:
        print("Aucune donnée DPE récupérée.")
        sys.exit(1)

    data = pd.concat(all_frames, ignore_index=True)
    print(f"  Total : {len(data)} DPE ({', '.join(f'{k}: {v}' for k, v in data['source'].value_counts().items())})")

    # 2. Cluster — smaller min_cluster_size for commune-level
    print("\n[2/3] Clustering HDBSCAN...")
    min_cs = 15 if len(data) > 2000 else 8
    data = run_hdbscan(data, min_cluster_size=min_cs)

    # 3. Generate map
    print("\n[3/3] Génération de la carte DPE...")
    out_path = os.path.join(out_dir, "carte_dpe.html")
    make_dpe_map(data, cfg, out_path)

    print(f"\n✅ Pipeline DPE VLG terminé")
    print(f"   {len(data):,} DPE · {out_path}")


if __name__ == "__main__":
    main()
