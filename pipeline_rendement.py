#!/usr/bin/env python3
"""
pipeline_rendement.py — Calcul du rendement locatif France entière
====================================================================

Croise deux sources de loyers + DVF pour produire fact_rendement :
  1. OLAP par agglomération (data.gouv.fr) — ~37 agglos, loyers RÉELS,
     haute qualité. Découverte automatique via l'API data.gouv.fr.
  2. Carte des loyers ANIL — toutes communes France, loyers d'ANNONCE
     (asking prices, ~5-10% au-dessus du marché réel).

Le résultat alimente la table fact_rendement (cf. sql/17_fact_rendement.sql).
L'API /api/rendement lit cette table.

Usage:
    python pipeline_rendement.py                  # import complet
    python pipeline_rendement.py --skip-olap      # ANIL seulement
    python pipeline_rendement.py --skip-anil      # OLAP seulement
    python pipeline_rendement.py --dry-run        # ne pas uploader
    python pipeline_rendement.py --limit-agglos 5 # tester sur 5 agglos OLAP

Pré-requis :
    pip install pandas numpy httpx python-dotenv

Migrations SQL à appliquer avant :
    foncier-idf/sql/17_fact_rendement.sql
"""

from __future__ import annotations

import argparse
import csv
import io
import os
import re
import sys
import time
import zipfile
from pathlib import Path
from typing import Iterable

import httpx
import pandas as pd
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / "foncier-idf" / ".env.local")

SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = (
    os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
)

# ── Découverte OLAP via API data.gouv.fr ──────────────────────────────────
DATAGOUV_DATASET_OLAP = (
    "https://www.data.gouv.fr/api/1/datasets/"
    "resultats-des-observatoires-locaux-des-loyers-par-agglomeration/"
)

# Pattern URL d'un ZIP OLAP : .../2024/Base_OP_2024_L7501.zip
_OLAP_URL_RE = re.compile(
    r"datagouv/(\d{4})/Base_OP_\d{4}_(L\d+)\.zip", re.IGNORECASE
)


# ── Carte des loyers ANIL ─────────────────────────────────────────────────
DATAGOUV_DATASET_ANIL = (
    "https://www.data.gouv.fr/api/1/datasets/"
    "carte-des-loyers-indicateurs-de-loyers-dannonce-par-commune-en-2025/"
)

# Catégories ANIL → bucket fact_rendement
# (cf. doc dataset : "tous appartements 52m²", "T1-T2 37m²", "T3+ 72m²", "maisons 92m²")
ANIL_CATEGORIES = {
    "appartements": ("Appartement", "all"),
    "t1_t2": ("Appartement", "T1-T2"),
    "t3plus": ("Appartement", "T3+"),
    "maisons": ("Maison", "all"),
}


# ── Hypothèses rendement net (défaut, alignées sur dim_rendement_hypotheses)
DEFAULT_HYPOTHESES = {
    "vacance_pct": 5.0,
    "charges_pct": 15.0,
    "taxe_fonciere_pct": 8.0,
}


def http_get(url: str, timeout: int = 30) -> httpx.Response:
    resp = httpx.get(url, follow_redirects=True, timeout=timeout)
    resp.raise_for_status()
    return resp


# ──────────────────────────────────────────────────────────────────────────
# Source 1 : OLAP par agglomération
# ──────────────────────────────────────────────────────────────────────────

def discover_olap_agglos(limit: int | None = None) -> list[dict]:
    """
    Liste les ZIP OLAP les plus récents par agglomération via l'API data.gouv.fr.
    Retourne [{"olap_code": "L7501", "annee": 2024, "url": "...", "csv": "..."}, ...]
    """
    print(f"  → Découverte agglos OLAP via {DATAGOUV_DATASET_OLAP}")
    resp = http_get(DATAGOUV_DATASET_OLAP)
    payload = resp.json()
    resources = payload.get("resources", [])

    # Garde la version la plus récente par olap_code
    latest: dict[str, dict] = {}
    for r in resources:
        url = r.get("url", "")
        m = _OLAP_URL_RE.search(url)
        if not m:
            continue
        annee = int(m.group(1))
        code = m.group(2).upper()
        if code not in latest or annee > latest[code]["annee"]:
            latest[code] = {
                "olap_code": code,
                "annee": annee,
                "url": url,
                "csv": f"Base_OP_{annee}_{code}.csv",
                "zonage": f"{code}Zonage{annee}.csv",
            }

    agglos = sorted(latest.values(), key=lambda x: x["olap_code"])
    print(f"    {len(agglos)} agglos OLAP découvertes")
    if limit:
        agglos = agglos[:limit]
        print(f"    (limité à {limit} pour le test)")
    return agglos


