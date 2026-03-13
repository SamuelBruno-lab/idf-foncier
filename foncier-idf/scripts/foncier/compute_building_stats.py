"""Calcule l'emprise bâtie par parcelle (intersection parcelles × bâtiments)."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from .db import execute_sql_file

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--insee", dest="insee_code", default=None)
    args = parser.parse_args()

    sql_path = Path(__file__).parent / "sql" / "01_compute_building_stats.sql"
    execute_sql_file(sql_path, {"insee_code": args.insee_code})
    logger.info("Building stats computed for insee=%s", args.insee_code)


if __name__ == "__main__":
    main()
