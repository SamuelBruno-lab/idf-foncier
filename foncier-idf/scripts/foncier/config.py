"""Configuration du pipeline foncier."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    pg_host: str
    pg_port: int
    pg_db: str
    pg_user: str
    pg_password: str

    # Heuristiques urbanistiques par défaut
    default_max_height_u: float = 12.0
    default_max_height_au: float = 10.0
    default_max_footprint_u: float = 0.40
    default_max_footprint_au: float = 0.35
    default_green_ratio_u: float = 0.20
    default_green_ratio_au: float = 0.25
    default_setback_penalty: float = 0.85
    default_parking_penalty: float = 0.90

    # Bilan promoteur simplifié
    construction_cost_m2: float = 1300.0
    vrd_cost_m2: float = 100.0
    sales_fee_ratio: float = 0.03
    margin_ratio: float = 0.08
    sellable_ratio: float = 0.75


def get_settings() -> Settings:
    return Settings(
        pg_host=os.environ["SUPABASE_DB_HOST"],
        pg_port=int(os.environ.get("SUPABASE_DB_PORT", "5432")),
        pg_db=os.environ.get("SUPABASE_DB_NAME", "postgres"),
        pg_user=os.environ.get("SUPABASE_DB_USER", "postgres"),
        pg_password=os.environ["SUPABASE_DB_PASSWORD"],
    )
