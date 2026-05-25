#!/usr/bin/env python3
"""
DATAMERRY — Pipeline d'ingestion du taux OAT 10 ans France.

Sources (par ordre de préférence) :
  1. ECB Statistical Data Warehouse (autorité européenne, JSON SDMX 2.1)
     https://data-api.ecb.europa.eu/service/data/FM/D.FR.EUR.4F.BB.U2_10Y.YLD
  2. Banque de France Webstat (CSV)
  3. FRED St. Louis Fed (mirroir mensuel, fallback dernier recours)
     https://api.stlouisfed.org/fred/series/observations?series_id=IRLTLT01FRM156N

Mode :
  --bootstrap  : télécharge toute la série historique 1990 → aujourd'hui
                 (à lancer une fois pour initialiser la table)
  --daily      : récupère uniquement les dernières observations manquantes
                 (à lancer en cron quotidien)

Variables d'environnement requises :
  SUPABASE_URL              ou NEXT_PUBLIC_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  (optionnel) FRED_API_KEY pour le fallback FRED — gratuit sur fred.stlouisfed.org

Dépendances :
  pip install requests pandas supabase
"""

import argparse
import os
import sys
import time
from datetime import date, datetime, timedelta
from typing import Iterable

import requests
import pandas as pd

# Supabase client — on utilise psycopg car compatible avec setup-datamerry.py
try:
    import psycopg
except ImportError:
    print("❌ psycopg manquant. Installe : pip install 'psycopg[binary]'")
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# Sources de données
# ─────────────────────────────────────────────────────────────────────────────

ECB_SDW_URL = (
    "https://data-api.ecb.europa.eu/service/data/FM/"
    "D.FR.EUR.4F.BB.U2_10Y.YLD"
)
ECB_SDW_PARAMS = {"format": "csvdata"}

BDF_WEBSTAT_URL = (
    # Série OAT 10 ans (publication quotidienne BdF)
    # Le code de série exact peut évoluer ; à valider via webstat.banque-france.fr
    "https://webstat.banque-france.fr/ws_wsfr/downloadFile.do"
)
BDF_WEBSTAT_SERIES_ID = "IRS.D.FR.L.L40.CI.0000.EUR.N.Z"

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_SERIES_ID = "IRLTLT01FRM156N"  # mensuel — fallback en dernier recours