def parse_olap_zip(agglo: dict) -> dict[str, dict[str, float]]:
    """
    Pour une agglomération OLAP donnée, retourne :
      {code_insee: {(type_local, nb_pieces_bucket): loyer_m2_median}, ...}

    Stratégie reprise de sql/03_import_loyers.py :
      - Le fichier zonage map commune → zone_locale ("1", "2", ...)
      - Le fichier loyers a des lignes Zone_calcul ("XX.YY"), on prend
        celles sans autres dimensions = stats globales par zone
      - Pour Paris (L7501), les zones ne correspondent pas → loyer global agglo
    """
    try:
        zip_bytes = http_get(agglo["url"], timeout=60).content
    except Exception as e:
        print(f"    ⚠ Échec téléchargement {agglo['olap_code']}: {e}")
        return {}

    out: dict[str, dict[tuple[str, str], float]] = {}

    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            names = z.namelist()
            csv_name = next((n for n in names if n.endswith(agglo["csv"])), None)
            zonage_name = next((n for n in names if n.endswith(agglo["zonage"])), None)
            if not csv_name or not zonage_name:
                print(f"    ⚠ {agglo['olap_code']}: fichiers attendus absents du ZIP")
                return {}

            # 1. Zonage commune → zone_locale
            commune_to_zone: dict[str, str] = {}
            with z.open(zonage_name) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";")
                for row in reader:
                    code = row.get("Commune", "").zfill(5)
                    zone = row.get("Zone", "").strip()
                    if code and zone:
                        commune_to_zone[code] = zone

            # 2. Loyers par zone_calcul × type × pièces (sans autres dimensions)
            zone_to_loyer: dict[str, dict[tuple[str, str], list[float]]] = {}
            global_loyer: dict[tuple[str, str], list[float]] = {}
            with z.open(csv_name) as f:
                reader = csv.DictReader(io.TextIOWrapper(f, encoding="latin-1"), delimiter=";")
                for row in reader:
                    type_hab = (row.get("Type_habitat") or "").strip()
                    type_local = "Maison" if "maison" in type_hab.lower() else "Appartement" if type_hab else ""
                    nb_pieces = (row.get("nombre_pieces_homogene") or "").strip()
                    # On garde uniquement les agrégats (1 dimension active à la fois)
                    other_dims = [
                        row.get("Zone_complementaire"),
                        row.get("epoque_construction_homogene"),
                        row.get("anciennete_locataire_homogene"),
                        row.get("epoque_construction_local"),
                        row.get("anciennete_locataire_local"),
                        row.get("nombre_pieces_local"),
                    ]
                    if any((v or "").strip() for v in other_dims):
                        continue
                    bucket = _bucket_from_pieces_label(nb_pieces)
                    if not type_local and bucket == "all":
                        # Loyer global, on le note quand même comme Appart 'all' pour fallback
                        type_local = "Appartement"
                    if not type_local:
                        continue
                    key = (type_local, bucket)
                    med = _parse_float_fr(row.get("loyer_median"))
                    if not med:
                        continue
                    z_id = (row.get("Zone_calcul") or "").strip()
                    if z_id:
                        zone_to_loyer.setdefault(z_id, {}).setdefault(key, []).append(med)
                    else:
                        global_loyer.setdefault(key, []).append(med)

        # 3. Assemblage : commune → zone_locale → loyers OLAP
        def zone_lookup(zone_local: str) -> dict[tuple[str, str], list[float]] | None:
            try:
                num = str(int(zone_local))
            except ValueError:
                return None
            padded = zone_local.zfill(2)
            for k, v in zone_to_loyer.items():
                parts = k.split(".")
                if parts and parts[-1] in (num, padded):
                    return v
            return None

        for code, zone_local in commune_to_zone.items():
            zone_loyers = zone_lookup(zone_local) or global_loyer
            if not zone_loyers:
                continue
            commune_out: dict[tuple[str, str], float] = {}
            for key, vals in zone_loyers.items():
                if vals:
                    commune_out[key] = sum(vals) / len(vals)
            if commune_out:
                out[code] = commune_out

    except Exception as e:
        print(f"    ⚠ {agglo['olap_code']}: parse error: {e}")
        return {}

    return out


