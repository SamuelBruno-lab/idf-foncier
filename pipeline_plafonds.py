#!/usr/bin/env python3
"""
pipeline_plafonds.py — Import zonage A/B/C + éligibilités ACV/Denormandie
=========================================================================

Populate les tables :
  - dim_zonage_abc                 : zone Abis/A/B1/B2/C par commune
  - dim_commune_eligibilite        : programmes ACV/Denormandie/ORT par commune

Source zonage : arrêté ministériel annuel listé sur data.gouv.fr.
  Dataset cible : https://www.data.gouv.fr/fr/datasets/zonage-abis-a-b-c/
  (CSV exposé directement, mis à jour annuellement)

Sources éligibilités (à enrichir) :
  - ACV : 234 villes ANCT — liste sur ANCT/data.gouv.fr
  - Denormandie : ~700 communes (ACV + ORT) — liste BOI
  - ORT : Opérations de Revitalisation de Territoire — liste ANCT

Pour le MVP, le zonage est traité automatiquement ; les listes ACV/Denormandie
sont laissées vides — l'API renvoie alors `acv: false`, `denormandie: false`.
À enrichir via insertion SQL manuelle ou extension de ce script.

Usage:
    python pipeline_plafonds.py                # zonage uniquement
    python pipeline_plafonds.py --annee 2025
    python pipeline_plafonds.py --dry-run

Pré-requis :
    pip install pandas httpx python-dotenv

Migrations SQL à appliquer avant :
    foncier-idf/sql/18_plafonds_fiscaux.sql
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

import httpx
import pandas as pd
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / "foncier-idf" / ".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").strip().rstrip("/")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
).strip()

# ── Source zonage A/B/C ──────────────────────────────────────────────────
# Le dataset a une API stable, on récupère les ressources CSV via JSON.
DATAGOUV_DATASET_ZONAGE = (
    "https://www.data.gouv.fr/api/1/datasets/zonage-abis-a-b-c/"
)

# Mapping libellés zonage → valeurs canoniques dim_zonage_abc.zone
# Le CSV officiel utilise "ABIS"/"A bis"/"Abis" selon les millésimes, on normalise.
ZONE_NORMALIZATION = {
    "ABIS": "Abis", "A BIS": "Abis", "ABIS ": "Abis", "A_BIS": "Abis",
    "A": "A",
    "B1": "B1",
    "B2": "B2",
    "C": "C",
}


def http_get(url: str, timeout: int = 60) -> httpx.Response:
    resp = httpx.get(url, follow_redirects=True, timeout=timeout)
    resp.raise_for_status()
    return resp


def discover_zonage_csv() -> tuple[str, int] | None:
    """Retourne (csv_url, annee) du fichier zonage A/B/C le plus récent."""
    try:
        payload = http_get(DATAGOUV_DATASET_ZONAGE).json()
    except Exception as e:
        print(f"  ⚠ data.gouv.fr API échouée : {e}")
        return None

    resources = payload.get("resources", [])
    csv_resources = [r for r in resources if r.get("format", "").lower() == "csv"]
    if not csv_resources:
        print("  ⚠ Aucune ressource CSV dans le dataset zonage")
        return None

    # On prend la plus récente (par last_modified)
    csv_resources.sort(key=lambda r: r.get("last_modified", ""), reverse=True)
    best = csv_resources[0]
    url = best.get("url", "")
    # Année déduite du titre ou du contenu si possible
    title = (best.get("title") or "") + " " + (payload.get("title") or "")
    m = re.search(r"(20\d{2})", title)
    annee = int(m.group(1)) if m else datetime.now().year
    print(f"  → CSV zonage : {url}")
    print(f"  → Année déduite : {annee}")
    return url, annee


def parse_zonage_csv(url: str) -> pd.DataFrame:
    """Charge le CSV zonage et retourne un DataFrame [code_insee, zone] normalisé."""
    df = pd.read_csv(url, dtype=str, sep=None, engine="python", low_memory=False)
    print(f"  → {len(df):,} lignes lues, colonnes : {list(df.columns)[:8]}...")

    # Détection souple des colonnes (les noms varient selon millésime)
    code_candidates = ["code_insee", "INSEE_COM", "code_commune", "codgeo", "insee"]
    zone_candidates = ["zone", "zone_abc", "ZONE_ABC", "categorie", "zonage"]

    code_col = _first_match(df.columns, code_candidates)
    zone_col = _first_match(df.columns, zone_candidates)

    if not code_col or not zone_col:
        raise RuntimeError(
            f"Colonnes attendues introuvables (code: {code_col}, zone: {zone_col}). "
            f"Colonnes disponibles : {list(df.columns)}"
        )

    out = pd.DataFrame(
        {
            "code_insee": df[code_col].fillna("").astype(str).str.zfill(5),
            "zone": df[zone_col].fillna("").astype(str).str.strip().str.upper(),
        }
    )
    out["zone"] = out["zone"].map(lambda v: ZONE_NORMALIZATION.get(v, v))
    out = out[out["zone"].isin(["Abis", "A", "B1", "B2", "C"])]
    out = out[out["code_insee"].str.len() == 5]
    out = out.drop_duplicates(subset=["code_insee"])
    print(f"  → {len(out):,} communes normalisées")
    return out


def _first_match(cols, candidates: list[str]) -> str | None:
    norm = {c.lower(): c for c in cols}
    for cand in candidates:
        for key, original in norm.items():
            if cand.lower() == key or cand.lower() in key:
                return original
    return None


def upsert_zonage(df: pd.DataFrame, annee: int, batch_size: int = 500) -> bool:
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    url = f"{SUPABASE_URL}/rest/v1/dim_zonage_abc?on_conflict=code_insee,annee"
    rows = [
        {"code_insee": r.code_insee, "zone": r.zone, "annee": annee}
        for r in df.itertuples()
    ]
    total = len(rows)
    print(f"  Upload {total:,} lignes → dim_zonage_abc...")
    with httpx.Client(timeout=90) as client:
        for i in range(0, total, batch_size):
            batch = rows[i : i + batch_size]
            resp = client.post(url, headers=headers, json=batch)
            if resp.status_code not in (200, 201, 204):
                print(f"\n  ERREUR {resp.status_code}: {resp.text[:300]}")
                return False
            print(f"    {min(i + batch_size, total):,}/{total:,}", end="\r")
            time.sleep(0.05)
    print()
    return True


# ──────────────────────────────────────────────────────────────────────────
# Hook pour enrichir ACV/Denormandie/ORT plus tard
# ──────────────────────────────────────────────────────────────────────────

def import_eligibilites_acv_denormandie(annee: int) -> None:
    """
    PLACEHOLDER : importer la liste des communes ACV, Denormandie et ORT.

    Sources à intégrer :
      - ACV : 234 villes — https://agence-cohesion-territoires.gouv.fr/action-coeur-de-ville
              ou dataset data.gouv.fr (slug à vérifier)
      - ORT : liste ANCT
      - Denormandie : ACV + ORT (selon arrêté BOI)

    Stratégie pour la V2 :
      1. Récupérer la liste CSV ACV (~234 lignes, code_insee + nom)
      2. Idem ORT
      3. Construire la liste Denormandie = union(ACV, ORT)
      4. Upsert dim_commune_eligibilite par batch

    Pour le MVP, on laisse cette table vide — l'API renvoie alors
    eligibilites.acv = false / denormandie = false, ce qui est techniquement
    correct (juste sous-estimé).
    """
    print(f"  → ACV/Denormandie/ORT : non implémenté en MVP (cf. TODO docstring)")


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Import zonage A/B/C + éligibilités")
    parser.add_argument("--annee", type=int, default=None, help="Année à utiliser (sinon auto)")
    parser.add_argument("--dry-run", action="store_true", help="Ne pas uploader")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERREUR : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis")
        sys.exit(1)

    print("=" * 60)
    print("Pipeline plafonds fiscaux — zonage A/B/C + éligibilités")
    print("=" * 60)

    print("\n[1] Découverte du CSV zonage A/B/C")
    discovered = discover_zonage_csv()
    if not discovered:
        print("\n❌ Impossible de récupérer le zonage. Vérifier data.gouv.fr.")
        sys.exit(1)
    csv_url, annee_auto = discovered
    annee = args.annee or annee_auto

    print("\n[2] Téléchargement et parsing")
    df = parse_zonage_csv(csv_url)
    by_zone = df["zone"].value_counts().to_dict()
    for z, n in sorted(by_zone.items()):
        print(f"  Zone {z:>4} : {n:,} communes")

    if args.dry_run:
        print("\n[3] Dry-run — pas d'upload")
        print(df.head(10).to_string(index=False))
        return

    print(f"\n[3] Upload Supabase (annee={annee})")
    ok = upsert_zonage(df, annee)
    if not ok:
        print("\n❌ Échec upload zonage")
        sys.exit(1)

    print("\n[4] Éligibilités ACV/Denormandie/ORT")
    import_eligibilites_acv_denormandie(annee)

    print(f"\n✅ Pipeline plafonds terminé — {len(df):,} communes en zonage {annee}")


if __name__ == "__main__":
    main()
