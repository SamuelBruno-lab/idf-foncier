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

const DEPT_INFO: Record<string, { nom: string; nomFull: string; color: string; description: string; emoji: string }> = {
  "75": { nom: "Paris", nomFull: "Paris", color: "#ef4444", description: "Le marché le plus dense · ~10 000€/m²", emoji: "🗼" },
  "92": { nom: "92", nomFull: "Hauts-de-Seine", color: "#00d4ff", description: "Neuilly, Boulogne, Levallois · marché premium", emoji: "💎" },
  "93": { nom: "93", nomFull: "Seine-Saint-Denis", color: "#00ff88", description: "Fort potentiel locatif · prix accessibles", emoji: "📈" },
  "94": { nom: "94", nomFull: "Val-de-Marne", color: "#a78bfa", description: "Vincennes, Créteil · rendements surprenants", emoji: "🏆" },
  "95": { nom: "95", nomFull: "Val-d'Oise", color: "#f59e0b", description: "Cergy, Argenteuil · prix attractifs", emoji: "🌿" },
  "91": { nom: "91", nomFull: "Essonne", color: "#10b981", description: "Évry, Massy · fort rendement locatif", emoji: "🚀" },
  "77": { nom: "77", nomFull: "Seine-et-Marne", color: "#f97316", description: "Melun, Meaux · marché maisons", emoji: "🏡" },
  "60": { nom: "60", nomFull: "Oise", color: "#ec4899", description: "Creil, Senlis · prix accessibles hors IDF", emoji: "🌾" },
};

const DEPT_ORDER = ["75", "92", "93", "94", "95", "91", "77", "60"];

// Cartes statiques GitHub Pages — même pipeline HDBSCAN que hauts-de-seine-foncier
const STATIC_MAPS: Record<string, string> = {
  "60": "https://samuelbruno-lab.github.io/oise-foncier/",
  "75": "https://samuelbruno-lab.github.io/paris-foncier/",
  "77": "https://samuelbruno-lab.github.io/seine-et-marne-foncier/",
  "91": "https://samuelbruno-lab.github.io/essonne-foncier/",
  "92": "https://samuelbruno-lab.github.io/hauts-de-seine-foncier/",
  "93": "https://samuelbruno-lab.github.io/seine-saint-denis-foncier/",
  "94": "https://samuelbruno-lab.github.io/val-de-marne-foncier/",
  "95": "https://samuelbruno-lab.github.io/val-d-oise-foncier/",
};

type CommuneSuggestion = { code: string; nom: string };

