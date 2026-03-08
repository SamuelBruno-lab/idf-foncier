"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import FilterPanel from "@/components/FilterPanel";
import LeadModal from "@/components/LeadModal";
import type { DvfFilters, DvfPoint, DvfCluster } from "@/types/dvf";

const DvfMap = dynamic(() => import("@/components/DvfMap"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", background: "#0a0a1e", display: "flex", alignItems: "center", justifyContent: "center", color: "#00d4ff", fontFamily: "Segoe UI, sans-serif", fontSize: 14 }}>
      Chargement de la carte…
    </div>
  ),
});

const DEPT_INFO: Record<string, { nom: string; color: string; description: string }> = {
  "75": { nom: "Paris", color: "#ef4444", description: "Le marché le plus dense d'IDF · prix médian ~10 000€/m²" },
  "92": { nom: "Hauts-de-Seine", color: "#00d4ff", description: "Neuilly, Boulogne, Levallois · marché premium" },
  "93": { nom: "Seine-Saint-Denis", color: "#00ff88", description: "Fort potentiel locatif · prix accessibles" },
  "94": { nom: "Val-de-Marne", color: "#a78bfa", description: "Vincennes, Créteil · marché équilibré" },
  "95": { nom: "Val-d'Oise", color: "#f59e0b", description: "Cergy, Argenteuil · prix attractifs en périphérie" },
  "91": { nom: "Essonne", color: "#10b981", description: "Évry, Massy · fort rendement locatif" },
  "77": { nom: "Seine-et-Marne", color: "#f97316", description: "Melun, Meaux · marché maisons en plein essor" },
  "60": { nom: "Oise", color: "#ec4899", description: "Creil, Senlis · hors IDF, prix accessibles" },
};

type CommuneSuggestion = { code: string; nom: string };

export default function DeptPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const dept = DEPT_INFO[code] ?? { nom: `Département ${code}`, color: "#00d4ff", description: "" };

  const [filters, setFilters] = useState<DvfFilters>({ type_local: ["Appartement"], dept: [code] });
  const [mode, setMode] = useState<"clusters" | "heatmap">("clusters");
  const [points, setPoints] = useState<DvfPoint[]>([]);
  const [clusters, setClusters] = useState<DvfCluster[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [zoom] = useState(11);
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [colorBy, setColorBy] = useState<"prix" | "rendement">("rendement");
  const [showHeader, setShowHeader] = useState(true);

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CommuneSuggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchQuery.length < 2) { setSuggestions([]); return; }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/communes/search?q=${encodeURIComponent(searchQuery)}&dept=${code}`);
        setSuggestions(await res.json());
      } finally {
        setSearchLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, code]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSuggestions([]);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("dept", code);
      if (filters.type_local?.length) params.set("type_local", filters.type_local[0]);
      if (filters.annee?.length) {
        params.set("annee_min", String(Math.min(...filters.annee)));
        params.set("annee_max", String(Math.max(...filters.annee)));
      }
      params.set("zoom", String(zoom));
      params.set("mode", mode);

      const res = await fetch(`/api/dvf/clusters?${params}`);
      const json = await res.json();
      if (json.mode === "points") { setPoints(json.data ?? []); setClusters([]); }
      else { setClusters(json.data ?? []); setPoints([]); }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [filters, zoom, mode, code]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalTx = mode === "heatmap" ? points.length : clusters.reduce((s, c) => s + c.count, 0);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#0a0a1e" }}>
      <DvfMap
        points={points}
        clusters={clusters}
        mode={mode}
        filters={filters}
        isLoading={isLoading}
        colorBy={colorBy}
        onCommuneClick={(c) => window.open(`/analyse/${c}`, "_blank")}
      />

      {/* Header dept */}
      {showHeader && (
        <div style={{
          position: "absolute", top: 0, left: 0, right: 0, zIndex: 900,
          background: "linear-gradient(180deg, rgba(5,5,20,0.95) 0%, rgba(5,5,20,0) 100%)",
          padding: "20px 24px 48px",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Link href="/" style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, textDecoration: "none", fontFamily: "Segoe UI, sans-serif" }}>
              ← datamerry
            </Link>
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.1)" }} />
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{
                  display: "inline-block", padding: "2px 10px", borderRadius: 99,
                  border: `1px solid ${dept.color}66`, background: `${dept.color}18`,
                  color: dept.color, fontSize: 11, fontWeight: 700, fontFamily: "Segoe UI, sans-serif",
                }}>
                  {code}
                </span>
                <span style={{ color: "#fff", fontWeight: 700, fontSize: 16, fontFamily: "Segoe UI, sans-serif" }}>
                  {dept.nom}
                </span>
              </div>
              <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, fontFamily: "Segoe UI, sans-serif", marginTop: 4 }}>
                {dept.description}
              </div>
            </div>
          </div>

          {/* Search */}
          <div ref={searchRef} style={{ position: "relative", width: 280 }}>
            <input
              type="text"
              placeholder={`Rechercher dans le ${code}…`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: "100%", padding: "10px 14px", borderRadius: 10,
                border: `1.5px solid ${dept.color}44`, background: "rgba(10,10,30,0.9)",
                color: "#fff", fontSize: 13, fontFamily: "Segoe UI, sans-serif", outline: "none",
                boxSizing: "border-box",
              }}
            />
            {searchLoading && <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: dept.color, fontSize: 12 }}>…</span>}
            {suggestions.length > 0 && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                background: "#0d0d2b", border: `1px solid ${dept.color}44`,
                borderRadius: 10, overflow: "hidden", zIndex: 2000, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              }}>
                {suggestions.map((s) => (
                  <div key={s.code} onClick={() => router.push(`/analyse/${s.code}`)}
                    style={{ padding: "10px 14px", cursor: "pointer", color: "#fff", fontFamily: "Segoe UI, sans-serif", fontSize: 13, borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = `${dept.color}18`)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span>{s.nom}</span>
                    <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11 }}>{s.code}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Filter panel */}
      <FilterPanel
        filters={filters}
        onFiltersChange={(f) => setFilters({ ...f, dept: [code] })}
        mode={mode}
        onModeChange={setMode}
        colorBy={colorBy}
        onColorByChange={setColorBy}
        onLeadClick={() => setShowLeadModal(true)}
        totalTx={totalTx}
      />

      <button
        onClick={() => setShowHeader((v) => !v)}
        style={{
          position: "absolute", bottom: 16, right: 16, zIndex: 900,
          padding: "8px 16px", borderRadius: 8,
          border: `1px solid ${dept.color}44`, background: "rgba(10,10,30,0.9)",
          color: `${dept.color}aa`, fontSize: 11, cursor: "pointer", fontFamily: "Segoe UI, sans-serif",
        }}
      >
        {showHeader ? "Masquer l'en-tête" : `${code} · ${dept.nom}`}
      </button>

      {showLeadModal && <LeadModal onClose={() => setShowLeadModal(false)} />}

      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
      `}</style>
    </div>
  );
}
