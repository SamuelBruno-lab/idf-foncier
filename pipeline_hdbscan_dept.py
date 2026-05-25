#!/usr/bin/env python3
"""
pipeline_hdbscan_dept.py — HDBSCAN un département complet → Supabase
======================================================================

Pendant France-wide de pipeline_top30_communes.py : au lieu d'itérer 30
communes IDF prédéfinies, on traite TOUTES les communes d'un département
donné en argument.

Pipeline complet par département :
  1. Download DVF (5-6 ans glissants) pour le département
  2. Load + nettoyage
  3. Ventilation des mutations mixtes (dvf_ventilation.py)
  4. HDBSCAN par (commune × type_local) avec fenêtre adaptative
  5. Upsert dans dvf_hdbscan_zones (ou autre table via --target-table)

Conçu pour être lancé via GitHub Actions matrix strategy (1 job / dept) →
parallélisme massif, ~10 min par dept, ~10-15 min wall time avec 20 jobs
parallèles (limite free tier).

Usage:
    python pipeline_hdbscan_dept.py --dept 60
    python pipeline_hdbscan_dept.py --dept 75 --download
    python pipeline_hdbscan_dept.py --dept 75 --target-table dvf_hdbscan_zones_5y --force-window-years 5
    python pipeline_hdbscan_dept.py --dept 60 --csv-dir /tmp/dvf

Dépendances : mêmes que pipeline_hdbscan_idf.py
    pip install pandas numpy hdbscan scipy httpx python-dotenv
"""

import argparse
import sys
import time
from pathlib import Path

from pipeline_hdbscan_idf import (
    DATA_DIR,
    download_dept,
    load_csv_dept,
    run_hdbscan_all,
    upsert_zones,
    load_env,
    PRIX_M2_MAX,
    PRIX_M2_MIN,
)
from dvf_ventilation import ventilate_dataset


