"""Calcule la constructibilité heuristique par parcelle."""

from __future__ import annotations

import argparse
import logging
from pathlib import Path

from .config import get_settings
from .db import execute_sql_file

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--insee", dest="insee_code", default=None)
    args = parser.parse_args()

    s = get_settings()
    sql_path = Path(__file__).parent / "sql" / "03_compute_constructibility.sql"

    execute_sql_file(
        sql_path,
        {
            "insee_code": args.insee_code,
            "default_max_height_u": s.default_max_height_u,
            "default_max_footprint_u": s.default_max_footprint_u,
            "default_green_ratio_u": s.default_green_ratio_u,
            "default_setback_penalty": s.default_setback_penalty,
            "default_parking_penalty": s.default_parking_penalty,
        },
    )
    logger.info("Constructibility computed for insee=%s", args.insee_code)


if __name__ == "__main__":
    main()
