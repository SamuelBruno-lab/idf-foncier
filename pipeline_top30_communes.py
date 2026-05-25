#!/usr/bin/env python3
"""
pipeline_top30_communes.py — HDBSCAN pour les 30 plus grosses communes IDF
===========================================================================
Wrapper autour de pipeline_hdbscan_idf.py qui cible spécifiquement les 30
plus grosses communes d'Île-de-France.

Usage:
    python pipeline_top30_communes.py                    # traiter les 30 communes
    python pipeline_top30_communes.py --download         # télécharger DVF + traiter
    python pipeline_top30_communes.py --skip-upload      # calcul local uniquement
    python pipeline_top30_communes.py --dry-run          # afficher les communes seulement

Dépendances: mêmes que pipeline_hdbscan_idf.py
    pip install pandas numpy hdbscan scipy httpx python-dotenv
"""

import argparse
import sys
import time
from pathlib import Path

# Réutiliser toutes les fonctions du pipeline principal
from pipeline_hdbscan_idf import (
    DATA_DIR,
    download_dept,
    load_csv_dept,
    run_hdbscan_all,
    upsert_zones,
    load_env,
)

# ── Top 30 communes IDF (code INSEE) ──────────────────────────────────────────
# Correspondance avec src/lib/communes-top30.ts
TOP30 = [
    ("75056", "Paris", "75"),
    ("92012", "Boulogne-Billancourt", "92"),
    ("93066", "Saint-Denis", "93"),
    ("93048", "Montreuil", "93"),
    ("95018", "Argenteuil", "95"),
    ("92050", "Nanterre", "92"),
    ("94028", "Créteil", "94"),
    ("94081", "Vitry-sur-Seine", "94"),
    ("92025", "Colombes", "92"),
    ("92004", "Asnières-sur-Seine", "92"),
    ("78646", "Versailles", "78"),
    ("92026", "Courbevoie", "92"),
    ("93001", "Aubervilliers", "93"),
    ("93005", "Aulnay-sous-Bois", "93"),
    ("92063", "Rueil-Malmaison", "92"),
    ("94017", "Champigny-sur-Marne", "94"),
    ("77284", "Meaux", "77"),
    ("93029", "Drancy", "93"),
    ("92040", "Issy-les-Moulineaux", "92"),
    ("93051", "Noisy-le-Grand", "93"),
    ("92044", "Levallois-Perret", "92"),
    ("94041", "Ivry-sur-Seine", "94"),
    ("95127", "Cergy", "95"),
    ("78586", "Sartrouville", "78"),
    ("92002", "Antony", "92"),
    ("93031", "Épinay-sur-Seine", "93"),
    ("93010", "Bondy", "93"),
    ("92023", "Clamart", "92"),
    ("94033", "Fontenay-sous-Bois", "94"),
    ("93071", "Sevran", "93"),
]

# Départements nécessaires (dédupliqués)
DEPTS_NEEDED = sorted(set(d for _, _, d in TOP30))