def _bucket_from_pieces_label(label: str) -> str:
    """Mappe le label OLAP des nombres de pièces vers le bucket fact_rendement."""
    if not label:
        return "all"
    lab = label.lower()
    if "1" in lab or "2" in lab:
        return "T1-T2"
    if "3" in lab or "4" in lab or "5" in lab or "+" in lab:
        return "T3+"
    return "all"


def _parse_float_fr(s: str | None) -> float | None:
    if not s:
        return None
    try:
        return float(str(s).strip().replace(",", "."))
    except ValueError:
        return None


# ──────────────────────────────────────────────────────────────────────────
# Source 2 : Carte des loyers ANIL (France entière, fallback)
# ──────────────────────────────────────────────────────────────────────────

def discover_anil_csv_urls() -> list[str]:
    """Récupère les URLs CSV de la dernière Carte des loyers ANIL."""
    print(f"  → Découverte CSV ANIL via {DATAGOUV_DATASET_ANIL}")
    try:
        payload = http_get(DATAGOUV_DATASET_ANIL).json()
    except Exception as e:
        print(f"    ⚠ Échec discover ANIL : {e}")
        return []
    urls = [
        r["url"] for r in payload.get("resources", [])
        if r.get("url", "").lower().endswith(".csv")
    ]
    print(f"    {len(urls)} CSV ANIL trouvés")
    return urls


def parse_anil_csv(url: str) -> dict[str, dict[tuple[str, str], float]]:
    """
    Parse un CSV Carte des loyers. Le format ANIL :
      code_insee_commune, libelle, loyer_m2_predit, R2, IC_inf, IC_sup, ...
    Le type/bucket est déduit du nom du fichier (ex: "loyers_t1_t2_2025.csv").

    Retourne : {code_insee: {(type_local, bucket): loyer_m2}, ...}
    """
    fname = url.rsplit("/", 1)[-1].lower()
    if "maison" in fname:
        bucket_key: tuple[str, str] = ("Maison", "all")
    elif "t1" in fname or "t2" in fname:
        bucket_key = ("Appartement", "T1-T2")
    elif "t3" in fname:
        bucket_key = ("Appartement", "T3+")
    elif "appart" in fname:
        bucket_key = ("Appartement", "all")
    else:
        print(f"    ⚠ ANIL : type de catégorie inconnu ({fname}), skip")
        return {}

    print(f"    Téléchargement {fname} → {bucket_key}")
    try:
        df = pd.read_csv(url, dtype=str, sep=None, engine="python", low_memory=False)
    except Exception as e:
        print(f"    ⚠ Échec parse {fname}: {e}")
        return {}

    # Heuristique colonne code_insee (selon les millésimes le nom varie)
    code_col = _first_match(df.columns, ["code_insee", "INSEE_COM", "code_commune", "insee", "codgeo"])
    loyer_col = _first_match(df.columns, ["loyer", "loyer_pred", "loy_pred", "loyer_m2", "loyer_med"])
    if not code_col or not loyer_col:
        print(f"    ⚠ ANIL {fname}: colonnes attendues introuvables (cols={list(df.columns)[:10]}...)")
        return {}

    out: dict[str, dict[tuple[str, str], float]] = {}
    for code, val in zip(df[code_col].fillna(""), df[loyer_col].fillna("")):
        code = str(code).strip().zfill(5)
        loy = _parse_float_fr(val)
        if not code or not loy:
            continue
        out.setdefault(code, {})[bucket_key] = loy
    print(f"      → {len(out):,} communes")
    return out


def _first_match(cols: Iterable[str], candidates: list[str]) -> str | None:
    norm = {c.lower(): c for c in cols}
    for cand in candidates:
        for key, original in norm.items():
            if cand.lower() in key:
                return original
    return None


# ──────────────────────────────────────────────────────────────────────────
# Cross-join avec DVF (clusters HDBSCAN) + calcul rendement
# ──────────────────────────────────────────────────────────────────────────

def fetch_dvf_clusters() -> list[dict]:
    """Récupère tous les clusters HDBSCAN (prix_m2_median + fenêtre adaptative)."""
    headers = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}"}
    url = (
        f"{SUPABASE_URL}/rest/v1/dvf_hdbscan_zones"
        "?select=id,code_commune,type_local,count,prix_m2_median,window_annee_min,window_annee_max"
        "&limit=50000"
    )
    resp = httpx.get(url, headers=headers, timeout=60)
    if resp.status_code != 200:
        print(f"    ⚠ DVF clusters fetch HTTP {resp.status_code}: {resp.text[:200]}")
        return []
    rows = resp.json()
    print(f"    {len(rows):,} clusters DVF récupérés")
    return rows


