"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import AnalyseLeadModal from "@/components/AnalyseLeadModal";
import type { Intent } from "@/components/AnalyseLeadModal";
import type { DvfPoint } from "@/types/dvf";
import { COMMUNES_MAP, communesByDept } from "@/lib/communes-top30";

const CommuneMap = dynamic(() => import("@/components/CommuneMap"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", background: "#0a0a1e", display: "flex", alignItems: "center", justifyContent: "center", color: "#00d4ff", fontFamily: "Segoe UI, sans-serif", fontSize: 14 }}>
      Chargement de la carte...
    </div>
  ),
});

type MapMode = "zones" | "heatmap" | "points";
type TypeFilter = "all" | "Appartement" | "Maison" | "Local industriel. commercial ou assimilé";

const TYPE_TABS: { key: TypeFilter; label: string; mobileLabel: string; emoji: string }[] = [
  { key: "all", label: "Tous types", mobileLabel: "Tous", emoji: "🗺️" },
  { key: "Appartement", label: "Appartements", mobileLabel: "Appts", emoji: "🏢" },
  { key: "Maison", label: "Maisons", mobileLabel: "Maisons", emoji: "🏠" },
  { key: "Local industriel. commercial ou assimilé", label: "Commerces", mobileLabel: "Comm.", emoji: "🏭" },
];

const MODE_TABS: { key: MapMode; label: string; emoji: string }[] = [
  { key: "zones", label: "Micromarchés", emoji: "🎯" },
  { key: "heatmap", label: "Heatmap", emoji: "🔥" },
  { key: "points", label: "Points DVF", emoji: "📍" },
];

interface HdbscanZone {
  id: string;
  type_local: string;
  cluster_id: number;
  count: number;
  prix_m2_median: number | null;
  prix_m2_p25: number | null;
  prix_m2_p75: number | null;
  prix_median: number | null;
  hull_coords: [number, number][];
  centroid_lat: number;
  centroid_lon: number;
}