def main():
    parser = argparse.ArgumentParser(description="HDBSCAN Top 30 communes IDF")
    parser.add_argument("--download", action="store_true", help="Télécharger depts manquants")
    parser.add_argument("--skip-upload", action="store_true", help="Calcul sans upload")
    parser.add_argument("--dry-run", action="store_true", help="Afficher les communes cibles")
    parser.add_argument("--csv-dir", default=str(DATA_DIR), help="Dossier CSV")
    parser.add_argument(
        "--target-table",
        default="dvf_hdbscan_zones",
        help="Table cible Supabase (par défaut dvf_hdbscan_zones, utiliser dvf_hdbscan_zones_5y pour le mode précision)",
    )
    parser.add_argument(
        "--force-window-years",
        type=int,
        default=None,
        help="Forcer la fenêtre temporelle (override adaptive). Ex: 5 pour les micro-marchés précis.",
    )
    args = parser.parse_args()

    csv_dir = Path(args.csv_dir)

    print("=" * 60)
    print("Pipeline HDBSCAN — Top 30 communes IDF")
    print("=" * 60)
    print(f"\nCommunes cibles: {len(TOP30)}")
    print(f"Départements nécessaires: {', '.join(DEPTS_NEEDED)}")

    if args.dry_run:
        print(f"\n{'Code':<8} {'Commune':<30} {'Dept'}")
        print("-" * 50)
        for code, nom, dept in TOP30:
            print(f"{code:<8} {nom:<30} {dept}")
        return

    # ── 1. Téléchargement ─────────────────────────────────────────────────
    if args.download:
        print("\n[1] Téléchargement des depts nécessaires...")
        for dept in DEPTS_NEEDED:
            dest = csv_dir / f"dvf_{dept}.csv"
            if dest.exists() and dest.stat().st_size > 1_000_000:
                print(f"  {dept}: déjà présent ({dest.stat().st_size // 1_000_000} MB)")
                continue
            print(f"  {dept}: téléchargement...")
            download_dept(dept, dest)
    else:
        print("\n[1] (--download non spécifié, utilisation des CSV locaux)")

    # ── 2. Chargement ─────────────────────────────────────────────────────
    print("\n[2] Chargement des fichiers CSV...")
    import pandas as pd

    all_frames = []
    for dept in DEPTS_NEEDED:
        csv_path = csv_dir / f"dvf_{dept}.csv"
        if not csv_path.exists():
            print(f"  dept {dept}: MANQUANT → relancer avec --download")
            continue
        df = load_csv_dept(dept, csv_path)
        all_frames.append(df)

    if not all_frames:
        print("Aucune donnée. Relancer avec --download.")
        sys.exit(1)

    data = pd.concat(all_frames, ignore_index=True)
    print(f"\n  Total: {len(data):,} transactions")

    # ── 3. Filtrer sur les 30 communes uniquement ─────────────────────────
    commune_codes = set(code for code, _, _ in TOP30)
    data = data[data["code_commune"].astype(str).isin(commune_codes)]
    print(f"  Filtré Top 30: {len(data):,} transactions | {data['code_commune'].nunique()} communes")

    # ── 4. HDBSCAN ───────────────────────────────────────────────────────
    print("\n[3] Calcul HDBSCAN...")
    if args.force_window_years:
        print(f"  ⚙ Mode fenêtre forcée à {args.force_window_years} ans (override adaptive)")
    print(f"  ⚙ Table cible Supabase: {args.target_table}")
    t0 = time.time()
    all_zones = run_hdbscan_all(data, force_window_years=args.force_window_years)
    elapsed = time.time() - t0
    print(f"\n  {len(all_zones)} zones en {elapsed:.0f}s")

    if not all_zones:
        print("Aucune zone produite.")
        sys.exit(0)

    # Stats par commune
    commune_counts = {}
    for z in all_zones:
        c = z["code_commune"]
        commune_counts[c] = commune_counts.get(c, 0) + 1

    print(f"\n  Communes avec zones: {len(commune_counts)}")
    for code, nom, dept in TOP30:
        n = commune_counts.get(code, 0)
        status = f"{n} zones" if n > 0 else "aucune zone"
        print(f"    {code} {nom:<30} {status}")

    # ── 5. Upload ─────────────────────────────────────────────────────────
    if args.skip_upload:
        import json
        out = csv_dir / "hdbscan_top30.json"
        def np_clean(obj):
            if hasattr(obj, "item"):
                return obj.item()
            raise TypeError
        with open(out, "w") as f:
            json.dump(all_zones, f, ensure_ascii=False, indent=2, default=np_clean)
        print(f"\n  Sauvegardé: {out}")
        return

    print("\n[4] Upload vers Supabase...")
    try:
        supabase_url, supabase_key = load_env()
    except RuntimeError as e:
        print(f"  ERREUR: {e}")
        sys.exit(1)

    success = upsert_zones(all_zones, supabase_url, supabase_key, table_name=args.target_table)

    if success:
        print(f"\n✅ {len(all_zones)} zones HDBSCAN pour {len(commune_counts)} communes")
    else:
        print("\n❌ Erreur upload")
        sys.exit(1)


if __name__ == "__main__":
    main()