def compute_rendement(prix_m2: float, loyer_m2: float) -> tuple[float, float]:
    """Retourne (brut_pct, net_est_pct) à partir des valeurs €/m² et €/m²/mois."""
    if not prix_m2 or prix_m2 <= 0 or not loyer_m2:
        return 0.0, 0.0
    brut = loyer_m2 * 12 / prix_m2 * 100
    h = DEFAULT_HYPOTHESES
    net = brut * (1 - (h["vacance_pct"] + h["charges_pct"] + h["taxe_fonciere_pct"]) / 100)
    return round(brut, 2), round(net, 2)


def build_fact_rows(
    clusters: list[dict],
    olap_data: dict[str, dict[tuple[str, str], float]],
    anil_data: dict[str, dict[tuple[str, str], float]],
    annee_olap: int,
    annee_anil: int,
) -> list[dict]:
    """
    Pour chaque cluster + chaque (type, bucket), produit une ligne fact_rendement.
    OLAP prioritaire ; sinon ANIL ; sinon skip.
    Ajoute aussi des lignes COMMUNE_{code_insee} agrégées en fallback.
    """
    rows: list[dict] = []

    # 1. Lignes au niveau cluster (zone_id = cluster.id)
    for c in clusters:
        code = (c.get("code_commune") or "").zfill(5)
        type_local = c.get("type_local") or ""
        prix_m2 = c.get("prix_m2_median")
        if not prix_m2 or prix_m2 <= 0:
            continue
        window_min = c.get("window_annee_min")
        window_max = c.get("window_annee_max")
        prix_window = (
            f"{window_min}" if window_min == window_max
            else f"{window_min}-{window_max}" if window_min and window_max
            else None
        )

        # On émet 1 à 3 lignes selon les buckets disponibles : 'all', 'T1-T2', 'T3+'
        for bucket in ("all", "T1-T2", "T3+"):
            # Maison n'a que 'all'
            if type_local == "Maison" and bucket != "all":
                continue

            olap_loyer = olap_data.get(code, {}).get((type_local, bucket))
            anil_loyer = anil_data.get(code, {}).get((type_local, bucket))

            if olap_loyer is not None:
                loyer, source, quality, annee = olap_loyer, "olap", "high", annee_olap
            elif anil_loyer is not None:
                loyer, source, quality, annee = anil_loyer, "anil", "medium", annee_anil
            else:
                continue

            brut, net = compute_rendement(prix_m2, loyer)
            rows.append({
                "zone_id": c["id"],
                "code_commune": code,
                "type_local": type_local,
                "nb_pieces_bucket": bucket,
                "loyer_source": source,
                "loyer_quality": quality,
                "loyer_annee": annee,
                "loyer_m2_median": loyer,
                "loyer_n_obs": None,
                "prix_m2_median": prix_m2,
                "prix_window": prix_window,
                "rendement_brut": brut,
                "rendement_net_est": net,
            })

    # 2. Lignes commune-level (COMMUNE_{code}) pour fallback côté API
    #    Médiane pondérée des prix_m2 sur les clusters de la commune × type.
    commune_groups: dict[tuple[str, str], list[dict]] = {}
    for c in clusters:
        key = (str(c.get("code_commune") or "").zfill(5), c.get("type_local") or "")
        commune_groups.setdefault(key, []).append(c)

    for (code, type_local), cs in commune_groups.items():
        total_n = sum(c.get("count") or 0 for c in cs)
        if total_n == 0:
            continue
        weighted_prix = sum((c.get("prix_m2_median") or 0) * (c.get("count") or 0) for c in cs) / total_n

        for bucket in ("all", "T1-T2", "T3+"):
            if type_local == "Maison" and bucket != "all":
                continue
            olap_loyer = olap_data.get(code, {}).get((type_local, bucket))
            anil_loyer = anil_data.get(code, {}).get((type_local, bucket))
            if olap_loyer is not None:
                loyer, source, quality, annee = olap_loyer, "olap", "high", annee_olap
            elif anil_loyer is not None:
                loyer, source, quality, annee = anil_loyer, "anil", "medium", annee_anil
            else:
                continue
            brut, net = compute_rendement(weighted_prix, loyer)
            rows.append({
                "zone_id": f"COMMUNE_{code}",
                "code_commune": code,
                "type_local": type_local,
                "nb_pieces_bucket": bucket,
                "loyer_source": source,
                "loyer_quality": quality,
                "loyer_annee": annee,
                "loyer_m2_median": loyer,
                "loyer_n_obs": None,
                "prix_m2_median": round(weighted_prix, 2),
                "prix_window": None,
                "rendement_brut": brut,
                "rendement_net_est": net,
            })

    return rows


