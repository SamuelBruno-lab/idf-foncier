#!/usr/bin/env python3
"""
DATAMERRY — Pipeline d'ingestion du taux OAT 10 ans France.

Sources (par ordre de préférence) :
  1. Eurostat SDMX 2.1 — irt_lt_mcby_d (Maastricht bond yield 10Y daily)
     https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/irt_lt_mcby_d/D.PA.MCBY.FR
     Gratuit, daily depuis 1993, source officielle EU.
  2. ECB Statistical Data Warehouse (fallback, daily)
  3. FRED St. Louis Fed (fallback ultime, monthly — requiert FRED_API_KEY gratuite)
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

# Eurostat — Maastricht bond yield 10Y daily France
# Dataset: irt_lt_mcby_d (Long term government bond yields - Maastricht criterion - Daily)
# Key dimensions: FREQ=D, UNIT=PA (% per annum), INDIC=MCBY, GEO=FR
EUROSTAT_URL = (
    "https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/"
    "irt_lt_mcby_d/D.PA.MCBY.FR"
)
EUROSTAT_PARAMS = {"format": "csvdata", "compress": "false"}

# ECB SDW (fallback secondaire — l'endpoint exact varie, on tente plusieurs codes)
ECB_SDW_CANDIDATES = [
    "https://data-api.ecb.europa.eu/service/data/IRS/M.FR.L.L40.CI.0000.EUR.N.Z",
    "https://data-api.ecb.europa.eu/service/data/FM/D.FR.EUR.4F.BB.U2_10Y.YLD",
]

FRED_URL = "https://api.stlouisfed.org/fred/series/observations"
FRED_SERIES_ID = "IRLTLT01FRM156N"  # mensuel — fallback ultime


# ─────────────────────────────────────────────────────────────────────────────
# Fetcher Eurostat — source principale (daily, gratuit, sans clé)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_eurostat(start: date | None = None) -> pd.DataFrame:
    """
    Récupère la série OAT 10 ans France depuis Eurostat SDMX 2.1 au format CSV.
    Dataset: irt_lt_mcby_d (Maastricht criterion bond yields, daily).

    Retourne un DataFrame [date_obs, taux_oat_10y, source].
    """
    from io import StringIO

    params = dict(EUROSTAT_PARAMS)
    # Eurostat respecte startPeriod en YYYY-MM-DD
    if start is not None:
        params["startPeriod"] = start.isoformat()

    print(f"  → Eurostat : {EUROSTAT_URL}")
    # Eurostat est strict sur les Accept headers — on accepte n'importe quoi
    # (le format réel est négocié via query param `format=csvdata`).
    resp = requests.get(
        EUROSTAT_URL,
        params=params,
        headers={"Accept": "*/*"},
        timeout=60,
    )
    if resp.status_code != 200:
        raise RuntimeError(
            f"Eurostat HTTP {resp.status_code} — {resp.text[:200]}"
        )

    # CSV Eurostat SDMX 2.1 :
    #   DATAFLOW,LAST UPDATE,freq,unit,indic,geo,TIME_PERIOD,OBS_VALUE,OBS_FLAG
    df = pd.read_csv(StringIO(resp.text))
    if df.empty:
        raise RuntimeError("Eurostat : CSV vide")

    # Repérage des colonnes (Eurostat respecte ces noms standards)
    date_col = next(
        (c for c in df.columns if c.upper() in ("TIME_PERIOD", "TIME", "DATE")),
        None,
    )
    value_col = next(
        (c for c in df.columns if c.upper() in ("OBS_VALUE", "VALUE")),
        None,
    )
    if not date_col or not value_col:
        raise RuntimeError(
            f"Eurostat : colonnes inattendues {list(df.columns)[:12]}"
        )

    out = pd.DataFrame(
        {
            "date_obs": pd.to_datetime(df[date_col], errors="coerce").dt.date,
            "taux_oat_10y": pd.to_numeric(df[value_col], errors="coerce"),
        }
    )
    out["source"] = "EUROSTAT"
    out = (
        out.dropna(subset=["date_obs", "taux_oat_10y"])
           .drop_duplicates(subset=["date_obs"])
           .sort_values("date_obs")
    )
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Fetcher ECB SDW (fallback secondaire — endpoints multi-candidats)
# ─────────────────────────────────────────────────────────────────────────────

def fetch_ecb_sdw(start: date | None = None) -> pd.DataFrame:
    """
    Tente plusieurs codes de série ECB SDW jusqu'à trouver celui qui marche.
    Les codes ECB changent rarement mais peuvent être réorganisés.
    """
    from io import StringIO

    last_err = None
    for url in ECB_SDW_CANDIDATES:
        try:
            params = {"format": "csvdata"}
            if start is not None:
                params["startPeriod"] = start.isoformat()
            print(f"  → ECB SDW candidate : {url}")
            resp = requests.get(
                url,
                params=params,
                headers={"Accept": "text/csv"},
                timeout=30,
            )
            if resp.status_code != 200:
                last_err = f"HTTP {resp.status_code}: {resp.text[:150]}"
                continue

            df = pd.read_csv(StringIO(resp.text))
            date_col = next(
                (c for c in df.columns if c.upper() in ("TIME_PERIOD", "DATE", "OBS_DATE")),
                None,
            )
            value_col = next(
                (c for c in df.columns if c.upper() in ("OBS_VALUE", "VALUE")),
                None,
            )
            if not date_col or not value_col:
                last_err = f"colonnes inattendues : {list(df.columns)[:8]}"
                continue
            out = pd.DataFrame(
                {
                    "date_obs": pd.to_datetime(df[date_col]).dt.date,
                    "taux_oat_10y": pd.to_numeric(df[value_col], errors="coerce"),
                }
            )
            out["source"] = "ECB_SDW"
            out = out.dropna(subset=["taux_oat_10y"]).drop_duplicates(subset=["date_obs"])
            if len(out) > 0:
                return out
            last_err = "0 ligne après parsing"
        except Exception as e:
            last_err = str(e)
            continue
    raise RuntimeError(f"Aucun endpoint ECB SDW ne fonctionne. Dernière erreur : {last_err}")


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
    """
    Cascade des sources par ordre de préférence :
      1. Eurostat (daily, gratuit, sans clé) — recommandé
      2. ECB SDW (daily, multi-endpoints)
      3. FRED (monthly, requiert FRED_API_KEY gratuite — fallback ultime)
    """
    errors: list[str] = []
    for fetcher in (fetch_eurostat, fetch_ecb_sdw, fetch_fred):
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