# ─────────────────────────────────────────────────────────────────────────────
# Fetcher ECB SDW (source principale)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_ecb_sdw(start: date | None = None) -> pd.DataFrame:
    """
    Récupère la série OAT 10 ans France depuis ECB SDW au format CSV.

    Retourne un DataFrame [date_obs, taux_oat_10y, source].
    """
    params = dict(ECB_SDW_PARAMS)
    if start is not None:
        params["startPeriod"] = start.isoformat()

    print(f"  → ECB SDW : {ECB_SDW_URL}?{params}")
    resp = requests.get(
        ECB_SDW_URL,
        params=params,
        headers={"Accept": "text/csv"},
        timeout=30,
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"ECB SDW HTTP {resp.status_code} — {resp.text[:200]}"
        )

    # Le CSV SDMX ECB a une structure avec entête puis lignes : KEY,DATE,VALUE,...
    # On parse via pandas en sautant les éventuels headers
    from io import StringIO

    df = pd.read_csv(StringIO(resp.text))
    # On cherche les 2 colonnes clés
    date_col = next(
        (c for c in df.columns if c.lower() in ("time_period", "date", "obs_date")),
        None,
    )
    value_col = next(
        (c for c in df.columns if c.lower() in ("obs_value", "value")),
        None,
    )
    if not date_col or not value_col:
        raise RuntimeError(
            f"ECB SDW : colonnes inattendues {list(df.columns)[:10]}"
        )

    out = pd.DataFrame(
        {
            "date_obs": pd.to_datetime(df[date_col]).dt.date,
            "taux_oat_10y": pd.to_numeric(df[value_col], errors="coerce"),
        }
    )
    out["source"] = "ECB_SDW"
    out = out.dropna(subset=["taux_oat_10y"]).drop_duplicates(subset=["date_obs"])
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Fetcher BdF Webstat (fallback 1)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_bdf_webstat(start: date | None = None) -> pd.DataFrame:
    """
    Fallback : Banque de France Webstat (CSV).
    L'URL exact peut évoluer ; valider sur webstat.banque-france.fr si bug.
    """
    print(f"  → BdF Webstat (fallback)")
    params = {
        "id": BDF_WEBSTAT_SERIES_ID,
        "format": "csv",
    }
    resp = requests.get(BDF_WEBSTAT_URL, params=params, timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(
            f"BdF Webstat HTTP {resp.status_code} — {resp.text[:200]}"
        )

    from io import StringIO

    # BdF utilise un format CSV semi-colon avec entête textuel ; à ajuster
    df = pd.read_csv(StringIO(resp.text), sep=";", skiprows=5)
    df.columns = [c.strip() for c in df.columns]
    date_col = next((c for c in df.columns if "date" in c.lower()), df.columns[0])
    value_col = next(
        (c for c in df.columns if "value" in c.lower() or "taux" in c.lower()),
        df.columns[1],
    )
    out = pd.DataFrame(
        {
            "date_obs": pd.to_datetime(df[date_col], dayfirst=True, errors="coerce").dt.date,
            "taux_oat_10y": pd.to_numeric(
                df[value_col].astype(str).str.replace(",", "."), errors="coerce"
            ),
        }
    )
    out["source"] = "BDF_WEBSTAT"
    out = out.dropna(subset=["date_obs", "taux_oat_10y"]).drop_duplicates(subset=["date_obs"])
    if start is not None:
        out = out[out["date_obs"] >= start]
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Fetcher FRED (fallback 2 — mensuel)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_fred(start: date | None = None) -> pd.DataFrame:
    """
    Fallback ultime : FRED mensuel pour la France. Précision moindre que ECB
    journalier mais suffisant pour l'analyse statistique macro.
    """
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        raise RuntimeError("FRED_API_KEY manquante (gratuite sur fred.stlouisfed.org)")

    print(f"  → FRED (fallback ultime mensuel)")
    params = {
        "series_id": FRED_SERIES_ID,
        "api_key": api_key,
        "file_type": "json",
    }
    if start is not None:
        params["observation_start"] = start.isoformat()

    resp = requests.get(FRED_URL, params=params, timeout=30)
    if resp.status_code != 200:
        raise RuntimeError(f"FRED HTTP {resp.status_code}")
    data = resp.json()
    obs = data.get("observations", [])
    out = pd.DataFrame(
        {
            "date_obs": [datetime.fromisoformat(o["date"]).date() for o in obs],
            "taux_oat_10y": [
                float(o["value"]) if o["value"] not in (".", "") else None
                for o in obs
            ],
        }
    )
    out["source"] = "FRED"
    return out.dropna(subset=["taux_oat_10y"])


# ─────────────────────────────────────────────────────────────────────────────
# Cascade des sources
# ─────────────────────────────────────────────────────────────────────────────

def fetch_oat_with_fallback(start: date | None = None) -> pd.DataFrame:
    errors: list[str] = []
    for fetcher in (fetch_ecb_sdw, fetch_bdf_webstat, fetch_fred):
        try:
            df = fetcher(start=start)
            if len(df) > 0:
                print(f"  ✅ {len(df):,} lignes récupérées via {fetcher.__name__}")
                return df
            errors.append(f"{fetcher.__name__} : 0 ligne")
        except Exception as e:
            errors.append(f"{fetcher.__name__} : {e}")
            print(f"  ⚠️ {fetcher.__name__} échoué : {e}")
    raise RuntimeError(
        "Aucune source OAT 10 ans accessible :\n  - " + "\n  - ".join(errors)
    )


# ─────────────────────────────────────────────────────────────────────────────
# Connexion Supabase + upsert
# ─────────────────────────────────────────────────────────────────────────────

def get_connection() -> "psycopg.Connection":
    uri = (
        os.environ.get("SUPABASE_DB_URL")
        or os.environ.get("DATABASE_URL")
    )
    if not uri:
        print(
            "❌ Variable SUPABASE_DB_URL manquante.\n"
            "   Format attendu : postgresql://postgres.xxxxx:PASSWORD@aws-1-eu-west-1.pooler.supabase.com:5432/postgres\n"
            "   Récupère-la dans Supabase Dashboard → Settings → Database → URI Session."
        )
        sys.exit(1)
    return psycopg.connect(uri, connect_timeout=10)


def upsert_rows(conn: "psycopg.Connection", df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    rows = [
        (r.date_obs, float(r.taux_oat_10y), r.source)
        for r in df.itertuples(index=False)
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO public.fact_taux_oat10y (date_obs, taux_oat_10y, source)
            VALUES (%s, %s, %s)
            ON CONFLICT (date_obs) DO UPDATE
              SET taux_oat_10y = EXCLUDED.taux_oat_10y,
                  source       = EXCLUDED.source,
                  fetched_at   = now()
            """,
            rows,
        )
    conn.commit()
    return len(rows)


def get_latest_date(conn: "psycopg.Connection") -> date | None:
    with conn.cursor() as cur:
        cur.execute("SELECT MAX(date_obs) FROM public.fact_taux_oat10y")
        result = cur.fetchone()
        return result[0] if result and result[0] else None


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--bootstrap",
        action="store_true",
        help="Télécharge toute l'histoire (1990 → aujourd'hui). À faire 1 fois.",
    )
    parser.add_argument(
        "--daily",
        action="store_true",
        help="Récupère uniquement les jours manquants depuis le dernier import.",
    )
    parser.add_argument(
        "--start",
        type=str,
        help="Date de début ISO (override). Ex: 2014-01-01",
    )
    args = parser.parse_args()

    if not (args.bootstrap or args.daily or args.start):
        parser.error("Choisis --bootstrap, --daily ou --start YYYY-MM-DD")

    print("─" * 70)
    print("  DATAMERRY — Pipeline OAT 10 ans France")
    print("─" * 70)

    conn = get_connection()
    try:
        if args.bootstrap:
            start = date(1990, 1, 1)
            print(f"\n▶ Mode BOOTSTRAP — historique complet depuis {start}")
        elif args.start:
            start = date.fromisoformat(args.start)
            print(f"\n▶ Mode START — récupération depuis {start}")
        else:  # daily
            latest = get_latest_date(conn)
            start = (latest + timedelta(days=1)) if latest else date(2014, 1, 1)
            print(f"\n▶ Mode DAILY — dernière obs en base : {latest}, fetch depuis {start}")

        print(f"\n▶ Téléchargement OAT 10 ans France...")
        df = fetch_oat_with_fallback(start=start)
        df = df[df["date_obs"] >= start].sort_values("date_obs")

        print(f"\n▶ Insertion dans Supabase ({len(df):,} lignes)...")
        n = upsert_rows(conn, df)
        print(f"  ✅ {n:,} lignes upsertées dans fact_taux_oat10y")

        # Petit stats récap
        if not df.empty:
            print(f"\n▶ Stats récap :")
            print(f"  Période : {df['date_obs'].min()} → {df['date_obs'].max()}")
            print(f"  Taux moyen : {df['taux_oat_10y'].mean():.4f}%")
            print(f"  Taux min   : {df['taux_oat_10y'].min():.4f}% (à {df.loc[df['taux_oat_10y'].idxmin(), 'date_obs']})")
            print(f"  Taux max   : {df['taux_oat_10y'].max():.4f}% (à {df.loc[df['taux_oat_10y'].idxmax(), 'date_obs']})")
            print(f"  Source utilisée : {df['source'].iloc[0]}")

        print(f"\n✅ Terminé.\n")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
