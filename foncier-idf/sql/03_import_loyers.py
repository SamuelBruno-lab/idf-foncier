"""
datamerry — Import loyers OLAP → Supabase (enrichissement dvf_clusters_commune)

Source : Observatoires Locaux des Loyers (OLAP), données 2024
  - L7501 : Paris intra-muros (14 zones × arrondissement)
  - L7502 : Agglomération parisienne hors Paris (6 zones)

Pré-requis :
  1. Avoir exécuté sql/07_loyers_schema.sql dans Supabase SQL Editor
  2. pip install httpx python-dotenv

Usage : python sql/03_import_loyers.py
"""

import csv
import io
import os
import zipfile
import httpx
from dotenv import load_dotenv

load_dotenv(".env.local")

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ["NEXT_PUBLIC_SUPABASE_ANON_KEY"]

SOURCES = [
    {
        "url": "https://dev.observatoires-des-loyers.org/datagouv/2024/Base_OP_2024_L7501.zip",
        "csv": "Base_OP_2024_L7501.csv",
        "zonage": "L7501Zonage2024.csv",
        "label": "Paris intra-muros",
    },
    {
        "url": "https://dev.observatoires-des-loyers.org/datagouv/2024/Base_OP_2024_L7502.zip",
        "csv": "Base_OP_2024_L7502.csv",
        "zonage": "L7502Zonage2024.csv",
        "label": "Agglomération parisienne (hors Paris)",
    },
]


def parse_float(s: str) -> float | None:
    """Parse un nombre français avec virgule décimale."""
    if not s or not s.strip():
        return None
    try:
        return float(s.strip().replace(",", "."))
    except ValueError:
        return None


def download_zip(url: str) -> bytes:
    print(f"  Téléchargement {url.split('/')[-1]}...")
    resp = httpx.get(url, timeout=60, follow_redirects=True)
    resp.raise_for_status()
    return resp.content


def parse_source(zip_bytes: bytes, csv_name: str, zonage_name: str) -> dict[str, float]:
    """
    Retourne un dict {code_insee: loyer_median_m2} pour toutes les communes de la source.
    Stratégie :
      - Couronne (L7502) : zones de zonage = "1".."7" → correspondent aux suffixes OLAP ".01"..".07"
      - Paris (L7501)    : zones de zonage (1, 2, 3) ne correspondent pas aux 14 zones OLAP
                           → on utilise le loyer global de l'agglomération pour tous les arrondissements
    """
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
        # 1. Zonage : code_insee → zone_id locale
        with z.open(zonage_name) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";")
            commune_to_zone: dict[str, str] = {}
            for row in reader:
                commune_to_zone[row["Commune"].zfill(5)] = row["Zone"]

        # 2. Loyers par zone_calcul + loyer global (Zone_calcul vide)
        with z.open(csv_name) as f:
            reader = csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";")
            zone_to_loyer: dict[str, float] = {}
            global_loyer: float | None = None
            for row in reader:
                z_id = row["Zone_calcul"]
                dims = [
                    row["Zone_complementaire"], row["Type_habitat"],
                    row["epoque_construction_homogene"], row["anciennete_locataire_homogene"],
                    row["nombre_pieces_homogene"], row["epoque_construction_local"],
                    row["anciennete_locataire_local"], row["nombre_pieces_local"],
                ]
                if any(dims):
                    continue
                med = parse_float(row["loyer_median"])
                if not med:
                    continue
                if z_id and z_id not in zone_to_loyer:
                    zone_to_loyer[z_id] = med
                elif not z_id and global_loyer is None:
                    global_loyer = med

    # 3. Zone locale (ex: "01") → clé OLAP par suffixe numérique
    def local_to_olap(zone_local: str) -> float | None:
        num = str(int(zone_local))
        padded = zone_local.zfill(2)
        for key, val in zone_to_loyer.items():
            parts = key.split(".")
            if parts[-1] == num or parts[-1] == padded:
                return val
        return None

    # 4. Assemblage : essayer le matching par zone, sinon loyer global
    commune_loyer: dict[str, float] = {}
    for insee, zone_local in commune_to_zone.items():
        loyer = local_to_olap(zone_local)
        if loyer is None:
            loyer = global_loyer  # fallback Paris : loyer agrégé agglomération
        if loyer is not None:
            commune_loyer[insee] = loyer

    return commune_loyer


def fetch_clusters() -> list[dict]:
    """Récupère tous les clusters commune depuis Supabase."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    url = f"{SUPABASE_URL}/rest/v1/dvf_clusters_commune?select=cluster_id,prix_m2_median&limit=10000"
    resp = httpx.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.json()


def update_batch(records: list[dict]):
    """Met à jour loyer_median_m2 et rendement_brut via PATCH individuel par cluster_id."""
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    total = len(records)
    errors = 0

    with httpx.Client(timeout=60) as client:
        for i, rec in enumerate(records):
            cid = rec["cluster_id"]
            payload = {k: v for k, v in rec.items() if k != "cluster_id"}
            url = f"{SUPABASE_URL}/rest/v1/dvf_clusters_commune?cluster_id=eq.{cid}"
            resp = client.patch(url, headers=headers, json=payload)
            if resp.status_code not in (200, 201, 204):
                errors += 1
                if errors <= 3:
                    print(f"\n  ERREUR {resp.status_code} ({cid}): {resp.text[:200]}")
            if (i + 1) % 50 == 0 or (i + 1) == total:
                print(f"  {i + 1}/{total}", end="\r")
    print()
    if errors:
        print(f"  {errors} erreurs sur {total} mises à jour")


def main():
    # 1. Télécharger et parser les deux sources OLAP
    commune_loyer: dict[str, float] = {}
    for src in SOURCES:
        print(f"\n[{src['label']}]")
        zip_bytes = download_zip(src["url"])
        data = parse_source(zip_bytes, src["csv"], src["zonage"])
        print(f"  {len(data)} communes avec loyer médian")
        commune_loyer.update(data)

    print(f"\nTotal : {len(commune_loyer)} communes avec données loyer")

    # 2. Récupérer les clusters existants
    print("\nRécupération des clusters commune...")
    clusters = fetch_clusters()
    print(f"  {len(clusters)} clusters trouvés")

    # 3. Enrichir avec loyer + rendement
    enriched = []
    matched = 0
    for c in clusters:
        cid = c["cluster_id"]  # ex: "75056_Appartement"
        code = cid.split("_")[0].zfill(5)
        loyer = commune_loyer.get(code)
        prix_m2 = c.get("prix_m2_median")

        rendement = None
        if loyer and prix_m2 and prix_m2 > 0:
            rendement = round(loyer * 12 / prix_m2 * 100, 2)

        if loyer:
            matched += 1

        enriched.append({
            "cluster_id": cid,
            "loyer_median_m2": loyer,
            "rendement_brut": rendement,
        })

    print(f"  {matched}/{len(clusters)} clusters avec loyer trouvé")

    # 4. Mise à jour (PATCH par cluster_id, uniquement ceux avec loyer)
    to_update = [r for r in enriched if r["loyer_median_m2"] is not None]
    print(f"\nMise à jour de {len(to_update)} clusters...")
    update_batch(to_update)

    print("\n✅ Import loyers terminé!")


if __name__ == "__main__":
    main()