export default function DeptPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const dept = DEPT_INFO[code] ?? { nom: code, nomFull: `Département ${code}`, color: "#00d4ff", description: "", emoji: "📍" };
  const staticMapUrl = STATIC_MAPS[code];

  const [filters, setFilters] = useState<DvfFilters>({ type_local: ["Appartement"], dept: [code] });
  const [mode, setMode] = useState<"clusters" | "heatmap">("clusters");
  const [points, setPoints] = useState<DvfPoint[]>([]);
  const [clusters, setClusters] = useState<DvfCluster[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [zoom] = useState(11);
  const [showLeadModal, setShowLeadModal] = useState(false);

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
      } finally { setSearchLoading(false); }
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
    if (staticMapUrl) return; // pas besoin de fetch si on affiche un iframe
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
    } catch (e) { console.error(e); }
    finally { setIsLoading(false); }
  }, [filters, zoom, mode, code, staticMapUrl]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalTx = mode === "heatmap" ? points.length : clusters.reduce((s, c) => s + c.count, 0);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#0a0a1e", overflow: "hidden" }}>

      {/* === CARTE : iframe statique OU DvfMap dynamique === */}
      {staticMapUrl ? (
        <iframe
          src={staticMapUrl}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", zIndex: 1 }}
          title={`Carte foncière ${dept.nomFull}`}
          allowFullScreen
        />
      ) : (
        <DvfMap
          points={points}
          clusters={clusters}
          mode={mode}
          filters={filters}
          isLoading={isLoading}
          onCommuneClick={(c) => window.open(`/analyse/${c}`, "_blank")}
        />
      )}

      {/* === HEADER OVERLAY === */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 900,
        background: "linear-gradient(180deg, rgba(5,5,20,0.97) 0%, rgba(5,5,20,0.0) 100%)",
        padding: "14px 20px 60px",
        display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12,
        flexWrap: "wrap",
        pointerEvents: "none",
      }}>
        {/* Gauche : nav + titre */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, pointerEvents: "all" }}>
          <Link href="/" style={{ color: "rgba(255,255,255,0.35)", fontSize: 12, textDecoration: "none", fontFamily: "Segoe UI, sans-serif", whiteSpace: "nowrap" }}>
            ← datamerry
          </Link>
          <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />
          {/* Badge département */}
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "6px 14px", borderRadius: 99,
            border: `1px solid ${dept.color}66`, background: `${dept.color}18`,
          }}>
            <span style={{ fontSize: 15 }}>{dept.emoji}</span>
            <span style={{ color: "#fff", fontWeight: 800, fontSize: 15, fontFamily: "Segoe UI, sans-serif" }}>
              {dept.nomFull}
            </span>
            <span style={{
              padding: "1px 8px", borderRadius: 99,
              background: `${dept.color}33`, color: dept.color,
              fontSize: 11, fontWeight: 700, fontFamily: "Segoe UI, sans-serif",
            }}>{code}</span>
          </div>
          <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 11, fontFamily: "Segoe UI, sans-serif", maxWidth: 220, display: "none" }}>
            {dept.description}
          </span>
        </div>

        {/* Droite : search + actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, pointerEvents: "all", flexWrap: "wrap" }}>
          {/* Search — uniquement pour depts dynamiques */}
          {!staticMapUrl && (
            <div ref={searchRef} style={{ position: "relative", width: 240 }}>
              <input
                type="text"
                placeholder={`Chercher dans le ${code}…`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%", padding: "9px 14px", borderRadius: 10,
                  border: `1.5px solid ${dept.color}44`, background: "rgba(10,10,30,0.92)",
                  color: "#fff", fontSize: 13, fontFamily: "Segoe UI, sans-serif", outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {searchLoading && <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: dept.color, fontSize: 12 }}>…</span>}
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
          )}

        </div>
      </div>

      {/* === FILTER PANEL (uniquement pour les depts dynamiques) === */}
      {!staticMapUrl && (
        <FilterPanel
          filters={filters}
          onFiltersChange={(f) => setFilters({ ...f, dept: [code] })}
          mode={mode}
          onModeChange={setMode}
          onLeadClick={() => setShowLeadModal(true)}
          totalTx={totalTx}
        />
      )}

      {/* === NAVIGATION LATERALE DEPTS (petits boutons côté droit) === */}
      <div style={{
        position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
        zIndex: 800, display: "flex", flexDirection: "column", gap: 4, padding: "8px 6px",
        background: "rgba(5,5,20,0.75)", borderRadius: "10px 0 0 10px",
        backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.08)",
        borderRight: "none",
      }}>
        {DEPT_ORDER.map((d) => {
          const di = DEPT_INFO[d];
          const isActive = d === code;
          return (
            <Link key={d} href={`/dept/${d}`} title={di.nomFull} style={{ textDecoration: "none" }}>
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: isActive ? `${di.color}30` : "transparent",
                border: `1px solid ${isActive ? di.color : "rgba(255,255,255,0.08)"}`,
                color: isActive ? di.color : "rgba(255,255,255,0.4)",
                fontSize: 11, fontWeight: 800, fontFamily: "Segoe UI, sans-serif",
                cursor: "pointer", transition: "all 0.15s",
              }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLDivElement).style.background = `${di.color}20`;
                    (e.currentTarget as HTMLDivElement).style.borderColor = `${di.color}88`;
                    (e.currentTarget as HTMLDivElement).style.color = di.color;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLDivElement).style.background = "transparent";
                    (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.08)";
                    (e.currentTarget as HTMLDivElement).style.color = "rgba(255,255,255,0.4)";
                  }
                }}
              >
                {d}
              </div>
            </Link>
          );
        })}
      </div>

      {showLeadModal && <LeadModal onClose={() => setShowLeadModal(false)} />}

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }`}</style>
    </div>
  );
}
