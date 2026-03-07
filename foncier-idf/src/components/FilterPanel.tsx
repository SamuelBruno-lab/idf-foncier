"use client";

import { useState, useEffect } from "react";
import type { DvfFilters } from "@/types/dvf";

const DEPTS_IDF = [
  { code: "75", nom: "Paris" },
  { code: "77", nom: "Seine-et-Marne" },
  { code: "78", nom: "Yvelines" },
  { code: "91", nom: "Essonne" },
  { code: "92", nom: "Hauts-de-Seine" },
  { code: "93", nom: "Seine-Saint-Denis" },
  { code: "94", nom: "Val-de-Marne" },
  { code: "95", nom: "Val-d'Oise" },
  { code: "60", nom: "Oise" },
];

const TYPES = ["Appartement", "Maison", "Local industriel. commercial ou assimilé"];

interface Props {
  filters: DvfFilters;
  onFiltersChange: (f: DvfFilters) => void;
  mode: "clusters" | "heatmap";
  onModeChange: (m: "clusters" | "heatmap") => void;
  colorBy: "prix" | "rendement";
  onColorByChange: (c: "prix" | "rendement") => void;
  onLeadClick: () => void;
  totalTx: number;
}

export default function FilterPanel({ filters, onFiltersChange, mode, onModeChange, colorBy, onColorByChange, onLeadClick, totalTx }: Props) {
  const isCommercial = filters.type_local?.[0] === "Local industriel. commercial ou assimilé";
  const rendementDisabled = isCommercial || mode === "heatmap";
  const [open, setOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const toggleDept = (code: string) => {
    const current = filters.dept ?? [];
    const next = current.includes(code) ? current.filter((d) => d !== code) : [...current, code];
    onFiltersChange({ ...filters, dept: next.length === 0 ? undefined : next });
  };

  const panelBody = (
    <div style={{ padding: "14px 16px" }}>
      {/* Mode vue */}
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,.4)", marginBottom: 6 }}>Mode</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {(["clusters", "heatmap"] as const).map((m) => (
          <button key={m} onClick={() => onModeChange(m)} style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "1px solid", borderColor: mode === m ? "#00d4ff" : "rgba(255,255,255,0.15)", background: mode === m ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.05)", color: mode === m ? "#00d4ff" : "#aaa", cursor: "pointer", fontSize: 11, fontWeight: mode === m ? 700 : 400 }}>
            {m === "clusters" ? "Zones" : "Heatmap"}
          </button>
        ))}
      </div>

      {/* Toggle Vue : Prix vs Rendement */}
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,.4)", marginBottom: 6 }}>Vue</div>
      <div style={{ display: "flex", gap: 6, marginBottom: rendementDisabled ? 4 : 14 }}>
        {(["prix", "rendement"] as const).map((c) => {
          const active = colorBy === c && !rendementDisabled;
          const disabled = c === "rendement" && rendementDisabled;
          return (
            <button key={c} onClick={() => !disabled && onColorByChange(c)} title={disabled ? "Non disponible pour ce type de bien" : undefined} style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "1px solid", borderColor: active ? "#00ff88" : "rgba(255,255,255,0.15)", background: active ? "rgba(0,255,136,0.12)" : "rgba(255,255,255,0.05)", color: disabled ? "#333" : active ? "#00ff88" : "#aaa", cursor: disabled ? "not-allowed" : "pointer", fontSize: 11, fontWeight: active ? 700 : 400 }}>
              {c === "prix" ? "Prix/m²" : "Rendement"}
            </button>
          );
        })}
      </div>
      {rendementDisabled && (
        <div style={{ fontSize: 10, color: "rgba(255,180,0,0.5)", marginBottom: 14, padding: "4px 8px", background: "rgba(255,180,0,0.05)", borderRadius: 5, border: "1px solid rgba(255,180,0,0.12)" }}>
          {mode === "heatmap" ? "Rendement en mode Zones uniquement" : "Rendement non disponible pour ce type"}
        </div>
      )}

      {/* Hint */}
      <div style={{ fontSize: 10, color: "rgba(0,212,255,0.5)", marginBottom: 14, padding: "5px 8px", background: "rgba(0,212,255,0.05)", borderRadius: 5, border: "1px solid rgba(0,212,255,0.12)" }}>
        💡 Clic sur une zone → fiche analyse
      </div>

      {/* Départements */}
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,.4)", marginBottom: 6 }}>Départements IDF</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 14 }}>
        {DEPTS_IDF.map(({ code, nom }) => {
          const active = !filters.dept || filters.dept.includes(code);
          return (
            <button key={code} onClick={() => toggleDept(code)} title={nom} style={{ padding: "3px 8px", borderRadius: 4, border: "1px solid", borderColor: active ? "#00d4ff" : "rgba(255,255,255,0.15)", background: active ? "rgba(0,212,255,0.15)" : "rgba(255,255,255,0.04)", color: active ? "#00d4ff" : "#666", cursor: "pointer", fontSize: 12, fontWeight: active ? 700 : 400 }}>
              {code}
            </button>
          );
        })}
      </div>

      {/* Type de bien */}
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,.4)", marginBottom: 6 }}>Type de bien</div>
      <select value={filters.type_local?.[0] ?? "Appartement"} onChange={(e) => onFiltersChange({ ...filters, type_local: [e.target.value] })} style={{ width: "100%", background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", color: "#ccc", borderRadius: 6, padding: "6px 8px", fontSize: 12, marginBottom: 14 }}>
        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>

      {/* Années */}
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "rgba(255,255,255,.4)", marginBottom: 6 }}>Période</div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {[2020, 2021, 2022, 2023, 2024, 2025].map((y) => {
          const active = !filters.annee || filters.annee.includes(y);
          return (
            <button key={y} onClick={() => { const cur = filters.annee ?? [2020, 2021, 2022, 2023, 2024, 2025]; const next = cur.includes(y) ? cur.filter((a) => a !== y) : [...cur, y]; onFiltersChange({ ...filters, annee: next.length === 6 ? undefined : next }); }} style={{ flex: 1, padding: "3px 0", borderRadius: 4, border: "1px solid", borderColor: active ? "#ff6600" : "rgba(255,255,255,0.1)", background: active ? "rgba(255,102,0,0.12)" : "rgba(255,255,255,0.03)", color: active ? "#ff8844" : "#555", cursor: "pointer", fontSize: 10, fontWeight: active ? 700 : 400 }}>
              {String(y).slice(2)}
            </button>
          );
        })}
      </div>

      {/* CTA lead */}
      <button onClick={onLeadClick} style={{ width: "100%", padding: "9px 0", borderRadius: 8, border: "1px solid rgba(168,85,247,0.4)", background: "linear-gradient(135deg, rgba(168,85,247,0.18), rgba(124,58,237,0.12))", color: "#c084fc", fontWeight: 700, fontSize: 12, cursor: "pointer", marginBottom: 12, fontFamily: "Segoe UI, Arial, sans-serif", letterSpacing: 0.3 }}>
        Être contacté par un expert →
      </button>

      <div style={{ fontSize: 10, color: "rgba(255,255,255,.25)", textAlign: "center", paddingTop: 8, borderTop: "1px solid rgba(255,255,255,.06)" }}>
        datamerry.com · Source DVF data.gouv.fr
      </div>
    </div>
  );

  const panelHeader = (onClose?: () => void) => (
    <div style={{ background: "linear-gradient(90deg, #00d4ff22, #ff005522)", padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#fff" }}>datamerry</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,.5)", marginTop: 2 }}>{totalTx.toLocaleString("fr-FR")} transactions visibles</div>
      </div>
      {onClose ? (
        <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,.5)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
      ) : (
        <button onClick={() => setOpen(!open)} style={{ background: "none", border: "none", color: "rgba(255,255,255,.5)", cursor: "pointer", fontSize: 16 }}>{open ? "▲" : "▼"}</button>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <>
        {/* FAB mobile */}
        {!mobileOpen && (
          <button
            onClick={() => setMobileOpen(true)}
            style={{
              position: "fixed",
              bottom: 20,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 900,
              background: "linear-gradient(135deg, rgba(10,10,30,0.97), rgba(20,20,50,0.97))",
              border: "1px solid rgba(0,212,255,0.4)",
              borderRadius: 99,
              padding: "10px 24px",
              color: "#00d4ff",
              fontWeight: 700,
              fontSize: 13,
              cursor: "pointer",
              fontFamily: "Segoe UI, Arial, sans-serif",
              boxShadow: "0 4px 24px rgba(0,0,0,0.7)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              whiteSpace: "nowrap",
            }}
          >
            ☰ Filtres · {totalTx.toLocaleString("fr-FR")} tx
          </button>
        )}

        {/* Bottom sheet */}
        {mobileOpen && (
          <div style={{ position: "fixed", inset: 0, zIndex: 2000 }}>
            <div onClick={() => setMobileOpen(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)" }} />
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "linear-gradient(180deg, #0d0d2b, #0a0a1e)", borderRadius: "18px 18px 0 0", maxHeight: "85vh", overflowY: "auto", fontFamily: "Segoe UI, Arial, sans-serif", color: "#e8e8f0" }}>
              {/* Handle */}
              <div style={{ display: "flex", justifyContent: "center", padding: "10px 0 0" }}>
                <div style={{ width: 40, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.2)" }} />
              </div>
              {panelHeader(() => setMobileOpen(false))}
              {panelBody}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div style={{ position: "absolute", top: 12, left: 12, zIndex: 900, background: "linear-gradient(135deg, rgba(10,10,30,0.97), rgba(20,20,50,0.97))", color: "#e8e8f0", borderRadius: 12, width: 260, border: "1px solid rgba(255,255,255,0.1)", boxShadow: "0 8px 32px rgba(0,0,0,0.6)", fontFamily: "Segoe UI, Arial, sans-serif", overflow: "hidden" }}>
      {panelHeader()}
      {open && panelBody}
    </div>
  );
}
