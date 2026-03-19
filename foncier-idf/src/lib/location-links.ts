export function isValidCoord(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function buildGoogleStreetViewUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=&layer=c&cbll=${lat},${lng}`;
}

export function buildGoogleMapsUrl(
  lat?: number | null,
  lng?: number | null,
  address?: string | null
): string {
  if (isValidCoord(lat) && isValidCoord(lng)) {
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  }

  if (address && address.trim()) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  }

  throw new Error("Impossible de construire l'URL Google Maps");
}

export function buildCadastreUrl(
  lat?: number | null,
  lng?: number | null,
  city?: string | null
): string {
  if (isValidCoord(lat) && isValidCoord(lng)) {
    return `https://www.geoportail.gouv.fr/carte?c=${lng},${lat}&z=18&l0=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:opacity(1)&permalink=yes`;
  }

  if (city && city.trim()) {
    return `https://www.geoportail.gouv.fr/carte?l0=CADASTRALPARCELS.PARCELLAIRE_EXPRESS:opacity(1)&q=${encodeURIComponent(city)}`;
  }

  return "https://www.cadastre.gouv.fr/";
}

export function openExternalUrl(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}
