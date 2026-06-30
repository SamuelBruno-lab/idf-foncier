"use client";

/**
 * Autocomplete d'adresse française via l'API BAN (Base Adresse Nationale).
 * https://adresse.data.gouv.fr/api-doc/adresse
 *
 * Gratuit, sans clé API, mise à jour quotidienne par la DINUM.
 * Couvre toute la France métropolitaine + DOM.
 */

import { useEffect, useRef, useState } from "react";

const BORDER = "#e2e8f0";
const PRIMARY = "#c8a25d";
const DARK = "#0f172a";
const MUTED = "#64748b";

type BANFeature = {
  properties: {
    label: string;
    score: number;
    housenumber?: string;
    name?: string;
    postcode?: string;
    citycode?: string;
    city?: string;
    context?: string;
    type: "housenumber" | "street" | "locality" | "municipality";
  };
  geometry?: {
    coordinates?: [number, number]; // [lon, lat]
  };
};

interface Props {
  value: string;
  onChange: (label: string) => void;
  onSelect?: (data: {
    label: string;
    housenumber?: string;
    street?: string;
    postcode?: string;
    city?: string;
    citycode?: string;
    coords?: [number, number];
  }) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
}

export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder = "Saisis l'adresse — ex. 109 rue Constant Coquelin Vitry",
  required = false,
  disabled = false,
}: Props) {
  const [suggestions, setSuggestions] = useState<BANFeature[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [loading, setLoading] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Click hors composant → ferme le dropdown
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleInputChange(newValue: string) {
    onChange(newValue);
    setHighlightIndex(-1);

    // Cancel pending debounce + request
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (newValue.trim().length < 3) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);

      const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(newValue)}&limit=5&autocomplete=1`;

      fetch(url, { signal: controller.signal })
        .then((res) => res.json())
        .then((data: { features: BANFeature[] }) => {
          setSuggestions(data.features ?? []);
          setShowDropdown(true);
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          setSuggestions([]);
          setLoading(false);
        });
    }, 250);
  }

  function selectSuggestion(s: BANFeature) {
    const p = s.properties;
    onChange(p.label);
    onSelect?.({
      label: p.label,
      housenumber: p.housenumber,
      street: p.name,
      postcode: p.postcode,
      city: p.city,
      citycode: p.citycode,
      coords: s.geometry?.coordinates,
    });
    setShowDropdown(false);
    setHighlightIndex(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showDropdown || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && highlightIndex >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[highlightIndex]);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        type="text"
        value={value}
        onChange={(e) => handleInputChange(e.target.value)}
        onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete="off"
        style={{
          width: "100%",
          padding: "8px 10px",
          paddingRight: loading ? 32 : 10,
          border: `1px solid ${BORDER}`,
          borderRadius: 6,
          fontSize: 13,
          color: DARK,
          background: "white",
          fontFamily: "inherit",
        }}
      />

      {loading && (
        <span
          style={{
            position: "absolute",
            right: 10,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 11,
            color: MUTED,
          }}
        >
          …
        </span>
      )}

      {showDropdown && suggestions.length > 0 && (
        <ul
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            right: 0,
            background: "white",
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            listStyle: "none",
            margin: 0,
            padding: 4,
            zIndex: 50,
            maxHeight: 280,
            overflowY: "auto",
          }}
        >
          {suggestions.map((s, i) => {
            const p = s.properties;
            const isActive = i === highlightIndex;
            return (
              <li
                key={`${p.label}-${i}`}
                onClick={() => selectSuggestion(s)}
                onMouseEnter={() => setHighlightIndex(i)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 4,
                  cursor: "pointer",
                  background: isActive ? `${PRIMARY}20` : "transparent",
                  fontSize: 12,
                  lineHeight: 1.4,
                }}
              >
                <div style={{ fontWeight: 600, color: DARK }}>
                  {p.label}
                </div>
                {p.context && (
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 1 }}>
                    {p.context} ·{" "}
                    {p.type === "housenumber"
                      ? "📍 numéro"
                      : p.type === "street"
                        ? "🛣 rue"
                        : p.type === "municipality"
                          ? "🏛 commune"
                          : "📌 lieu-dit"}
                  </div>
                )}
              </li>
            );
          })}
          <li
            style={{
              padding: "6px 10px",
              fontSize: 10,
              color: MUTED,
              borderTop: `1px solid ${BORDER}`,
              marginTop: 4,
              textAlign: "right",
            }}
          >
            Source : Base Adresse Nationale (BAN) · DINUM
          </li>
        </ul>
      )}
    </div>
  );
}
