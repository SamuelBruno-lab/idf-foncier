"""Pipeline complet de scoring foncier pour une commune.

Usage:
    python -m scripts.foncier.run_city --insee 92078
    python -m scripts.foncier.run_city  # toutes les communes
"""

from __future__ import annotations

import argparse
import logging
import time
from pathlib import Path

from .config import get_settings
from .db import execute_sql_file

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

SQL_DIR = Path(__file__).resolve().parent / "sql"


def run_step(name: str, sql_file: str, params: dict) -> None:
    t0 = time.time()
    logger.info("[%s] Starting...", name)
    execute_sql_file(SQL_DIR / sql_file, params)
    elapsed = time.time() - t0
    logger.info("[%s] Done in %.1fs", name, elapsed)


def main() -> None:
    parser = argparse.ArgumentParser(description="Pipeline foncier par commune")
    parser.add_argument("--insee", dest="insee_code", required=False, default=None,
                        help="Code INSEE de la commune (ex: 92078). Omit pour toutes.")
    args = parser.parse_args()

    s = get_settings()
    insee = args.insee_code

    logger.info("=== Pipeline foncier — insee=%s ===", insee or "ALL")

    # Étape 1 : building stats
    run_step("building_stats", "01_compute_building_stats.sql", {
        "insee_code": insee,
    })

    # Étape 2 : market stats
    run_step("market_stats", "02_compute_market_stats.sql", {
        "insee_code": insee,
    })

    # Étape 3 : constructibilité (avec règles PLU)
    run_step("constructibility", "03_compute_constructibility.sql", {
        "insee_code": insee,
        "default_max_height_u": s.default_max_height_u,
        "default_max_footprint_u": s.default_max_footprint_u,
        "default_green_ratio_u": s.default_green_ratio_u,
        "default_setback_penalty": s.default_setback_penalty,
        "default_parking_penalty": 1.0,  # plus de pénalité forfaitaire, coût réel dans scores
    })

    # Étape 4 : scores (sous-exploitation + marché + zonage + taille)
    run_step("scores", "04_compute_scores.sql", {
        "insee_code": insee,
    })

    logger.info("=== Pipeline foncier terminé — insee=%s ===", insee or "ALL")


if __name__ == "__main__":
    main()
