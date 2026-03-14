"""Calcule le score final de mutabilité par parcelle."""

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
    sql_path = Path(__file__).parent / "sql" / "04_compute_scores.sql"

    execute_sql_file(
        sql_path,
        {
            "insee_code": args.insee_code,
            "sellable_ratio": s.sellable_ratio,
            "construction_cost_m2": s.construction_cost_m2,
            "vrd_cost_m2": s.vrd_cost_m2,
            "sales_fee_ratio": s.sales_fee_ratio,
            "margin_ratio": s.margin_ratio,
            "parking_cost_per_place": s.parking_cost_per_place,
            "parking_surface_per_place": s.parking_surface_per_place,
            "taxe_valeur_forfaitaire": s.taxe_amenagement_valeur_forfaitaire,
            "taxe_taux_default": s.taxe_amenagement_taux_default,
        },
    )
    logger.info("Scores computed for insee=%s", args.insee_code)


if __name__ == "__main__":
    main()
