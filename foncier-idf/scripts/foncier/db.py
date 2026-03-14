"""Utilitaires de connexion PostgreSQL."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from pathlib import Path

import psycopg2
from psycopg2.extras import RealDictCursor

from .config import get_settings

logger = logging.getLogger(__name__)


def get_connection():
    s = get_settings()
    return psycopg2.connect(
        host=s.pg_host,
        port=s.pg_port,
        dbname=s.pg_db,
        user=s.pg_user,
        password=s.pg_password,
        cursor_factory=RealDictCursor,
    )


@contextmanager
def db_cursor():
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            yield conn, cur
        conn.commit()
    except Exception:
        conn.rollback()
        logger.exception("Transaction rolled back due to error.")
        raise
    finally:
        conn.close()


def execute_sql_file(path: str | Path, params: dict | None = None) -> None:
    sql = Path(path).read_text(encoding="utf-8")
    with db_cursor() as (conn, cur):
        logger.info("Executing SQL file: %s", path)
        cur.execute(sql, params or {})


def fetch_all(sql: str, params: dict | None = None) -> list[dict]:
    with db_cursor() as (conn, cur):
        cur.execute(sql, params or {})
        return list(cur.fetchall())


def execute(sql: str, params: dict | None = None) -> None:
    with db_cursor() as (conn, cur):
        cur.execute(sql, params or {})
