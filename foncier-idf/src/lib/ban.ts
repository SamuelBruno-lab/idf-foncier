/**
 * Client Base Adresse Nationale (api-adresse.data.gouv.fr).
 * Géocodage gratuit, sans clé, ~50 req/sec côté serveur.
 */

const BAN_URL = "https://api-adresse.data.gouv.fr/search/";

export type BanResult = {
  label: string;
  score: number;
  lat: number;
  lon: number;
  code_insee: string;
  postcode: string;
  city: string;
  context: string;
  type: string;
};

type BanFeature = {
  properties: {
    label: string;
    score: number;
    id: string;
    type: string;
    name: string;
    postcode: string;
    citycode: string;
    city: string;
    context: string;
  };
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
};

export async function searchBan(q: string, limit = 10): Promise<BanResult[]> {
  const url = new URL(BAN_URL);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("autocomplete", "0");

  const resp = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) {
    throw new Error(`BAN error ${resp.status}: ${await resp.text().catch(() => "")}`);
  }

  const data = (await resp.json()) as { features: BanFeature[] };

  return (data.features ?? []).map((f) => ({
    label: f.properties.label,
    score: f.properties.score,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    code_insee: f.properties.citycode,
    postcode: f.properties.postcode,
    city: f.properties.city,
    context: f.properties.context,
    type: f.properties.type,
  }));
}