export default function CommunePage() {
  const { code } = useParams<{ code: string }>();
  const commune = COMMUNES_MAP.get(code);
  const nom = commune?.nom ?? code;
  const color = commune?.color ?? "#00d4ff";
  const dept = commune?.dept ?? code.slice(0, 2);

  const [activeType, setActiveType] = useState<TypeFilter>("all");
  const [activeMode, setActiveMode] = useState<MapMode>("zones");
  const [isMobile, setIsMobile] = useState(false);
  const [showIntentModal, setShowIntentModal] = useState(false);
  const [selectedIntent, setSelectedIntent] = useState<Intent | undefined>(undefined);

  // Data
  const [points, setPoints] = useState<DvfPoint[]>([]);
  const [zones, setZones] = useState<HdbscanZone[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<{ totalCount: number; prix_m2_median: number } | null>(null);

  // Sibling communes in same dept (for sidebar nav)
  const siblings = useMemo(() => communesByDept(dept).filter((c) => c.code !== code), [dept, code]);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Fetch HDBSCAN zones
  const fetchZones = useCallback(async () => {
    try {
      const typeParam = activeType !== "all" ? `&type_local=${encodeURIComponent(activeType)}` : "";
      const res = await fetch(`/api/foncier/hdbscan-zones?insee=${code}${typeParam}&limit=100`);
      const json = await res.json();
      // Convert GeoJSON features back to flat zone objects for CommuneMap
      const zoneList: HdbscanZone[] = (json.features ?? []).map((f: { properties: Record<string, unknown>; geometry: { coordinates: number[][][] } }) => ({
        ...f.properties,
        // Reverse GeoJSON [lon,lat] back to [lat,lon] for hull_coords
        hull_coords: f.geometry.coordinates[0]
          .slice(0, -1) // remove closing point
          .map((c: number[]) => [c[1], c[0]] as [number, number]),
      }));
      setZones(zoneList);
    } catch (e) {
      console.error("Failed to fetch zones:", e);
    }
  }, [code, activeType]);

  // Fetch DVF points
  const fetchPoints = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("dept", dept);
      params.set("zoom", "15"); // force points mode
      params.set("mode", "heatmap"); // gets raw points
      if (activeType !== "all") params.set("type_local", activeType);
      // We'll filter by commune client-side from the points
      const res = await fetch(`/api/dvf/clusters?${params}`);
      const json = await res.json();
      // Filter to just this commune's points
      const communePoints = (json.data ?? []).filter(
        (p: DvfPoint) => p.commune === nom || String(p.dept) === dept
      );
      setPoints(communePoints);
    } catch (e) {
      console.error("Failed to fetch points:", e);
    } finally {
      setIsLoading(false);
    }
  }, [dept, nom, activeType]);

  // Fetch commune stats
  useEffect(() => {
    fetch(`/api/analyse/${code}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.totalCount) setStats({ totalCount: d.totalCount, prix_m2_median: d.prix_m2_median });
      })
      .catch(() => {});
  }, [code]);

  // Fetch data based on mode
  useEffect(() => {
    fetchZones();
    if (activeMode === "heatmap" || activeMode === "points") {
      fetchPoints();
    }
  }, [activeMode, fetchZones, fetchPoints]);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#0a0a1e", overflow: "hidden" }}>

      {/* === CARTE === */}
      <CommuneMap
        commune={commune ?? { code, nom, dept, deptNom: "", color, lat: 48.86, lon: 2.35, population: 0 }}
        points={points}
        zones={zones}
        mode={activeMode}
        isLoading={isLoading}
      />

      {/* === ONGLETS TYPE (haut centre) === */}
      <div style={{
        position: "fixed", top: isMobile ? 8 : 12,
        left: isMobile ? 8 : "50%",
        right: isMobile ? 8 : "auto",
        transform: isMobile ? "none" : "translateX(-50%)",
        zIndex: 10000, display: "flex", gap: isMobile ? 2 : 4, alignItems: "center",
        background: "rgba(5,5,20,0.85)", borderRadius: isMobile ? 10 : 12,
        padding: isMobile ? 3 : 4, backdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.1)",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none" as React.CSSProperties["scrollbarWidth"],
        pointerEvents: "all",
      }}>
        {/* Bouton retour */}
        <Link href={`/dept/${dept}`} style={{
          background: "transparent",
          border: `1px solid ${color}44`,
          borderRadius: isMobile ? 7 : 8, padding: isMobile ? "6px 8px" : "7px 14px",
          color: `${color}cc`,
          fontSize: isMobile ? 10 : 12, fontWeight: 700,
          fontFamily: "Segoe UI, sans-serif",
          cursor: "pointer",
          display: "flex", alignItems: "center", gap: isMobile ? 3 : 4,
          whiteSpace: "nowrap", flexShrink: 0,
          textDecoration: "none",
        }}>
          ← {isMobile ? dept : `Dept ${dept}`}
        </Link>
        {TYPE_TABS.map((tab) => {
          const isActive = tab.key === activeType;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveType(tab.key)}
              style={{
                background: isActive ? `${color}30` : "transparent",
                border: `1px solid ${isActive ? color : "transparent"}`,
                borderRadius: isMobile ? 7 : 8, padding: isMobile ? "6px 8px" : "7px 14px",
                color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
                fontSize: isMobile ? 10 : 12, fontWeight: isActive ? 700 : 500,
                fontFamily: "Segoe UI, sans-serif",
                cursor: "pointer", transition: "all 0.15s",
                display: "flex", alignItems: "center", gap: isMobile ? 3 : 4,
                whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              <span style={{ fontSize: isMobile ? 11 : 13 }}>{tab.emoji}</span>
              {isMobile ? tab.mobileLabel : tab.label}
            </button>
          );
        })}
      </div>

      {/* === HEADER OVERLAY === */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, zIndex: 900,
        background: "linear-gradient(180deg, rgba(5,5,20,0.97) 0%, rgba(5,5,20,0.0) 100%)",
        padding: isMobile ? "52px 12px 40px" : "56px 20px 60px",
        display: "flex", alignItems: isMobile ? "flex-start" : "flex-start",
        justifyContent: "space-between", gap: isMobile ? 8 : 12,
        flexWrap: "wrap",
        pointerEvents: "none",
      }}>
        {/* Gauche : commune badge */}
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 12, pointerEvents: "all", flexWrap: "wrap" }}>
          <Link href="/" style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, textDecoration: "none", fontFamily: "Segoe UI, sans-serif", whiteSpace: "nowrap" }}>
            ← datamerry
          </Link>
          <div style={{ width: 1, height: 14, background: "rgba(255,255,255,0.1)", flexShrink: 0 }} />
          <div style={{
            display: "inline-flex", alignItems: "center", gap: isMobile ? 4 : 8,
            padding: isMobile ? "4px 10px" : "6px 14px", borderRadius: 99,
            border: `1px solid ${color}66`, background: `${color}18`,
          }}>
            <span style={{ color: "#fff", fontWeight: 800, fontSize: isMobile ? 12 : 15, fontFamily: "Segoe UI, sans-serif" }}>
              {nom}
            </span>
            <span style={{
              padding: "1px 6px", borderRadius: 99,
              background: `${color}33`, color,
              fontSize: 10, fontWeight: 700, fontFamily: "Segoe UI, sans-serif",
            }}>{dept}</span>
          </div>
          {stats && !isMobile && (
            <div style={{ display: "flex", gap: 12, marginLeft: 8 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#00d4ff" }}>{stats.totalCount.toLocaleString("fr-FR")}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>transactions</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#ffdd00" }}>{stats.prix_m2_median.toLocaleString("fr-FR")}€</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)" }}>prix médian/m²</div>
              </div>
            </div>
          )}
        </div>

        {/* Droite : lien vers analyse détaillée */}
        {!isMobile && (
          <div style={{ pointerEvents: "all" }}>
            <Link href={`/analyse/${code}`} style={{
              background: `${color}15`, border: `1px solid ${color}44`,
              borderRadius: 8, padding: "7px 14px",
              color, fontSize: 12, fontWeight: 600,
              fontFamily: "Segoe UI, sans-serif", textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              Analyse détaillée →
            </Link>
          </div>
        )}
      </div>

      {/* === MODE SWITCH (bas gauche) === */}
      <div style={{
        position: "fixed",
        bottom: isMobile ? 60 : 100,
        left: isMobile ? 8 : 16,
        zIndex: 10000,
        display: "flex", flexDirection: "column", gap: 3,
        background: "rgba(5,5,20,0.9)", borderRadius: 10,
        padding: 3, backdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.1)",
        pointerEvents: "all",
      }}>
        {MODE_TABS.map((tab) => {
          const isActive = tab.key === activeMode;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveMode(tab.key)}
              style={{
                background: isActive ? `${color}30` : "transparent",
                border: `1px solid ${isActive ? color : "transparent"}`,
                borderRadius: 7, padding: isMobile ? "6px 8px" : "7px 12px",
                color: isActive ? "#fff" : "rgba(255,255,255,0.5)",
                fontSize: isMobile ? 10 : 11, fontWeight: isActive ? 700 : 500,
                fontFamily: "Segoe UI, sans-serif",
                cursor: "pointer", transition: "all 0.15s",
                display: "flex", alignItems: "center", gap: 6,
                whiteSpace: "nowrap",
              }}
            >
              <span style={{ fontSize: 12 }}>{tab.emoji}</span>
              {!isMobile && tab.label}
            </button>
          );
        })}
      </div>

      {/* === SIDEBAR NAVIGATION COMMUNES (côté droit) === */}
      {!isMobile && siblings.length > 0 && (
        <div style={{
          position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
          zIndex: 800, display: "flex", flexDirection: "column", alignItems: "flex-end",
          gap: 3, padding: "8px 6px",
          background: "rgba(5,5,20,0.75)", borderRadius: "10px 0 0 10px",
          backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.08)",
          borderRight: "none", maxHeight: "60vh", overflowY: "auto",
          scrollbarWidth: "none" as React.CSSProperties["scrollbarWidth"],
        }}>
          {/* Link to all communes */}
          <Link href={`/dept/${dept}`} title={`Retour dept ${dept}`} style={{ textDecoration: "none" }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "rgba(255,255,255,0.5)",
              fontSize: 10, fontWeight: 800, fontFamily: "Segoe UI, sans-serif",
              cursor: "pointer",
              marginBottom: 4,
            }}>
              {dept}
            </div>
          </Link>
          {siblings.slice(0, 12).map((c) => (
            <Link key={c.code} href={`/commune/${c.code}`} title={c.nom} style={{ textDecoration: "none" }}>
              <div style={{
                minWidth: 36, height: 28, borderRadius: 6,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent",
                border: "1px solid rgba(255,255,255,0.06)",
                color: "rgba(255,255,255,0.4)",
                fontSize: 8, fontWeight: 700, fontFamily: "Segoe UI, sans-serif",
                cursor: "pointer", transition: "all 0.15s",
                padding: "0 4px",
              }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = `${c.color}20`;
                  (e.currentTarget as HTMLDivElement).style.borderColor = `${c.color}88`;
                  (e.currentTarget as HTMLDivElement).style.color = c.color;
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
                  (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.06)";
                  (e.currentTarget as HTMLDivElement).style.color = "rgba(255,255,255,0.4)";
                }}
              >
                {c.nom.length > 8 ? c.nom.slice(0, 7) + "." : c.nom}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* === ONGLETS PROFIL (bas centre) — même UX que dept === */}
      <div style={{
        position: "fixed", bottom: isMobile ? 10 : 48,
        left: isMobile ? 8 : "50%",
        right: isMobile ? 8 : "auto",
        transform: isMobile ? "none" : "translateX(-50%)",
        zIndex: 10000, display: "flex", gap: isMobile ? 3 : 6, alignItems: "center",
        background: "rgba(5,5,20,0.9)", borderRadius: isMobile ? 10 : 14,
        padding: isMobile ? 3 : 6, backdropFilter: "blur(12px)",
        border: "1px solid rgba(255,255,255,0.12)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
        overflowX: isMobile ? "auto" : "visible",
        WebkitOverflowScrolling: "touch",
        scrollbarWidth: "none" as React.CSSProperties["scrollbarWidth"],
        pointerEvents: "all",
      }}>
        {([
          { key: "acheteur" as Intent, label: "J'achète", mobileLabel: "Acheter", icon: "🔑", color: "#00d4ff" },
          { key: "vendeur" as Intent, label: "Je vends", mobileLabel: "Vendre", icon: "🏠", color: "#ff8844" },
          { key: "investisseur" as Intent, label: "J'investis", mobileLabel: "Investir", icon: "📈", color: "#a855f7" },
          { key: "agent" as Intent, label: "Agent / Promoteur", mobileLabel: "Pro", icon: "💼", color: "#00ff88" },
        ]).map((tab) => (
          <button
            key={tab.key}
            onClick={() => { setSelectedIntent(tab.key); setShowIntentModal(true); }}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: `1px solid ${tab.color}33`,
              borderRadius: isMobile ? 7 : 10, padding: isMobile ? "6px 8px" : "9px 16px",
              color: "rgba(255,255,255,0.7)",
              fontSize: isMobile ? 10 : 12, fontWeight: 600,
              fontFamily: "Segoe UI, sans-serif",
              cursor: "pointer", transition: "all 0.15s",
              display: "flex", alignItems: "center", gap: isMobile ? 3 : 6,
              whiteSpace: "nowrap", flexShrink: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = `${tab.color}20`;
              (e.currentTarget as HTMLButtonElement).style.borderColor = `${tab.color}88`;
              (e.currentTarget as HTMLButtonElement).style.color = "#fff";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.04)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = `${tab.color}33`;
              (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)";
            }}
          >
            <span style={{ fontSize: isMobile ? 11 : 14 }}>{tab.icon}</span>
            {isMobile ? tab.mobileLabel : tab.label}
          </button>
        ))}
      </div>

      {showIntentModal && (
        <AnalyseLeadModal
          commune={{ code, nom }}
          initialIntent={selectedIntent}
          onClose={() => { setShowIntentModal(false); setSelectedIntent(undefined); }}
        />
      )}
    </div>
  );
}
