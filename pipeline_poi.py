#!/usr/bin/env python3
"""
DATAMERRY — Pipeline d'ingestion bulk des Points d'Intérêts notables France entière.

Sources :
  1. Mérimée (data.gouv.fr) — Immeubles protégés au titre des Monuments Historiques
     ~45 000 monuments classés/inscrits, le référentiel officiel du Ministère
     de la Culture. Inclut coordonnées GPS + commune INSEE.
     https://www.data.gouv.fr/fr/datasets/immeubles-proteges-au-titre-des-monuments-historiques-1/
     Mirror via API ODS : data.culture.gouv.fr

  2. Wikidata SPARQL — musées, parcs, sites touristiques, places remarquables
     ayant une article Wikipedia français en France.
     ~20 000 POI complémentaires.
     https://query.wikidata.org

Modes :
  --bootstrap   : TRUNCATE + full reload
  --refresh     : upsert delta (par défaut, mise à jour annuelle)
  --source X    : sncf | wikidata | merimee | all (défaut all)

Variables d'environnement :
  NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  (ou SUPABASE_DB_URL)

Dépendances :
  pip install requests psycopg[binary]

Usage :
  python pipeline_poi.py --bootstrap
  python pipeline_poi.py --refresh --source wikidata
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

USER_AGENT = "DATAMERRY-poi-pipeline/1.0 (contact@datamerry.com)"

# ──────────────────────────────────────────────────────────────────────────────
# DB connection (réutilise le pattern de pipeline_gares_idf.py)
# ──────────────────────────────────────────────────────────────────────────────


def get_db_dsn() -> str:
    direct = os.environ.get("SUPABASE_DB_URL")
    if direct:
        return direct
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise SystemExit("ERROR : SUPABASE_DB_URL OU (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) requis")
    m = re.match(r"https://([a-z0-9]+)\.supabase\.co", url)
    if not m:
        raise SystemExit("ERROR : NEXT_PUBLIC_SUPABASE_URL invalide")
    project = m.group(1)
    return f"postgresql://postgres.{project}:{key}@aws-0-eu-west-1.pooler.supabase.com:6543/postgres"


# ──────────────────────────────────────────────────────────────────────────────
# Source 1 — Mérimée (Monuments Historiques officiels)
# ──────────────────────────────────────────────────────────────────────────────

MERIMEE_BASE = (
    "https://data.culture.gouv.fr/api/explore/v2.1/catalog/datasets/"
    "liste-des-immeubles-proteges-au-titre-des-monuments-historiques/records"
)


# Tous les départements français (métropole + Corse + DROM)
ALL_DEPTS = [
    "01","02","03","04","05","06","07","08","09","10",
    "11","12","13","14","15","16","17","18","19","21",
    "22","23","24","25","26","27","28","29","2A","2B",
    "30","31","32","33","34","35","36","37","38","39",
    "40","41","42","43","44","45","46","47","48","49",
    "50","51","52","53","54","55","56","57","58","59",
    "60","61","62","63","64","65","66","67","68","69",
    "70","71","72","73","74","75","76","77","78","79",
    "80","81","82","83","84","85","86","87","88","89",
    "90","91","92","93","94","95","971","972","973","974","976",
]


def fetch_merimee() -> list[dict]:
    """
    Pagine sur l'API ODS Mérimée DÉPARTEMENT PAR DÉPARTEMENT pour contourner
    la limite serveur ODS (offset max 10 000).

    L'API ODS data.culture.gouv.fr renvoie HTTP 400 quand l'offset dépasse
    ~10 000. En filtrant par dept (refine), on a chaque dept = quelques
    centaines de monuments max → offset reste < 1 000 par dept.
    """
    print("📡 Mérimée — Monuments Historiques classés/inscrits (paginé par dept) …")
    out: list[dict] = []
    page_size = 100
    # Champ refine selon nomenclature ODS Mérimée
    refine_fields_candidates = ["departement_en_lettres", "departement", "code_departement", "dpt"]

    for dept in ALL_DEPTS:
        # On essaye plusieurs nomenclatures de champ (varie selon version ODS)
        dept_count = 0
        for refine_field in refine_fields_candidates:
            offset = 0
            success = False
            while True:
                try:
                    r = requests.get(
                        MERIMEE_BASE,
                        params={
                            "limit": page_size,
                            "offset": offset,
                            "select": "*",
                            f"refine.{refine_field}": dept,
                        },
                        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
                        timeout=30,
                    )
                except requests.RequestException as e:
                    print(f"  ⚠️ Dept {dept} ({refine_field}) network error : {e}")
                    break
                if r.status_code != 200:
                    # Ce refine field ne marche pas, on tente le suivant
                    break
                data = r.json()
                records = data.get("results") or []
                if not records:
                    if offset == 0:
                        # Refine accepté mais 0 résultat — peut-être mauvais champ
                        break
                    # Sinon on a fini les records de ce dept
                    success = True
                    break
                out.extend(records)
                dept_count += len(records)
                success = True
                total = data.get("total_count", 0)
                offset += page_size
                if offset >= total:
                    break
                time.sleep(0.05)
            if success and dept_count > 0:
                # On a trouvé le bon refine field, on l'utilise pour les depts suivants
                break
        if dept_count > 0:
            print(f"  ✓ Dept {dept}: {dept_count} monuments")
    print(f"  ✓ Mérimée TOTAL : {len(out)} monuments récupérés")
    return out


def parse_merimee_record(rec: dict) -> dict | None:
    """
    Convertit un record Mérimée ODS en ligne dim_poi.

    Les noms de champs varient selon la version ODS du dataset.
    On essaye TOUS les noms connus + un fallback brutal sur les clés
    contenant 'geo' / 'coord' pour les coordonnées.
    """
    # ── Coordonnées : on cherche partout ───────────────────────────────────
    geo_candidates = [
        "coordonnees", "coordonnees_geographiques", "geo_point_2d", "c_geo",
        "geo_shape", "loc_xy", "geom_x_y", "centre", "coords",
    ]
    geo = None
    for key in geo_candidates:
        if key in rec and rec[key]:
            geo = rec[key]
            break
    # Fallback : scan toutes les clés qui contiennent "geo" ou "coord"
    if geo is None:
        for k, v in rec.items():
            if v and ("geo" in k.lower() or "coord" in k.lower() or k.lower() in ("lat", "latitude")):
                geo = v
                break

    lat = lon = None
    if isinstance(geo, dict):
        # Format ODS classique : {lat, lon} OU {y, x}
        lat = geo.get("lat") or geo.get("y") or geo.get("latitude")
        lon = geo.get("lon") or geo.get("x") or geo.get("longitude") or geo.get("lng")
        # Format GeoJSON : { type: 'Point', coordinates: [lon, lat] }
        if lat is None and "coordinates" in geo:
            coords = geo["coordinates"]
            if isinstance(coords, list) and len(coords) >= 2:
                lon, lat = coords[0], coords[1]
    elif isinstance(geo, list) and len(geo) >= 2:
        # Tableau [lat, lon] ou [lon, lat] — heuristique : si premier > 90, c'est du lon
        a, b = float(geo[0]), float(geo[1])
        if abs(a) > 90:
            lon, lat = a, b
        else:
            lat, lon = a, b
    elif isinstance(geo, str):
        # Format "lat,lon" ou "lon,lat"
        parts = geo.split(",")
        if len(parts) == 2:
            try:
                a, b = float(parts[0].strip()), float(parts[1].strip())
                if abs(a) > 90:
                    lon, lat = a, b
                else:
                    lat, lon = a, b
            except ValueError:
                pass

    if lat is None or lon is None:
        return None

    # Sanity check
    try:
        lat_f, lon_f = float(lat), float(lon)
        if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180):
            return None
    except (TypeError, ValueError):
        return None

    # ── Nom : essaye plusieurs champs ──────────────────────────────────────
    nom_candidates = [
        "titre_courant", "appellation", "appellation_courante",
        "nom", "denomination", "intitule", "designation",
    ]
    nom = None
    for key in nom_candidates:
        v = rec.get(key)
        if v and isinstance(v, str):
            nom = v.strip()
            break
    if not nom:
        return None

    # ── Code commune + dept ────────────────────────────────────────────────
    insee_candidates = [
        "code_insee_commune", "code_insee", "insee",
        "codeinsee_commune", "code_commune", "codecom",
    ]
    code_insee = None
    for key in insee_candidates:
        v = rec.get(key)
        if v:
            code_insee = str(v).strip()
            break
    dept = None
    if code_insee:
        # DROM = 3 chars, métropole = 2 chars
        dept = code_insee[:3] if code_insee.startswith("97") else code_insee[:2]

    # ── Score notabilité : MH classé = 50, inscrit = 30, autre = 20 ───────
    protection_candidates = [
        "statut_juridique_de_la_protection",
        "statut_juridique",
        "protection",
        "categorie_de_classement",
    ]
    protection = ""
    for key in protection_candidates:
        v = rec.get(key)
        if v:
            protection = str(v).lower()
            break
    notabilite = 50 if "class" in protection else 30 if "inscr" in protection else 20

    # ── ID Mérimée (référence de la notice) ───────────────────────────────
    merimee_id_candidates = [
        "reference_de_la_notice", "reference", "ref",
        "merimee", "record_id", "id",
    ]
    merimee_id = None
    for key in merimee_id_candidates:
        v = rec.get(key)
        if v:
            merimee_id = str(v).strip()
            break

    return {
        "wikidata_id": None,
        "merimee_id": merimee_id,
        "osm_id": None,
        "nom": nom,
        "type": "monument",
        "categorie": (rec.get("denomination") or "monument_historique").strip().lower()[:60]
        if isinstance(rec.get("denomination"), str)
        else "monument_historique",
        "lat": lat_f,
        "lon": lon_f,
        "code_insee_commune": code_insee,
        "dept": dept,
        "wikipedia_url": None,
        "description": None,
        "notabilite_score": notabilite,
        "source": "merimee",
    }


# ──────────────────────────────────────────────────────────────────────────────
# Source 2 — Wikidata SPARQL (musées + sites + parcs + places)
# ──────────────────────────────────────────────────────────────────────────────

WIKIDATA_SPARQL = "https://query.wikidata.org/sparql"

# Types Wikidata à interroger UN PAR UN (pour éviter timeout serveur public)
# Chaque type = requête SPARQL séparée, ~5-30s chacune.
WIKIDATA_TYPES = [
    ("Q33506", "musée"),
    ("Q22698", "parc urbain"),
    ("Q839954", "site archéologique"),
    ("Q174782", "place"),
    ("Q16970", "église"),
    ("Q23413", "château"),
    ("Q24354", "opéra"),
    ("Q1497375", "théâtre"),
    ("Q22652", "jardin remarquable"),
    ("Q1567431", "site naturel remarquable"),
]


def build_sparql_for_type(type_qid: str) -> str:
    """Requête SPARQL pour UN type de POI en France avec article Wikipedia FR."""
    return f"""
