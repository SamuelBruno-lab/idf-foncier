import { useState, useEffect } from "react";

export type BANSuggestion = {
  label: string;        // "5 Rue de la République 93700 Drancy"
  name: string;         // "5 Rue de la République"
  city: string;         // "Drancy"
  postcode: string;     // "93700"
  context: string;      // "93, Seine-Saint-Denis, Île-de-France"
  lat: number;
  lon: number;
  score: number;        // Pertinence 0-1
};

/**
 * Hook autocomplete adresse via API Base Adresse Nationale (BAN).
 * Service public gratuit, sans clé API, sans limite de requêtes.
 * Docs : https://adresse.data.gouv.fr/api-doc/adresse
 */
export function useBANAutocomplete(query: string, debounceMs = 250) {
  const [suggestions, setSuggestions] = useState<BANSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Évite les appels inutiles : il faut au moins 3 caractères saisis
    if (!query || query.trim().length < 3) {
      setSuggestions([]);
      return;
    }

    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(query)}&limit=5&autocomplete=1`;
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          setSuggestions([]);
          return;
        }
        const data = await res.json();
        const items: BANSuggestion[] = (data.features || []).map(
          (f: {
            properties: {
              label: string;
              name: string;
              city: string;
              postcode: string;
              context: string;
              score: number;
            };
            geometry: { coordinates: [number, number] };
          }) => ({
            label: f.properties.label,
            name: f.properties.name,
            city: f.properties.city,
            postcode: f.properties.postcode,
            context: f.properties.context,
            score: f.properties.score,
            lon: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          }),
        );
        setSuggestions(items);
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setSuggestions([]);
        }
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, debounceMs]);

  return { suggestions, loading };
}
