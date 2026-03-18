"use client";

import {
  buildGoogleStreetViewUrl,
  buildGoogleMapsUrl,
  buildCadastreUrl,
  isValidCoord,
  openExternalUrl,
} from "@/lib/location-links";

type LocationActionButtonsProps = {
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
  city?: string | null;
  className?: string;
};

function ActionButton({
  children,
  onClick,
  disabled = false,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="inline-flex items-center justify-center rounded-lg border border-neutral-200 px-3 py-2 text-xs font-medium transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export default function LocationActionButtons({
  lat,
  lng,
  address,
  city,
  className = "",
}: LocationActionButtonsProps) {
  const hasCoords = isValidCoord(lat) && isValidCoord(lng);
  const hasAddress = typeof address === "string" && address.trim().length > 0;
  const hasCity = typeof city === "string" && city.trim().length > 0;

  const handleStreetView = () => {
    if (!hasCoords) return;
    openExternalUrl(buildGoogleStreetViewUrl(lat as number, lng as number));
  };

  const handleGoogleMaps = () => {
    try {
      openExternalUrl(buildGoogleMapsUrl(lat, lng, address));
    } catch {
      /* no valid location */
    }
  };

  const handleCadastre = () => {
    openExternalUrl(buildCadastreUrl(lat, lng, city));
  };

  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      <ActionButton
        onClick={handleStreetView}
        disabled={!hasCoords}
        title={hasCoords ? "Ouvrir Street View" : "Coordonnees indisponibles"}
      >
        Voir l&apos;environnement
      </ActionButton>

      <ActionButton
        onClick={handleGoogleMaps}
        disabled={!hasCoords && !hasAddress}
        title="Ouvrir dans Google Maps"
      >
        Google Maps
      </ActionButton>

      <ActionButton
        onClick={handleCadastre}
        disabled={!hasCoords && !hasCity}
        title="Voir le cadastre"
      >
        Cadastre
      </ActionButton>
    </div>
  );
}
