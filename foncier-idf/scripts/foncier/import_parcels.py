"""Import de parcelles cadastrales depuis un fichier géographique (GeoJSON, GPKG, SHP)."""

from __future__ import annotations

import argparse
import logging

import geopandas as gpd
from psycopg2.extras import execute_values

from .db import db_cursor

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True, help="Chemin vers le fichier parcelles")
    parser.add_argument("--insee", dest="insee_code", default=None)
    args = parser.parse_args()

    gdf = gpd.read_file(args.file)

    if gdf.crs is None:
        raise ValueError("Le fichier parcelles n'a pas de CRS défini.")

    gdf = gdf.to_crs(2154)

    if args.insee_code and "insee_code" in gdf.columns:
        gdf = gdf[gdf["insee_code"] == args.insee_code].copy()

    # Mapper les noms de colonnes (adapter selon le fichier source)
    col_map = {}
    for candidate, target in [
        ("id", "parcel_id"), ("IDU", "parcel_id"), ("parcel_id", "parcel_id"),
        ("CODE_COM", "insee_code"), ("insee", "insee_code"), ("insee_code", "insee_code"),
        ("SECTION", "section"), ("section", "section"),
        ("NUMERO", "number"), ("number", "number"),
        ("NOM_COM", "city_name"), ("city_name", "city_name"), ("commune", "city_name"),
    ]:
        if candidate in gdf.columns and target not in col_map.values():
            col_map[candidate] = target

    gdf = gdf.rename(columns=col_map)

    rows = []
    for _, row in gdf.iterrows():
        parcel_id = str(row.get("parcel_id", ""))
        if not parcel_id:
            continue

        insee_code = str(row.get("insee_code", ""))
        section = str(row.get("section", "")) if row.get("section") is not None else None
        number = str(row.get("number", "")) if row.get("number") is not None else None
        area_m2 = float(row["geometry"].area)
        city_name = str(row.get("city_name", "")) if row.get("city_name") is not None else None
        geom_wkt = row["geometry"].wkt

        rows.append((parcel_id, insee_code, section, number, area_m2, city_name, geom_wkt))

    sql = """
    INSERT INTO public.parcels (
      parcel_id, insee_code, section, number, area_m2, city_name, geom
    )
    VALUES %s
    ON CONFLICT (parcel_id) DO UPDATE
    SET
      insee_code = EXCLUDED.insee_code,
      section = EXCLUDED.section,
      number = EXCLUDED.number,
      area_m2 = EXCLUDED.area_m2,
      city_name = EXCLUDED.city_name,
      geom = EXCLUDED.geom;
    """

    with db_cursor() as (conn, cur):
        execute_values(
            cur,
            sql,
            [
                (
                    r[0], r[1], r[2], r[3], r[4], r[5],
                    f"SRID=2154;{r[6]}"
                )
                for r in rows
            ],
            template="(%s,%s,%s,%s,%s,%s,ST_GeomFromEWKT(%s))",
            page_size=1000,
        )

    logger.info("Imported %s parcels", len(rows))


if __name__ == "__main__":
    main()
