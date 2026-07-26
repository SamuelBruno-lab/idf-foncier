"""
Télécharge la BDNB (Base de Données Nationale des Bâtiments) pour un
département donné et extrait les 4 tables clés dont on a besoin pour
la régression DPE.

Usage :
    python download_bdnb.py --dept 94 --out ./bdnb_data

Sortie : 4 fichiers Parquet dans out/{dept}/ :
  - batiment_groupe.parquet
  - batiment_groupe_ffo_bat.parquet
  - batiment_groupe_dvf_open_statistique.parquet
  - dpe_logement.parquet

Source : https://bdnb.io/download/  (millésime 2026-02.a)
Format : Parquet compressé, ~500 MB par département.

Docs BDNB : https://bdnb.io/documentation/methode_traitement_dpe/
"""

import argparse
import io
import os
import sys
import zipfile
from pathlib import Path

import requests
from tqdm import tqdm

# URL pattern BDNB open-data (peut évoluer entre millésimes)
BDNB_MILLESIME = os.getenv("BDNB_MILLESIME", "2026-02.a")
BDNB_URL_PATTERN = os.getenv(
    "BDNB_URL_PATTERN",
    "https://bdnb.io/data/BDNB-open/{millesime}/dept_{dept}.zip",
)

# Les 4 tables nécessaires pour la régression maisons
NEEDED_TABLES = [
    "batiment_groupe",
    "batiment_groupe_ffo_bat",
    "batiment_groupe_dvf_open_statistique",
    "dpe_logement",
]


def download_zip(dept: str, dest_zip: Path) -> None:
    """Télécharge le zip BDNB d'un département avec barre de progression."""
    url = BDNB_URL_PATTERN.format(millesime=BDNB_MILLESIME, dept=dept)
    print(f"→ Téléchargement {url}", flush=True)

    resp = requests.get(url, stream=True, timeout=60)
    if resp.status_code != 200:
        raise RuntimeError(
            f"BDNB dept {dept} : HTTP {resp.status_code}. "
            f"Vérifie l'URL BDNB_URL_PATTERN et le millésime BDNB_MILLESIME.",
        )

    total = int(resp.headers.get("content-length", 0))
    dest_zip.parent.mkdir(parents=True, exist_ok=True)
    with open(dest_zip, "wb") as f:
        with tqdm(total=total, unit="B", unit_scale=True, desc=f"dept {dept}") as bar:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                if chunk:
                    f.write(chunk)
                    bar.update(len(chunk))

    print(f"✓ Zip téléchargé : {dest_zip} ({dest_zip.stat().st_size / 1e6:.0f} MB)", flush=True)


def extract_needed(zip_path: Path, out_dir: Path) -> dict[str, Path]:
    """Extrait uniquement les 4 tables utiles, en Parquet si dispo sinon CSV → Parquet."""
    import pandas as pd

    out_dir.mkdir(parents=True, exist_ok=True)
    extracted: dict[str, Path] = {}

    with zipfile.ZipFile(zip_path, "r") as z:
        names = z.namelist()
        for tbl in NEEDED_TABLES:
            # Chercher .parquet en priorité, fallback .csv
            candidates = [n for n in names if tbl in n and (n.endswith(".parquet") or n.endswith(".csv"))]
            if not candidates:
                print(f"  ⚠ Table {tbl} introuvable dans le zip", flush=True)
                continue

            # Priorité au Parquet
            chosen = next((n for n in candidates if n.endswith(".parquet")), candidates[0])
            print(f"  → Extraction {chosen}", flush=True)

            out_path = out_dir / f"{tbl}.parquet"
            with z.open(chosen) as src:
                if chosen.endswith(".parquet"):
                    with open(out_path, "wb") as f:
                        f.write(src.read())
                else:
                    # CSV → Parquet pour lecture rapide ensuite
                    df = pd.read_csv(src, sep=",", low_memory=False, on_bad_lines="skip")
                    df.to_parquet(out_path, engine="pyarrow", compression="snappy")

            extracted[tbl] = out_path
            print(f"    ✓ {out_path} ({out_path.stat().st_size / 1e6:.1f} MB)", flush=True)

    return extracted


def main() -> None:
    parser = argparse.ArgumentParser(description="Télécharge la BDNB pour un département")
    parser.add_argument("--dept", required=True, help="Code département sur 2 ou 3 chars (ex: 94, 75, 971)")
    parser.add_argument("--out", default="./bdnb_data", help="Dossier de sortie")
    parser.add_argument("--keep-zip", action="store_true", help="Conserver le zip après extraction")
    args = parser.parse_args()

    dept = args.dept.zfill(2) if len(args.dept) == 1 else args.dept
    out_root = Path(args.out).resolve()
    out_dept = out_root / dept
    zip_path = out_root / f"dept_{dept}.zip"

    if all((out_dept / f"{tbl}.parquet").exists() for tbl in NEEDED_TABLES):
        print(f"✓ Toutes les tables déjà présentes dans {out_dept}, skip.", flush=True)
        sys.exit(0)

    download_zip(dept, zip_path)
    extracted = extract_needed(zip_path, out_dept)

    if not args.keep_zip:
        zip_path.unlink()
        print(f"✓ Zip supprimé (utilise --keep-zip pour le garder)", flush=True)

    if len(extracted) < len(NEEDED_TABLES):
        missing = set(NEEDED_TABLES) - set(extracted.keys())
        print(f"⚠ Tables manquantes : {missing}", flush=True)
        sys.exit(1)

    print(f"\n✓ Département {dept} prêt : {out_dept}", flush=True)


if __name__ == "__main__":
    main()
