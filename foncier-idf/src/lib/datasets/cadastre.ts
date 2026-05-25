/**
 * DATAMERRY — Parcelle cadastrale par adresse (lat/lon).
 *
 * Source : api-carto IGN — endpoint cadastre
 *   https://apicarto.ign.fr/api/cadastre/parcelle
 *   Gratuit, illimité, format GeoJSON
 *
 * Renvoie la parcelle qui contient le point (section + numéro + surface
 * cadastrale en m²) — utile pour l'agent immo qui veut argumenter sur la
 * taille du terrain (maison) ou le n° de lot (copro).
 *
 * Cache : 365 jours (les parcelles bougent très peu).
 */

import { addressHash, fetchWithCache } from "./_cache";

const APICARTO_URL = "https://apicarto.ign.fr/api/cadastre/parcelle";
const TTL_DAYS = 365;

export type ParcelleCadastre = {
  available: boolean;
  insee_commune: string | null;
  section: string | null;
  numero: string | null;
  surface_m2: number | null;
  prefixe: string | null;
  feuille: number | null;
  source: string;
};

async function fetchParcelleFromApiCarto(
  lat: number,
  lon: number,
): Promise<ParcelleCadastre> {
  // api-carto attend un GeoJSON Point en query param `geom`
  const geom = JSON.stringify({
    type: "Point",
    coordinates: [lon, lat], // GeoJSON = [lon, lat]
  });
  const url = `${APICARTO_URL}?geom=${encodeURIComponent(geom)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    console.warn("[cadastre] api-carto timeout:", err);
    return emptyParcelle();
  }

  if (!res.ok) return emptyParcelle();
  const json = (await res.json()) as {
    features?: Array<{
      properties?: {
        code_insee?: string;
        section?: string;
        numero?: string;
        contenance?: number;
        prefixe?: string;
        feuille?: number;
      };
    }>;
  };

  const first = json.features?.[0]?.properties;
  if (!first) return emptyParcelle();

  return {
    available: true,
    insee_commune: first.code_insee ?? null,
    section: first.section ?? null,
    numero: first.numero ?? null,
    surface_m2: first.contenance ?? null, // contenance cadastrale = surface en m²
    prefixe: first.prefixe ?? null,
    feuille: first.feuille ?? null,
    source: "api-carto IGN (cadastre)",
  };
}

function emptyParcelle(): ParcelleCadastre {
  return {
    available: false,
    insee_commune: null,
    section: null,
    numero: null,
    surface_m2: null,
    prefixe: null,
    feuille: null,
    source: "api-carto IGN (cadastre)",
  };
}

export async function getParcelle(
  lat: number,
  lon: number,
): Promise<ParcelleCadastre & { cached: boolean }> {
  const hash = addressHash(lat, lon);
  const { data, cached } = await fetchWithCache<ParcelleCadastre>(
    hash,
    { lat, lon },
    "cadastre",
    TTL_DAYS,
    () => fetchParcelleFromApiCarto(lat, lon),
    0,
  );
  return { ...data, cached };
}
