"""Rattache chaque parcelle aux stats marché DVF communales."""

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

    sql_path = Path(__file__).parent / "sql" / "02_compute_market_stats.sql"
    execute_sql_file(sql_path, {"insee_code": args.insee_code})
    logger.info("Market stats computed for insee=%s", args.insee_code)


if __name__ == "__main__":
    main()
