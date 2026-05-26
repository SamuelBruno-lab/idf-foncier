#!/usr/bin/env python3
"""
DATAMERRY — Pipeline d'ingestion du référentiel gares (RER / Transilien / SNCF / Métro / Tram).

Sources (ingérées dans cet ordre, dédoublonnage par (nom + commune + type)) :

  1. SNCF Open Data — Liste des gares
     https://ressources.data.sncf.com/explore/dataset/liste-des-gares/
     API ODS v2.1 — gratuite, illimitée.
     Couvre ~3000 gares France entière : SNCF, Transilien, RER (parties SNCF),
     TER, TGV, Intercités. Code UIC, code INSEE, géoloc, statut voyageurs.

  2. IDF Mobilités — Emplacement des gares IDF
     https://data.iledefrance-mobilites.fr/explore/dataset/emplacement-des-gares-idf/
     Couvre les stations 100% RATP (métro Paris, RER A/B portions RATP, tram)
     qui ne sont PAS dans le référentiel SNCF.

Modes :
  --bootstrap  : full reload (TRUNCATE puis insertion complète)
  --refresh    : upsert delta (par défaut)

Variables d'environnement requises :
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Dépendances :
  pip install requests psycopg[binary]

Usage :
  python pipeline_gares_idf.py --bootstrap
  python pipeline_gares_idf.py --refresh   # à mettre en cron mensuel
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from typing import Iterable

import requests

try:
    import psycopg
except ImportError:
    print("ERROR : pip install 'psycopg[binary]' requis", file=sys.stderr)
    sys.exit(1)

# ──────────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────────

SNCF_BASE = (
    "https://ressources.data.sncf.com/api/explore/v2.1/catalog/datasets/"
    "liste-des-gares/records"
)
IDFM_BASE = (
    "https://data.iledefrance-mobilites.fr/api/explore/v2.1/catalog/datasets/"
    "emplacement-des-gares-idf/records"
)

# Départements IDF, pour estimer le département depuis le code INSEE
IDF_DEPTS = {"75", "77", "78", "91", "92", "93", "94", "95"}

USER_AGENT = "DATAMERRY-gares-pipeline/1.0 (contact@datamerry.com)"

# ──────────────────────────────────────────────────────────────────────────────
# Connexion Supabase (via psycopg, comme pipeline_oat10y)
# ──────────────────────────────────────────────────────────────────────────────


def get_db_dsn() -> str:
    """
    Construit la DSN postgres depuis les variables NEXT_PUBLIC_SUPABASE_URL +
    SUPABASE_SERVICE_ROLE_KEY (qu'on transforme en DSN style pooler).
    """
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    direct_dsn = os.environ.get("SUPABASE_DB_URL")
    if direct_dsn:
        return direct_dsn
    if not url or not key:
        raise SystemExit(
            "ERROR : SUPABASE_DB_URL OU (NEXT_PUBLIC_SUPABASE_URL + "
            "SUPABASE_SERVICE_ROLE_KEY) requis"
        )
    # Extraction du projet Supabase et reconstruction DSN
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", url)
    if not m:
        raise SystemExit("ERROR : NEXT_PUBLIC_SUPABASE_URL invalide")
    project = m.group(1)
    # Pooler Transaction mode sur port 6543 (cf. doc Supabase)
    return (
        f"postgresql://postgres.{project}:{key}"
        f"@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"
    )


# ──────────────────────────────────────────────────────────────────────────────
# Fetch — SNCF Open Data
# ──────────────────────────────────────────────────────────────────────────────


def fetch_sncf_gares() -> list[dict]:
    """
    Pagine sur l'API ODS pour récupérer toutes les gares SNCF.
    Limite ODS = 100 records par page, on enchaîne jusqu'à épuisement.
    """
    print("📡 Fetching SNCF Open Data — liste-des-gares …")
    out: list[dict] = []
    offset = 0
    page_size = 100
    while True:
        params = {
            "limit": page_size,
            "offset": offset,
        }
        r = requests.get(
            SNCF_BASE,
            params=params,
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
            timeout=30,
        )
        if r.status_code != 200:
            print(f"⚠️  SNCF HTTP {r.status_code} à offset {offset} — stop")
            break
        data = r.json()
        records = data.get("results") or []
        if not records:
            break
        out.extend(records)
        total = data.get("total_count", 0)
        offset += page_size
        if offset >= total:
            break
        time.sleep(0.1)  # rate-limit gentille
    print(f"  ✓ SNCF : {len(out)} gares récupérées")
    return out


def parse_sncf_record(rec: dict) -> dict | None:
    """
    Convertit un record SNCF ODS en ligne dim_gares.
    Renvoie None si données géo manquantes.
    """
    geo = rec.get("c_geo") or rec.get("geo_point_2d") or {}
    lat = geo.get("lat") if isinstance(geo, dict) else None
    lon = geo.get("lon") if isinstance(geo, dict) else None
    if lat is None or lon is None:
        # Fallback : certaines versions ODS stockent comme tableau [lat, lon]
        if isinstance(geo, list) and len(geo) >= 2:
            lat, lon = geo[0], geo[1]
        else:
            return None

    nom = rec.get("libelle") or rec.get("intitule_gare") or rec.get("nom") or ""
    if not nom:
        return None

    code_uic = rec.get("code_uic") or rec.get("uic") or None
    if code_uic is not None:
        code_uic = str(code_uic).strip()

    # Statuts voyageurs/fret
    voyageurs_str = (rec.get("voyageurs") or rec.get("voyageur") or "").upper()
    voyageurs = voyageurs_str.startswith("O") or voyageurs_str == "OUI" or voyageurs_str == "YES"

    # Code commune INSEE + département
    code_insee = rec.get("codeinsee") or rec.get("code_insee") or rec.get("commune_code") or None
    if code_insee is not None:
        code_insee = str(code_insee).strip()
    dept = code_insee[:2] if code_insee else None

    # Type — SNCF ne distingue pas clairement RER de Transilien dans ce dataset.
    # On infère :
    #   - "RER" dans le nom => rer
    #   - dept IDF + libellé indique Transilien => transilien
    #   - sinon => sncf (TER/TGV/Intercités)
    nom_upper = nom.upper()
    if "RER" in nom_upper:
        gtype = "rer"
    elif dept in IDF_DEPTS:
        # En IDF mais sans "RER" : probablement Transilien (lignes H, J, K, L, N, P, R, U)
        gtype = "transilien"
    else:
        gtype = "sncf"

    return {
        "code_uic": code_uic,
        "code_idfm": None,
        "nom": nom.strip(),
        "type": gtype,
        "reseau": "SNCF",
        "lignes": None,  # SNCF ODS ne liste pas les lignes desservies
        "lat": float(lat),
        "lon": float(lon),
        "code_insee_commune": code_insee,
        "code_postal": rec.get("code_postal"),
        "dept": dept,
        "voyageurs": voyageurs if voyageurs_str else True,
        "source": "sncf-opendata",
        "source_id": rec.get("record_id") or rec.get("id") or code_uic,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Fetch — IDF Mobilités (métro + RER 100% RATP + tram)
# ──────────────────────────────────────────────────────────────────────────────


def fetch_idfm_gares() -> list[dict]:
    print("📡 Fetching IDF Mobilités — emplacement-des-gares-idf …")
    out: list[dict] = []
    offset = 0
    page_size = 100
    while True:
        params = {"limit": page_size, "offset": offset}
        r = requests.get(
            IDFM_BASE,
            params=params,
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
            timeout=30,
        )
        if r.status_code != 200:
            print(f"⚠️  IDFM HTTP {r.status_code} à offset {offset} — stop")
            break
        data = r.json()
        records = data.get("results") or []
        if not records:
            break
        out.extend(records)
        total = data.get("total_count", 0)
        offset += page_size
        if offset >= total:
            break
        time.sleep(0.1)
    print(f"  ✓ IDFM : {len(out)} entrées récupérées")
    return out


def parse_idfm_record(rec: dict) -> dict | None:
    """
    Convertit un record IDFM. Le dataset emplacement-des-gares-idf contient des
    points pour métro / RER / Transilien / tram. Les champs varient mais on
    cherche : nom_gare/nom_long, mode (mode de transport), géoloc, lignes.
    """
    geo = rec.get("geo_point_2d") or rec.get("c_geo") or rec.get("geo_shape", {}).get("geometry", {})
    lat = lon = None
    if isinstance(geo, dict):
        lat = geo.get("lat") or geo.get("y")
        lon = geo.get("lon") or geo.get("x")
        # Geo shape format : { type: 'Point', coordinates: [lon, lat] }
        coords = geo.get("coordinates")
        if coords and len(coords) >= 2 and lat is None:
            lon, lat = coords[0], coords[1]
    if lat is None or lon is None:
        return None

    nom = (
        rec.get("nom_long")
        or rec.get("nom_gare")
        or rec.get("nom")
        or rec.get("station")
        or ""
    )
    if not nom:
        return None

    # Mode de transport : 'metro', 'rer', 'tram', 'train', etc.
    mode = (rec.get("mode") or rec.get("mode_transport") or "").lower()
    if "metro" in mode or "métro" in mode:
        gtype = "metro"
    elif "rer" in mode:
        gtype = "rer"
    elif "tram" in mode:
        gtype = "tram"
    elif "train" in mode or "transilien" in mode:
        gtype = "transilien"
    else:
        gtype = "autre"

    # Lignes : champ varié selon le dataset
    lignes_raw = rec.get("res_com") or rec.get("ligne") or rec.get("lignes")
    lignes = None
    if isinstance(lignes_raw, str):
        lignes = [lignes_raw]
    elif isinstance(lignes_raw, list):
        lignes = [str(x) for x in lignes_raw]

    code_insee = rec.get("code_insee") or rec.get("codeinsee") or None
    if code_insee is not None:
        code_insee = str(code_insee).strip()

    return {
        "code_uic": None,
        "code_idfm": rec.get("id_ref_lieux") or rec.get("zdaid") or rec.get("zdcid"),
        "nom": nom.strip(),
        "type": gtype,
        "reseau": "RATP" if gtype == "metro" else "IDFM",
        "lignes": lignes,
        "lat": float(lat),
        "lon": float(lon),
        "code_insee_commune": code_insee,
        "code_postal": rec.get("code_postal"),
        "dept": code_insee[:2] if code_insee else None,
        "voyageurs": True,
        "source": "idfm",
        "source_id": rec.get("record_id"),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Insert / upsert vers Supabase
# ──────────────────────────────────────────────────────────────────────────────


def upsert_gares(rows: Iterable[dict], dsn: str, bootstrap: bool = False) -> None:
    rows_list = [r for r in rows if r is not None]
    if not rows_list:
        print("⚠️  Aucune ligne à insérer.")
        return

    print(f"📥 Upsert de {len(rows_list)} gares vers Supabase …")

    with psycopg.connect(dsn, autocommit=False) as conn:
        with conn.cursor() as cur:
            if bootstrap:
                print("  ↪ mode bootstrap : TRUNCATE public.dim_gares")
                cur.execute("TRUNCATE TABLE public.dim_gares")

            # Upsert par code_uic si présent, sinon insert (avec dédoublonnage côté code)
            sql = """
                INSERT INTO public.dim_gares
                    (code_uic, code_idfm, nom, type, reseau, lignes,
                     lat, lon, code_insee_commune, code_postal, dept,
                     voyageurs, source, source_id)
                VALUES
                    (%(code_uic)s, %(code_idfm)s, %(nom)s, %(type)s, %(reseau)s, %(lignes)s,
                     %(lat)s, %(lon)s, %(code_insee_commune)s, %(code_postal)s, %(dept)s,
                     %(voyageurs)s, %(source)s, %(source_id)s)
                ON CONFLICT (code_uic) DO UPDATE SET
                    nom = EXCLUDED.nom,
                    type = EXCLUDED.type,
                    reseau = EXCLUDED.reseau,
                    lignes = EXCLUDED.lignes,
                    lat = EXCLUDED.lat,
                    lon = EXCLUDED.lon,
                    code_insee_commune = EXCLUDED.code_insee_commune,
                    code_postal = EXCLUDED.code_postal,
                    dept = EXCLUDED.dept,
                    voyageurs = EXCLUDED.voyageurs,
                    source = EXCLUDED.source,
                    source_id = EXCLUDED.source_id,
                    updated_at = now()
            """

            inserted = 0
            for row in rows_list:
                try:
                    cur.execute(sql, row)
                    inserted += 1
                except Exception as e:
                    # Erreur silencieuse pour les lignes uniques (ex: code_uic dupliqué dans la
                    # même source) — on continue.
                    print(f"  ⚠️  insert error pour {row.get('nom')}: {e}")
            conn.commit()
            print(f"  ✓ {inserted} lignes insérées/mises à jour")


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────


def main() -> None:
    p = argparse.ArgumentParser(description="Pipeline ingestion gares DATAMERRY")
    p.add_argument(
        "--bootstrap",
        action="store_true",
        help="TRUNCATE puis ingestion complète (à lancer la 1ère fois)",
    )
    p.add_argument(
        "--refresh",
        action="store_true",
        help="Upsert delta (sans TRUNCATE). Mode par défaut.",
    )
    p.add_argument(
        "--source",
        choices=["sncf", "idfm", "both"],
        default="both",
        help="Source(s) à ingérer (défaut : both)",
    )
    args = p.parse_args()

    dsn = get_db_dsn()
    rows: list[dict] = []

    if args.source in ("sncf", "both"):
        sncf_records = fetch_sncf_gares()
        rows.extend(filter(None, (parse_sncf_record(r) for r in sncf_records)))

    if args.source in ("idfm", "both"):
        idfm_records = fetch_idfm_gares()
        rows.extend(filter(None, (parse_idfm_record(r) for r in idfm_records)))

    # Dédoublonnage : si plusieurs entrées avec le même code_uic → on garde la première
    seen_uic: set[str] = set()
    deduped: list[dict] = []
    for r in rows:
        uic = r.get("code_uic")
        if uic:
            if uic in seen_uic:
                continue
            seen_uic.add(uic)
        deduped.append(r)

    print(f"\n📊 Total après dédoublonnage : {len(deduped)} gares")
    print(
        f"   • SNCF      : {sum(1 for r in deduped if r['source'] == 'sncf-opendata')}"
    )
    print(
        f"   • IDFM      : {sum(1 for r in deduped if r['source'] == 'idfm')}"
    )
    print(f"   • IDF dept : {sum(1 for r in deduped if r.get('dept') in IDF_DEPTS)}")

    upsert_gares(deduped, dsn, bootstrap=args.bootstrap)
    print("\n✅ Pipeline terminé.")


if __name__ == "__main__":
    main()
