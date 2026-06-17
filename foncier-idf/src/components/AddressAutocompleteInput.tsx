"use client";

import { useState } from "react";
import { useBANAutocomplete, type BANSuggestion } from "@/hooks/useBANAutocomplete";

type Props = {
  value: string;
  onChange: (value: string, suggestion?: BANSuggestion) => void;
  placeholder?: string;
  primaryColor?: string;
};

export function AddressAutocompleteInput({
  value,
  onChange,
  placeholder = "Tapez votre adresse...",
  primaryColor = "#1f3a8a",
}: Props) {
  const [focused, setFocused] = useState(false);
  const { suggestions, loading } = useBANAutocomplete(value);

  const handleSelect = (s: BANSuggestion) => {
    onChange(s.label, s);
    setFocused(false);
  };

  const showDropdown = focused && suggestions.length > 0;

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "12px 16px",
          fontSize: 15,
          borderRadius: 8,
          border: `1px solid ${focused ? primaryColor : "#cbd5e1"}`,
          outline: "none",
          boxSizing: "border-box",
          transition: "border-color 0.15s",
        }}
        autoComplete="off"
      />

      {loading && value.length >= 3 && (
        <div
          style={{
            position: "absolute",
            right: 12,
            top: "50%",
            transform: "translateY(-50%)",
            fontSize: 11,
            color: "#94a3b8",
          }}
        >
          ...
        </div>
      )}

      {showDropdown && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            background: "white",
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            marginTop: 4,
            maxHeight: 280,
            overflowY: "auto",
            zIndex: 50,
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          }}
        >
          {suggestions.map((s, i) => (
            <div
              key={`${s.label}-${i}`}
              onMouseDown={() => handleSelect(s)}
              style={{
                padding: "10px 14px",
                cursor: "pointer",
                borderBottom:
                  i < suggestions.length - 1 ? "1px solid #f1f5f9" : "none",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "#f8fafc")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
            >
              <div
                style={{
                  fontWeight: 600,
                  color: "#0f172a",
                  fontSize: 14,
                }}
              >
                {s.label}
              </div>
              <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                {s.context}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
