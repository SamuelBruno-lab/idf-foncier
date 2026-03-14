"""Import de bâtiments depuis un fichier géographique (GeoJSON, GPKG, SHP)."""

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
    parser.add_argument("--file", required=True, help="Chemin vers le fichier bâtiments")
    args = parser.parse_args()

    gdf = gpd.read_file(args.file)

    if gdf.crs is None:
        raise ValueError("Le fichier bâtiments n'a pas de CRS défini.")

    gdf = gdf.to_crs(2154)

    rows = []
    for idx, row in gdf.iterrows():
        building_id = str(row.get("building_id", row.get("id", f"bld_{idx}")))
        source = str(row.get("source", "import")) if row.get("source") is not None else "import"
        levels_est = int(row.get("levels_est", row.get("NOMBRE_DE_", row.get("hauteur", 1)))) if row.get("levels_est") or row.get("NOMBRE_DE_") or row.get("hauteur") else 1
        footprint_m2 = float(row["geometry"].area)
        geom_wkt = row["geometry"].wkt

        rows.append((building_id, source, levels_est, footprint_m2, geom_wkt))

    sql = """
    INSERT INTO public.buildings (
      building_id, source, levels_est, footprint_m2, geom
    )
    VALUES %s
    ON CONFLICT (building_id) DO UPDATE
    SET
      source = EXCLUDED.source,
      levels_est = EXCLUDED.levels_est,
      footprint_m2 = EXCLUDED.footprint_m2,
      geom = EXCLUDED.geom;
    """

    with db_cursor() as (conn, cur):
        execute_values(
            cur,
            sql,
            [
                (
                    r[0], r[1], r[2], r[3],
                    f"SRID=2154;{r[4]}"
                )
                for r in rows
            ],
            template="(%s,%s,%s,%s,ST_GeomFromEWKT(%s))",
            page_size=1000,
        )

    logger.info("Imported %s buildings", len(rows))


if __name__ == "__main__":
    main()
