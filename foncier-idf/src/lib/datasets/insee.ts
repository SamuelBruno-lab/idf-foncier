/**
 * DATAMERRY — INSEE Filosofi socio-démographique par IRIS.
 *
 * Source : data.gouv.fr — dataset `revenus-pauvrete-menages-fichier-localise-social-fiscal-iris`
 *   API ODS : https://data.opendatasoft.com/explore/?refine.publisher=INSEE
 *   Alternative : data.gouv.fr direct
 *
 * Couverture : tous les IRIS de France (≈ 50 000 IRIS, échelle infra-communale).
 * Mise à jour : annuelle.
 *
 * Renvoie :
 *   - Revenu fiscal médian par UC (Unité de Consommation)
 *   - % de propriétaires occupants
 *   - % CSP+ (cadres et professions intellectuelles supérieures)
 *   - Densité population
 *
 * Caveat : pour récupérer l'IRIS d'une adresse, il faut un référentiel
 * géographique. Approche pragmatique : on cherche directement par lat/lon
 * via une jointure spatiale côté API publique (ou approximation par INSEE
 * commune si IRIS introuvable).
 *
 * Cache : 365 jours (data INSEE annuelle, lente à bouger).
 */

import { addressHash, fetchWithCache } from "./_cache";

const TTL_DAYS = 365;
// Alternative : utiliser geo.api.gouv.fr pour le reverse lookup IRIS depuis lat/lon
const REVERSE_IRIS_URL = "https://api-adresse.data.gouv.fr/reverse/";

export type InseeIris = {
  available: boolean;
  iris_code: string | null;
  iris_label: string | null;
  insee_commune: string | null;
  revenu_median_uc_eur: number | null;
  taux_proprietaires_pct: number | null;
  taux_csp_plus_pct: number | null;
  population_municipale: number | null;
  source: string;
  todo?: string;
};

// ──────────────────────────────────────────────────────────────────────────────
// Étape 1 — Reverse geocoding IRIS via api-adresse data.gouv.fr
// ──────────────────────────────────────────────────────────────────────────────

async function findIrisCode(lat: number, lon: number): Promise<string | null> {
  // api-adresse renvoie le code IRIS dans les properties si disponible
  const url = `${REVERSE_IRIS_URL}?lat=${lat}&lon=${lon}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      features?: Array<{
        properties?: { citycode?: string; postcode?: string; context?: string };
      }>;
    };
    // api-adresse ne renvoie pas IRIS direct. À enrichir Phase 10C+.
    // Pour MVP, on renvoie au moins le code commune INSEE et on marque
    // l'IRIS comme "à enrichir" — le tool reste utile pour le rapport.
    const props = json.features?.[0]?.properties;
    return props?.citycode ?? null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Étape 2 — Récupération données Filosofi
// ──────────────────────────────────────────────────────────────────────────────

async function fetchInseeFromCommune(
  insee_commune: string,
): Promise<InseeIris> {
  // MVP : utilise l'API publique de geo.api.gouv.fr qui agrège des données
  // INSEE basiques (population) — sans accès direct Filosofi gratuit par
  // une API REST stable. Pour Filosofi complet, il faudrait ingérer le
  // CSV national dans une table Supabase (Phase 10C+).
  const url = `https://geo.api.gouv.fr/communes/${insee_commune}?fields=nom,population,centre`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      return {
        available: false,
        iris_code: null,
        iris_label: null,
        insee_commune,
        revenu_median_uc_eur: null,
        taux_proprietaires_pct: null,
        taux_csp_plus_pct: null,
        population_municipale: null,
        source: "geo.api.gouv.fr (subset INSEE)",
        todo:
          "Filosofi IRIS complet à venir — nécessite ingestion CSV INSEE " +
          "dans table Supabase fact_filosofi_iris (Phase 10D).",
      };
    }
    const json = (await res.json()) as {
      nom?: string;
      population?: number;
      centre?: unknown;
    };
    return {
      available: true,
      iris_code: null, // pas dispo dans cette source MVP
      iris_label: json.nom ?? null,
      insee_commune,
      revenu_median_uc_eur: null,
      taux_proprietaires_pct: null,
      taux_csp_plus_pct: null,
      population_municipale: json.population ?? null,
      source: "geo.api.gouv.fr (subset INSEE) — données MVP",
      todo:
        "Revenu médian + taux propriétaires + CSP+ à venir post ingestion " +
        "Filosofi IRIS (~1 jour de pipeline). En attendant, l'agent peut " +
        "indiquer ces infos manuellement.",
    };
  } catch (err) {
    console.warn("[insee] geo.api.gouv.fr failed:", err);
    return {
      available: false,
      iris_code: null,
      iris_label: null,
      insee_commune,
      revenu_median_uc_eur: null,
      taux_proprietaires_pct: null,
      taux_csp_plus_pct: null,
      population_municipale: null,
      source: "geo.api.gouv.fr (subset INSEE)",
    };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// API publique
// ──────────────────────────────────────────────────────────────────────────────

export async function getInseeIris(
  lat: number,
  lon: number,
  fallbackInsee?: string,
): Promise<InseeIris & { cached: boolean }> {
  const hash = addressHash(lat, lon);
  const { data, cached } = await fetchWithCache<InseeIris>(
    hash,
    { lat, lon },
    "insee_iris",
    TTL_DAYS,
    async () => {
      const insee = (await findIrisCode(lat, lon)) ?? fallbackInsee ?? null;
      if (!insee) {
        return {
          available: false,
          iris_code: null,
          iris_label: null,
          insee_commune: null,
          revenu_median_uc_eur: null,
          taux_proprietaires_pct: null,
          taux_csp_plus_pct: null,
          population_municipale: null,
          source: "n/a",
        };
      }
      return await fetchInseeFromCommune(insee);
    },
    0,
  );
  return { ...data, cached };
}
