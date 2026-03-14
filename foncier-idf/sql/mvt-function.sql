-- MVT tile generation function for the foncier layer
CREATE OR REPLACE FUNCTION public.get_mvt_tile(
  p_z INTEGER,
  p_x INTEGER,
  p_y INTEGER,
  p_min_score NUMERIC DEFAULT 0,
  p_insee TEXT DEFAULT NULL
)
RETURNS BYTEA
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  tile BYTEA;
  bounds GEOMETRY;
BEGIN
  bounds := ST_TileEnvelope(p_z, p_x, p_y);

  SELECT ST_AsMVT(mvtgeom, 'foncier', 4096, 'geom') INTO tile
  FROM (
    SELECT
      v.parcel_id,
      v.insee_code,
      v.mutability_score::real AS score,
      v.best_use,
      v.land_value_est::real AS land_value,
      v.area_m2::real AS area,
      v.estimated_gfa::real AS gfa,
      ST_AsMVTGeom(
        ST_Transform(v.geom, 3857),
        bounds,
        4096,
        256,
        true
      ) AS geom
    FROM public.v_parcel_foncier v
    WHERE v.mutability_score IS NOT NULL
      AND v.mutability_score >= p_min_score
      AND ST_Intersects(ST_Transform(v.geom, 3857), bounds)
      AND (p_insee IS NULL OR v.insee_code = p_insee)
  ) AS mvtgeom;

  RETURN tile;
END;
$$;