def upsert_fact_rendement(rows: list[dict], batch_size: int = 500) -> bool:
    """Upsert par lots dans fact_rendement (on_conflict = clé primaire composite)."""
    if not rows:
        print("    Aucune ligne à uploader.")
        return True
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    on_conflict = "zone_id,type_local,nb_pieces_bucket"
    url = f"{SUPABASE_URL}/rest/v1/fact_rendement?on_conflict={on_conflict}"
    total = len(rows)
    print(f"    Upload {total:,} lignes → Supabase...")

    with httpx.Client(timeout=90) as client:
        for i in range(0, total, batch_size):
            batch = rows[i : i + batch_size]
            resp = client.post(url, headers=headers, json=batch)
            if resp.status_code not in (200, 201, 204):
                print(f"\n    ERREUR {resp.status_code}: {resp.text[:400]}")
                return False
            print(f"      {min(i + batch_size, total):,}/{total:,}", end="\r")
            time.sleep(0.05)
    print()
    return True


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Pipeline rendement France entière (OLAP + ANIL)")
    parser.add_argument("--skip-olap", action="store_true", help="Skip import OLAP")
    parser.add_argument("--skip-anil", action="store_true", help="Skip import ANIL")
    parser.add_argument("--dry-run", action="store_true", help="Ne pas uploader")
    parser.add_argument("--limit-agglos", type=int, help="Limiter les agglos OLAP (test)")
    args = parser.parse_args()

    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERREUR : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY requis")
        sys.exit(1)

    print("=" * 60)
    print("Pipeline rendement DATAMERRY — OLAP + ANIL + DVF")
    print("=" * 60)

    # 1. Source OLAP
    olap_data: dict[str, dict[tuple[str, str], float]] = {}
    annee_olap = 0
    if not args.skip_olap:
        print("\n[1] OLAP par agglomération")
        agglos = discover_olap_agglos(limit=args.limit_agglos)
        for i, agglo in enumerate(agglos, 1):
            print(f"  [{i}/{len(agglos)}] {agglo['olap_code']} ({agglo['annee']})")
            data = parse_olap_zip(agglo)
            olap_data.update(data)
            annee_olap = max(annee_olap, agglo["annee"])
        print(f"  Total : {len(olap_data):,} communes OLAP enrichies")

    # 2. Source ANIL
    anil_data: dict[str, dict[tuple[str, str], float]] = {}
    annee_anil = 0
    if not args.skip_anil:
        print("\n[2] ANIL Carte des loyers")
        urls = discover_anil_csv_urls()
        # Année supposée dans le slug du dataset
        m = re.search(r"(\d{4})", DATAGOUV_DATASET_ANIL)
        annee_anil = int(m.group(1)) if m else 2025
        for url in urls:
            data = parse_anil_csv(url)
            # merge sans écraser un type déjà rempli
            for code, bcks in data.items():
                anil_data.setdefault(code, {}).update(bcks)
        print(f"  Total : {len(anil_data):,} communes ANIL")

    # 3. Cross-join avec DVF
    print("\n[3] Récupération des clusters DVF...")
    clusters = fetch_dvf_clusters()
    if not clusters:
        print("  ❌ Aucun cluster DVF — lancer pipeline_top30_communes.py d'abord")
        sys.exit(1)

    # 4. Construction des lignes fact_rendement
    print("\n[4] Construction fact_rendement (cluster + commune fallback)...")
    rows = build_fact_rows(
        clusters, olap_data, anil_data,
        annee_olap=annee_olap or 2024,
        annee_anil=annee_anil or 2025,
    )
    print(f"  {len(rows):,} lignes générées")

    by_source: dict[str, int] = {}
    for r in rows:
        by_source[r["loyer_source"]] = by_source.get(r["loyer_source"], 0) + 1
    for src, n in by_source.items():
        print(f"    source={src:<6} → {n:,} lignes")

    # 5. Upload
    if args.dry_run:
        print("\n[5] Dry-run — pas d'upload")
        sample = rows[:5]
        for r in sample:
            print(f"    {r}")
        return

    print("\n[5] Upload Supabase")
    ok = upsert_fact_rendement(rows)
    if ok:
        print(f"\n✅ Pipeline rendement terminé — {len(rows):,} lignes dans fact_rendement")
    else:
        print("\n❌ Échec upload")
        sys.exit(1)


if __name__ == "__main__":
    main()