def main():
    parser = argparse.ArgumentParser(
        description="HDBSCAN pour un département complet (France entière, 1 dept par job)"
    )
    parser.add_argument(
        "--dept",
        required=True,
        help="Code département à traiter (ex: 60, 75, 13, 69...)",
    )
    parser.add_argument("--download", action="store_true", help="Télécharger DVF si absent")
    parser.add_argument("--skip-upload", action="store_true", help="Calcul sans upload")
    parser.add_argument("--csv-dir", default=str(DATA_DIR), help="Dossier CSV")
    parser.add_argument(
        "--target-table",
        default="dvf_hdbscan_zones",
        help="Table cible Supabase (dvf_hdbscan_zones ou dvf_hdbscan_zones_5y)",
    )
    parser.add_argument(
        "--force-window-years",
        type=int,
        default=None,
        help="Forcer la fenêtre temporelle (ex: 5 pour précision)",
    )
    parser.add_argument(
        "--skip-ventilation",
        action="store_true",
        help="Désactiver la ventilation des mutations mixtes (rapide mais moins précis)",
    )
    args = parser.parse_args()

    dept = str(args.dept).zfill(2) if args.dept.isdigit() else args.dept
    csv_dir = Path(args.csv_dir)

    # Départements sans données DVF (juridique, pas un bug) :
    # 57 Moselle, 67 Bas-Rhin, 68 Haut-Rhin → Livre Foncier (Grundbuch) hérité
    # du droit allemand au lieu du système notarial français. DVF n'existe pas
    # pour ces 3 départements, toutes sources confondues.
    ALSACE_MOSELLE = {"57", "67", "68"}
    if dept in ALSACE_MOSELLE:
        print(f"⚠ Dept {dept} (Alsace-Moselle) — pas de DVF (Livre Foncier).")
        print(f"  Skip propre (exit 0).")
        return

    print("=" * 70)
    print(f"Pipeline HDBSCAN — Département {dept} (France entière)")
    print("=" * 70)
    print(f"  Table cible : {args.target_table}")
    if args.force_window_years:
        print(f"  Fenêtre forcée : {args.force_window_years} ans")
    print()

    # ── 1. Téléchargement ──────────────────────────────────────────────────
    csv_path = csv_dir / f"dvf_{dept}.csv"
    if args.download:
        print(f"[1] Téléchargement DVF dept {dept}...")
        csv_dir.mkdir(parents=True, exist_ok=True)
        if csv_path.exists() and csv_path.stat().st_size > 1_000_000:
            print(f"  {dept}: déjà présent ({csv_path.stat().st_size // 1_000_000} MB), skip")
        else:
            download_dept(dept, csv_path)
    else:
        print(f"[1] (--download non spécifié) Utilisation CSV local: {csv_path}")

    if not csv_path.exists():
        # Cas où DVF data.gouv.fr n'expose rien pour ce département (DOM-TOM
        # partiels, départements expérimentaux, etc.). On exit proprement
        # avec un avertissement plutôt qu'une erreur — laisser les autres
        # jobs du matrix se finir tranquillement.
        print(f"⚠ Aucun CSV DVF récupéré pour dept {dept} (peut-être pas couvert par data.gouv.fr).")
        print(f"  Skip propre (exit 0).")
        return

    # ── 2. Chargement ──────────────────────────────────────────────────────
    print(f"\n[2] Chargement CSV...")
    try:
        data = load_csv_dept(dept, csv_path)
    except Exception as e:
        print(f"❌ Erreur lecture : {e}")
        sys.exit(1)

    if data.empty:
        print(f"  Aucune transaction valide pour dept {dept}. Skip.")
        return

    print(f"  {len(data):,} transactions chargées | {data['code_commune'].nunique()} communes")

    # ── 3. Ventilation des mutations mixtes ────────────────────────────────
    if not args.skip_ventilation:
        print("\n[3] Ventilation des mutations mixtes...")
        n_before = len(data)
        try:
            data = ventilate_dataset(
                data,
                seuil_m2_max=PRIX_M2_MAX,
                seuil_m2_min={tl: PRIX_M2_MIN for tl in PRIX_M2_MAX},
                min_cluster_size=8,
                min_samples=2,
                min_parcelle_tx=5,
            )
            print(f"  {n_before:,} → {len(data):,} transactions après ventilation")
        except Exception as e:
            print(f"  ⚠ Ventilation échouée (continuation sans) : {e}")
    else:
        print("\n[3] Ventilation SKIPPÉE (--skip-ventilation)")

    # ── 4. HDBSCAN ─────────────────────────────────────────────────────────
    print("\n[4] Calcul HDBSCAN...")
    t0 = time.time()
    all_zones = run_hdbscan_all(data, force_window_years=args.force_window_years)
    elapsed = time.time() - t0
    print(f"\n  {len(all_zones)} zones en {elapsed:.0f}s")

    if not all_zones:
        print(f"  Aucune zone produite pour dept {dept}.")
        return

    # ── 5. Upload Supabase ─────────────────────────────────────────────────
    if args.skip_upload:
        print("\n[5] Upload SKIPPÉ (--skip-upload)")
        return

    print(f"\n[5] Upload → Supabase ({args.target_table})...")
    try:
        supabase_url, supabase_key = load_env()
    except RuntimeError as e:
        print(f"❌ {e}")
        sys.exit(1)

    success = upsert_zones(
        all_zones, supabase_url, supabase_key, table_name=args.target_table
    )

    if success:
        commune_counts: dict = {}
        for z in all_zones:
            c = z["code_commune"]
            commune_counts[c] = commune_counts.get(c, 0) + 1
        print(f"\n✅ Dept {dept} terminé : {len(all_zones)} zones | {len(commune_counts)} communes uniques")
    else:
        print(f"\n❌ Échec upload dept {dept}")
        sys.exit(1)


if __name__ == "__main__":
    main()
