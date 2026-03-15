-- parcels_bbox RPC (used by pipeline to get commune extent for WFS query)
CREATE OR REPLACE FUNCTION public.parcels_bbox(code_insee TEXT)
RETURNS TABLE(xmin FLOAT, ymin FLOAT, xmax FLOAT, ymax FLOAT)
LANGUAGE sql STABLE
AS $$
  SELECT
    ST_XMin(ST_Transform(ST_SetSRID(ST_Extent(geom), 2154), 4326))::float AS xmin,
    ST_YMin(ST_Transform(ST_SetSRID(ST_Extent(geom), 2154), 4326))::float AS ymin,
    ST_XMax(ST_Transform(ST_SetSRID(ST_Extent(geom), 2154), 4326))::float AS xmax,
    ST_YMax(ST_Transform(ST_SetSRID(ST_Extent(geom), 2154), 4326))::float AS ymax
  FROM public.parcels
  WHERE insee_code = code_insee;
$$;

-- ingest_buildings_batch RPC (WGS84 → Lambert93 building import from BD TOPO)
CREATE OR REPLACE FUNCTION public.ingest_buildings_batch(buildings_json TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  rec RECORD;
  cnt INTEGER := 0;
BEGIN
  FOR rec IN
    SELECT
      j->>'building_id' AS building_id,
      j->>'source' AS source,
      (j->>'levels_est')::integer AS levels_est,
      (j->>'footprint_m2')::numeric AS footprint_m2,
      j->>'insee_code' AS insee_code,
      j->>'geojson' AS geojson
    FROM jsonb_array_elements(buildings_json::jsonb) AS j
  LOOP
    INSERT INTO public.buildings (building_id, source, levels_est, footprint_m2, insee_code, geom)
    VALUES (
      rec.building_id,
      rec.source,
      rec.levels_est,
      rec.footprint_m2,
      rec.insee_code,
      ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(rec.geojson), 4326), 2154))
    )
    ON CONFLICT (building_id) DO UPDATE SET
      source = EXCLUDED.source,
      levels_est = EXCLUDED.levels_est,
      footprint_m2 = EXCLUDED.footprint_m2,
      insee_code = EXCLUDED.insee_code,
      geom = EXCLUDED.geom;
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;

NOTIFY pgrst, 'reload schema';
