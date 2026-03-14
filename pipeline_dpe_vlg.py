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

    # 3. Generate separate maps: Habitation + Tertiaire
    data_hab = data[data["source"] != "tertiaire"].copy()
    data_ter = data[data["source"] == "tertiaire"].copy()

    if len(data_hab) > 0:
        print(f"\n[3/4] Génération carte DPE Habitation ({len(data_hab):,} DPE)...")
        min_cs_h = 15 if len(data_hab) > 2000 else 8
        data_hab = run_hdbscan(data_hab, min_cluster_size=min_cs_h)
        data_hab["dvf_zone"] = -1
        out_hab = os.path.join(out_dir, "carte_dpe_habitation.html")
        make_dpe_map(data_hab, cfg, out_hab,
                     map_label=f"DPE Habitation \u00B7 {cfg['nom']}",
                     map_subtitle="Logements existants + neufs \u00B7 ADEME")

    if len(data_ter) > 0:
        print(f"\n[4/4] Génération carte DPE Tertiaire ({len(data_ter):,} DPE)...")
        min_cs_t = 15 if len(data_ter) > 2000 else 8
        data_ter = run_hdbscan(data_ter, min_cluster_size=min_cs_t)
        data_ter["dvf_zone"] = -1
        out_ter = os.path.join(out_dir, "carte_dpe_tertiaire.html")
        make_dpe_map(data_ter, cfg, out_ter,
                     map_label=f"DPE Tertiaire \u00B7 {cfg['nom']}",
                     map_subtitle="B\u00E2timents tertiaires \u00B7 ADEME")

    n_hab = len(data_hab) if len(data_hab) > 0 else 0
    n_ter = len(data_ter) if len(data_ter) > 0 else 0
    print(f"\n✅ Pipeline DPE VLG terminé")
    print(f"   {n_hab:,} DPE habitation · {n_ter:,} DPE tertiaire · {out_dir}")


if __name__ == "__main__":
    main()