SELECT DISTINCT ?item ?itemLabel ?coord ?wikipedia ?sitelinks ?inseeCode WHERE {{
  ?item wdt:P31/wdt:P279* wd:{type_qid} .
  ?item wdt:P17 wd:Q142 .              # en France
  ?item wdt:P625 ?coord .              # avec coordonnées
  ?item wikibase:sitelinks ?sitelinks .
  OPTIONAL {{ ?item wdt:P374 ?inseeCode . }}
  ?wikipedia schema:about ?item ;
             schema:isPartOf <https://fr.wikipedia.org/> .
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "fr". }}
}}
LIMIT 10000
""".strip()


def fetch_wikidata() -> list[dict]:
    """
    Lance UNE requête SPARQL Wikidata PAR TYPE de POI (anti-timeout).

    L'ancienne version cumulait tous les types en 1 grosse requête → 60-90s
    de calcul → timeout 504 sur le serveur public. Maintenant on découpe :
    chaque type tourne en 5-30s, on a 10 requêtes totales = ~3 min total.

    Si une type timeout, on log et on continue avec les suivants.
    """
    all_bindings: list[dict] = []
    print("📡 Wikidata SPARQL — 10 types de POI (musées, parcs, places, etc.) …")

    for type_qid, type_label in WIKIDATA_TYPES:
        query = build_sparql_for_type(type_qid)
        try:
            r = requests.post(
                WIKIDATA_SPARQL,
                data={"query": query, "format": "json"},
                headers={
                    "Accept": "application/sparql-results+json",
                    "User-Agent": USER_AGENT,
                },
                timeout=90,
            )
            if r.status_code != 200:
                print(f"  ⚠️ Wikidata {type_label} ({type_qid}): HTTP {r.status_code}")
                # Backoff léger avant le suivant
                time.sleep(3)
                continue
            data = r.json()
            bindings = data.get("results", {}).get("bindings", [])
            # On attache le type label à chaque binding pour parser plus tard
            for b in bindings:
                b["_type_label"] = {"value": type_label}
            all_bindings.extend(bindings)
            print(f"  ✓ {type_label} ({type_qid}): {len(bindings)} POI")
            # Rate limit gentil — Wikidata est tolérant mais courtois
            time.sleep(1)
        except requests.RequestException as e:
            print(f"  ⚠️ Wikidata {type_label} network error : {e}")
            continue

    print(f"  ✓ Wikidata TOTAL : {len(all_bindings)} POI récupérés")
    return all_bindings


def parse_wikidata_binding(b: dict) -> dict | None:
    item_uri = b.get("item", {}).get("value", "")
    qid = item_uri.rsplit("/", 1)[-1] if item_uri else None
    if not qid:
        return None
    nom = b.get("itemLabel", {}).get("value")
    if not nom:
        return None

    coord_raw = b.get("coord", {}).get("value", "")
    # Format Wikidata : "Point(2.2945 48.8584)"
    m = re.match(r"Point\(([-\d.]+)\s+([-\d.]+)\)", coord_raw)
    if not m:
        return None
    lon = float(m.group(1))
    lat = float(m.group(2))

    wikipedia_url = b.get("wikipedia", {}).get("value")
    # _type_label est injecté par fetch_wikidata() (1 requête par type),
    # ancien typeLabel restait pour compatibilité legacy
    type_label = (
        b.get("_type_label", {}).get("value")
        or b.get("typeLabel", {}).get("value", "")
    ).lower()
    insee = b.get("inseeCode", {}).get("value")

    # Map type_label → type dim_poi (CHECK constraint)
    if "musée" in type_label or "museum" in type_label:
        ptype, cat = "musee", "musee"
    elif "parc" in type_label or "park" in type_label:
        ptype, cat = "parc", "parc_urbain"
    elif "site archéologique" in type_label or "archaeological" in type_label:
        ptype, cat = "site_archeologique", "site_archeologique"
    elif "place" in type_label:
        ptype, cat = "place", "place_publique"
    elif "église" in type_label or "church" in type_label:
        ptype, cat = "eglise", "edifice_religieux"
    elif "château" in type_label or "castle" in type_label:
        ptype, cat = "chateau", "chateau"
    elif "opéra" in type_label or "opera" in type_label:
        ptype, cat = "opera", "opera"
    elif "théâtre" in type_label or "theatre" in type_label or "theater" in type_label:
        ptype, cat = "theatre", "theatre"
    elif "jardin" in type_label or "garden" in type_label:
        ptype, cat = "parc", "jardin_remarquable"
    elif "site naturel" in type_label:
        ptype, cat = "site_naturel", "site_naturel"
    else:
        ptype, cat = "autre", type_label[:60]

    # Score notabilité : Wikipedia présent = base 30, + sitelinks bonus
    sitelinks = 0
    try:
        sitelinks = int(b.get("sitelinks", {}).get("value", "0"))
    except ValueError:
        pass
    notabilite = 30 + min(sitelinks * 2, 100)  # plafonne à 130 pour pas tout exploser

    dept = None
    if insee:
        insee = insee.strip().zfill(5) if len(insee.strip()) <= 5 else insee
        dept = insee[:2] if len(insee) >= 2 else None

    return {
        "wikidata_id": qid,
        "merimee_id": None,
        "osm_id": None,
        "nom": nom.strip(),
        "type": ptype,
        "categorie": cat[:60],
        "lat": lat,
        "lon": lon,
        "code_insee_commune": insee,
        "dept": dept,
        "wikipedia_url": wikipedia_url,
        "description": None,
        "notabilite_score": notabilite,
        "source": "wikidata",
    }


# ──────────────────────────────────────────────────────────────────────────────
# Upsert vers Supabase
# ──────────────────────────────────────────────────────────────────────────────


def upsert_poi(rows: Iterable[dict], dsn: str, bootstrap: bool = False) -> None:
    rows_list = [r for r in rows if r is not None]
    if not rows_list:
        print("⚠️  Aucune ligne à insérer.")
        return

    print(f"📥 Upsert de {len(rows_list)} POI vers Supabase …")

    sql = """
        INSERT INTO public.dim_poi
            (wikidata_id, merimee_id, osm_id, nom, type, categorie,
             lat, lon, code_insee_commune, dept,
             wikipedia_url, description, notabilite_score, source)
        VALUES
            (%(wikidata_id)s, %(merimee_id)s, %(osm_id)s, %(nom)s, %(type)s, %(categorie)s,
             %(lat)s, %(lon)s, %(code_insee_commune)s, %(dept)s,
             %(wikipedia_url)s, %(description)s, %(notabilite_score)s, %(source)s)
        ON CONFLICT
        ON CONSTRAINT uniq_poi_wikidata
        DO UPDATE SET
            nom = EXCLUDED.nom,
            wikipedia_url = COALESCE(EXCLUDED.wikipedia_url, dim_poi.wikipedia_url),
            notabilite_score = GREATEST(EXCLUDED.notabilite_score, dim_poi.notabilite_score),
            updated_at = now()
    """

    # Pour Mérimée on utilise un autre conflict path
    sql_merimee = """
        INSERT INTO public.dim_poi
            (wikidata_id, merimee_id, osm_id, nom, type, categorie,
             lat, lon, code_insee_commune, dept,
             wikipedia_url, description, notabilite_score, source)
        VALUES
            (%(wikidata_id)s, %(merimee_id)s, %(osm_id)s, %(nom)s, %(type)s, %(categorie)s,
             %(lat)s, %(lon)s, %(code_insee_commune)s, %(dept)s,
             %(wikipedia_url)s, %(description)s, %(notabilite_score)s, %(source)s)
        ON CONFLICT
        ON CONSTRAINT uniq_poi_merimee
        DO UPDATE SET
            nom = EXCLUDED.nom,
            updated_at = now()
    """

    inserted = 0
    with psycopg.connect(dsn, autocommit=False) as conn:
        with conn.cursor() as cur:
            if bootstrap:
                print("  ↪ mode bootstrap : TRUNCATE public.dim_poi")
                cur.execute("TRUNCATE TABLE public.dim_poi")
            for row in rows_list:
                try:
                    if row.get("merimee_id"):
                        cur.execute(sql_merimee, row)
                    elif row.get("wikidata_id"):
                        cur.execute(sql, row)
                    else:
                        # No external id → insert as-is
                        cur.execute(sql.replace("ON CONFLICT\n        ON CONSTRAINT uniq_poi_wikidata\n        DO UPDATE SET\n            nom = EXCLUDED.nom,\n            wikipedia_url = COALESCE(EXCLUDED.wikipedia_url, dim_poi.wikipedia_url),\n            notabilite_score = GREATEST(EXCLUDED.notabilite_score, dim_poi.notabilite_score),\n            updated_at = now()", "ON CONFLICT DO NOTHING"), row)
                    inserted += 1
                except Exception as e:
                    print(f"  ⚠️ Insert error pour {row.get('nom')}: {e}")
            conn.commit()
    print(f"  ✓ {inserted} POI insérés/mis à jour")


# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────


def main() -> None:
    p = argparse.ArgumentParser(description="Pipeline ingestion POI DATAMERRY")
    p.add_argument("--bootstrap", action="store_true", help="TRUNCATE puis full reload")
    p.add_argument("--refresh", action="store_true", help="Upsert delta (défaut)")
    p.add_argument(
        "--source",
        choices=["merimee", "wikidata", "all"],
        default="all",
        help="Source(s) à ingérer",
    )
    args = p.parse_args()

    dsn = get_db_dsn()
    rows: list[dict] = []

    if args.source in ("merimee", "all"):
        merimee_records = fetch_merimee()
        rows.extend(filter(None, (parse_merimee_record(r) for r in merimee_records)))

    if args.source in ("wikidata", "all"):
        wd_bindings = fetch_wikidata()
        rows.extend(filter(None, (parse_wikidata_binding(b) for b in wd_bindings)))

    print(f"\n📊 Total POI à ingérer : {len(rows)}")
    print(f"   • Mérimée   : {sum(1 for r in rows if r['source'] == 'merimee')}")
    print(f"   • Wikidata  : {sum(1 for r in rows if r['source'] == 'wikidata')}")
    print(f"   • IDF (dept 75-95) : {sum(1 for r in rows if r.get('dept') and r['dept'] in {'75','77','78','91','92','93','94','95'})}")

    upsert_poi(rows, dsn, bootstrap=args.bootstrap)
    print("\n✅ Pipeline POI terminé.")


if __name__ == "__main__":
    main()
