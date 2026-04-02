"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import AnalyseLeadModal from "@/components/AnalyseLeadModal";
import type { Intent } from "@/components/AnalyseLeadModal";
import type { DvfPoint } from "@/types/dvf";
import { COMMUNES_MAP, communesByDept, isFreeCommune, FREE_ANNEE_MIN, FREE_ANNEE_MAX } from "@/lib/communes-top30";

const CommuneMap = dynamic(() => import("@/components/CommuneMap"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: "100%", background: "#0a0a1e", display: "flex", alignItems: "center", justifyContent: "center", color: "#00d4ff", fontFamily: "Segoe UI, sans-serif", fontSize: 14 }}>
      Chargement de la carte...
    </div>
  ),
});

type TypeFilter = "all" | "Appartement" | "Maison" | "Local industriel. commercial ou assimilé";

const TYPE_TABS: { key: TypeFilter; label: string; mobileLabel: string; emoji: string }[] = [
  { key: "Appartement", label: "Appartements", mobileLabel: "Appts", emoji: "🏢" },
  { key: "Maison", label: "Maisons", mobileLabel: "Maisons", emoji: "🏠" },
  { key: "Local industriel. commercial ou assimilé", label: "Commerces", mobileLabel: "Comm.", emoji: "🏭" },
];

const LAYER_TOGGLES: { key: "zones" | "heatmap" | "points"; label: string; emoji: string }[] = [
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

  const [activeType, setActiveType] = useState<TypeFilter>("Appartement");
  const [showZones, setShowZones] = useState(true);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [showIntentModal, setShowIntentModal] = useState(false);
  const [selectedIntent, setSelectedIntent] = useState<Intent | undefined>(undefined);
  const [pointSelected, setPointSelected] = useState(false);
  const [showCommuneSheet, setShowCommuneSheet] = useState(false);
  const [showAnalysePanel, setShowAnalysePanel] = useState(false);

  // Data
  const [allPoints, setAllPoints] = useState<DvfPoint[]>([]);
  const [zones, setZones] = useState<HdbscanZone[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [stats, setStats] = useState<{ totalCount: number; prix_m2_median: number } | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [analyseData, setAnalyseData] = useState<any>(null);

  // Filter points by active type (client-side, instant switch)
  const points = useMemo(
    () => activeType === "all" ? allPoints : allPoints.filter((p: DvfPoint) => p.type_local === activeType),
    [allPoints, activeType],
  );

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
      const zoneList: HdbscanZone[] = (json.features ?? []).map((f: { properties: Record<string, unknown>; geometry: { coordinates: number[][][] } }) => ({
        ...f.properties,
        hull_coords: f.geometry.coordinates[0]
          .slice(0, -1)
          .map((c: number[]) => [c[1], c[0]] as [number, number]),
      }));
      setZones(zoneList);
    } catch (e) {
      console.error("Failed to fetch zones:", e);
    }
  }, [code, activeType]);

  // Fetch DVF points — all types at once, filter client-side
  const fetchPoints = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("dept", dept);
      params.set("zoom", "15");
      params.set("mode", "heatmap");
      params.set("code_commune", code);
      // Show all available years until data is re-imported for 2024-2025
      // TODO: re-enable free tier restriction (2024-2025) after full DVF re-import
      params.set("annee_min", "2020");
      params.set("annee_max", "2025");
      // Pass commune coordinates for geographic fallback if code_commune match fails
      if (commune) {
        params.set("lat", String(commune.lat));
        params.set("lon", String(commune.lon));
      }
      const res = await fetch(`/api/dvf/clusters?${params}`);
      const json = await res.json();
      setAllPoints((json.data ?? []) as DvfPoint[]);
    } catch (e) {
      console.error("Failed to fetch points:", e);
    } finally {
      setIsLoading(false);
    }
  }, [dept, code, commune]);

  // Fetch commune stats + full analyse data
  useEffect(() => {
    fetch(`/api/analyse/${code}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.totalCount) {
          setStats({ totalCount: d.totalCount, prix_m2_median: d.prix_m2_median });
          setAnalyseData(d);
        }
      })
      .catch(() => {});
  }, [code]);

  // Fetch points once on mount, zones on type change
  useEffect(() => {
    fetchPoints();
  }, [fetchPoints]);

  useEffect(() => {
    fetchZones();
  }, [fetchZones]);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#0a0a1e", overflow: "hidden" }}>

      {/* === CARTE === */}
      <CommuneMap
        commune={commune ?? { code, nom, dept, deptNom: "", color, lat: 48.86, lon: 2.35, population: 0 }}
        points={points}
        zones={zones}
        showZones={showZones}
        showHeatmap={showHeatmap}
        showPoints={showPoints}
        isLoading={isLoading}
        onPointSelected={setPointSelected}
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
        padding: isMobile ? "56px 12px 30px" : "56px 20px 60px",
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

        {/* Droite : toggle panneau analyse */}
        {!isMobile && (
          <div style={{ pointerEvents: "all", display: "flex", gap: 8 }}>
            <button
              onClick={() => setShowAnalysePanel((v: boolean) => !v)}
              style={{
                background: showAnalysePanel ? `${color}30` : `${color}15`,
                border: `1px solid ${showAnalysePanel ? color : `${color}44`}`,
                borderRadius: 8, padding: "7px 14px",
                color: showAnalysePanel ? "#fff" : color, fontSize: 12, fontWeight: 600,
                fontFamily: "Segoe UI, sans-serif", cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 6,
              }}
            >
              {showAnalysePanel ? "✕ Fermer" : "📊 Analyse"}
            </button>
            <Link href={`/analyse/${code}`} style={{
              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 8, padding: "7px 14px",
              color: "rgba(255,255,255,0.5)", fontSize: 12, fontWeight: 600,
              fontFamily: "Segoe UI, sans-serif", textDecoration: "none",
              display: "inline-flex", alignItems: "center", gap: 6,
            }}>
              Voir tout →
            </Link>
          </div>
        )}
      </div>

      {/* === LAYER TOGGLES (bas gauche) === */}
      <div style={{
        position: "fixed",
        bottom: isMobile ? 60 : 100,
        left: isMobile ? 8 : 16,
        zIndex: 10000,
        display: (isMobile && pointSelected) ? "none" : "flex",
        flexDirection: "column", gap: 3,
        background: "rgba(5,5,20,0.9)", borderRadius: 10,
        padding: 3, backdropFilter: "blur(10px)",
        border: "1px solid rgba(255,255,255,0.1)",
        pointerEvents: "all",
      }}>
        {LAYER_TOGGLES.map((tab) => {
          const isActive = tab.key === "zones" ? showZones : tab.key === "heatmap" ? showHeatmap : showPoints;
          const toggleFn = tab.key === "zones"
            ? () => setShowZones((v: boolean) => !v)
            : tab.key === "heatmap"
              ? () => setShowHeatmap((v: boolean) => !v)
              : () => setShowPoints((v: boolean) => !v);
          return (
            <button
              key={tab.key}
              onClick={toggleFn}
              style={{
                background: isActive ? `${color}30` : "transparent",
                border: `1px solid ${isActive ? color : "rgba(255,255,255,0.15)"}`,
                borderRadius: 7, padding: isMobile ? "6px 8px" : "7px 12px",
                color: isActive ? "#fff" : "rgba(255,255,255,0.35)",
                fontSize: isMobile ? 10 : 11, fontWeight: isActive ? 700 : 500,
                fontFamily: "Segoe UI, sans-serif",
                cursor: "pointer", transition: "all 0.15s",
                display: "flex", alignItems: "center", gap: 6,
                whiteSpace: "nowrap",
                opacity: isActive ? 1 : 0.6,
              }}
            >
              <span style={{ fontSize: 12 }}>{tab.emoji}</span>
              {!isMobile && tab.label}
            </button>
          );
        })}
      </div>

      {/* === SIDEBAR / SHEET NAVIGATION COMMUNES === */}
      {siblings.length > 0 && !isMobile && (
        <div style={{
          position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)",
          zIndex: 800, display: "flex", flexDirection: "column", alignItems: "flex-end",
          gap: 3, padding: "8px 6px",
          background: "rgba(5,5,20,0.75)", borderRadius: "10px 0 0 10px",
          backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.08)",
          borderRight: "none", maxHeight: "60vh", overflowY: "auto",
          scrollbarWidth: "none" as React.CSSProperties["scrollbarWidth"],
        }}>
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
          {siblings.slice(0, 12).map((c: { code: string; nom: string; color: string; population: number }) => (
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
                onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                  (e.currentTarget).style.background = `${c.color}20`;
                  (e.currentTarget).style.borderColor = `${c.color}88`;
                  (e.currentTarget).style.color = c.color;
                }}
                onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                  (e.currentTarget).style.background = "transparent";
                  (e.currentTarget).style.borderColor = "rgba(255,255,255,0.06)";
                  (e.currentTarget as HTMLDivElement).style.color = "rgba(255,255,255,0.4)";
                }}
              >
                {c.nom.length > 8 ? c.nom.slice(0, 7) + "." : c.nom}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Mobile: communes pill + bottom sheet */}
      {isMobile && siblings.length > 0 && !pointSelected && (
        <>
          {!showCommuneSheet && (
            <button
              onClick={() => setShowCommuneSheet(true)}
              style={{
                position: "fixed", bottom: 56, right: 8,
                zIndex: 10001, pointerEvents: "all",
                background: `${color}20`, border: `1px solid ${color}55`,
                borderRadius: 99, padding: "7px 12px",
                color: "#fff", fontSize: 11, fontWeight: 700,
                fontFamily: "Segoe UI, sans-serif",
                cursor: "pointer",
                display: "flex", alignItems: "center", gap: 5,
                backdropFilter: "blur(10px)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
              }}
            >
              <span style={{ fontSize: 12 }}>📍</span>
              Communes
              <span style={{
                background: color, color: "#000",
                fontSize: 9, fontWeight: 800, borderRadius: 99,
                padding: "1px 6px",
              }}>{siblings.length}</span>
            </button>
          )}

          {showCommuneSheet && (
            <div
              onClick={() => setShowCommuneSheet(false)}
              style={{
                position: "fixed", inset: 0, zIndex: 11000,
                background: "rgba(0,0,0,0.5)",
                pointerEvents: "all",
              }}
            >
              <div
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  background: "#0d0d2b",
                  borderTop: `2px solid ${color}66`,
                  borderRadius: "18px 18px 0 0",
                  padding: "12px 16px 24px",
                  maxHeight: "55vh",
                  display: "flex", flexDirection: "column",
                  animation: "communeSlideUp 0.25s ease-out",
                }}
              >
                {/* Handle bar */}
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
                  <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.2)" }} />
                </div>

                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, padding: "0 2px" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: "#fff", fontFamily: "Segoe UI, sans-serif" }}>
                      Communes · Dept {dept}
                    </div>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>
                      {siblings.length} communes du departement
                    </div>
                  </div>
                  <button
                    onClick={() => setShowCommuneSheet(false)}
                    style={{
                      background: "rgba(255,255,255,0.08)", border: "none",
                      borderRadius: 8, width: 32, height: 32,
                      color: "rgba(255,255,255,0.5)", fontSize: 16,
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Communes grid */}
                <div style={{
                  overflowY: "auto", flex: 1,
                  display: "grid", gridTemplateColumns: "1fr 1fr",
                  gap: 8, padding: "0 2px",
                  scrollbarWidth: "none" as React.CSSProperties["scrollbarWidth"],
                }}>
                  {siblings.map((c: { code: string; nom: string; color: string; population: number }, i: number) => (
                    <Link
                      key={c.code}
                      href={`/commune/${c.code}`}
                      onClick={() => setShowCommuneSheet(false)}
                      style={{ textDecoration: "none" }}
                    >
                      <div style={{
                        padding: "10px 12px", borderRadius: 10,
                        background: "rgba(255,255,255,0.04)",
                        border: `1px solid ${c.color}25`,
                        display: "flex", alignItems: "center", gap: 10,
                      }}>
                        <span style={{
                          fontSize: 9, fontWeight: 800, color,
                          width: 18, textAlign: "center", flexShrink: 0, opacity: 0.5,
                        }}>{i + 1}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontSize: 12, fontWeight: 700, color: "#fff",
                            fontFamily: "Segoe UI, sans-serif",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}>
                            {c.nom}
                          </div>
                          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginTop: 1 }}>
                            {c.population.toLocaleString("fr-FR")} hab.
                          </div>
                        </div>
                        <span style={{ fontSize: 12, color: "rgba(255,255,255,0.2)" }}>›</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}
          <style>{`@keyframes communeSlideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
        </>
      )}

      {/* === ONGLETS PROFIL (bas centre) — même UX que dept === */}
      <div style={{
        position: "fixed", bottom: isMobile ? 10 : 48,
        left: isMobile ? 8 : "50%",
        right: isMobile ? 8 : "auto",
        transform: isMobile ? "none" : "translateX(-50%)",
        zIndex: 10000,
        display: (isMobile && pointSelected) ? "none" : "flex",
        gap: isMobile ? 3 : 6, alignItems: "center",
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
            onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.currentTarget.style.background = `${tab.color}20`;
              e.currentTarget.style.borderColor = `${tab.color}88`;
              e.currentTarget.style.color = "#fff";
            }}
            onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.04)";
              e.currentTarget.style.borderColor = `${tab.color}33`;
              (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,0.7)";
            }}
          >
            <span style={{ fontSize: isMobile ? 11 : 14 }}>{tab.icon}</span>
            {isMobile ? tab.mobileLabel : tab.label}
          </button>
        ))}
      </div>

      {/* === PANNEAU ANALYSE LATERAL === */}
      {showAnalysePanel && analyseData && (
        <div style={{
          position: "fixed", top: 52, right: 0, bottom: 0, width: isMobile ? "100%" : 380,
          zIndex: 10500, background: "rgba(7,7,20,0.97)",
          borderLeft: "1px solid rgba(255,255,255,0.08)",
          backdropFilter: "blur(12px)",
          overflowY: "auto", padding: "20px 20px 100px",
          animation: "panelSlideIn 0.2s ease-out",
          scrollbarWidth: "none" as React.CSSProperties["scrollbarWidth"],
        }}>
          {/* Close */}
          <button onClick={() => setShowAnalysePanel(false)} style={{
            position: "sticky", top: 0, float: "right", background: "rgba(255,255,255,0.08)",
            border: "none", borderRadius: 8, width: 32, height: 32, color: "rgba(255,255,255,0.5)",
            fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2,
          }}>✕</button>

          {/* Header */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 10, color, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700, marginBottom: 6 }}>
              Analyse · {nom}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#00d4ff" }}>{analyseData.totalCount?.toLocaleString("fr-FR") ?? "—"}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>transactions</div>
              </div>
              <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: "#ffdd00" }}>{analyseData.prix_m2_median?.toLocaleString("fr-FR") ?? "—"} €</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", marginTop: 2 }}>prix median/m²</div>
              </div>
            </div>
          </div>

          {/* Par type de bien */}
          {analyseData.byType && analyseData.byType.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
                Par type de bien
              </div>
              {analyseData.byType.filter((t: { type: string | null }) => t.type && t.type !== "Dépendance").map((t: { type: string; count: number; prix_m2_median: number | null }) => (
                <div key={t.type} style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}>
                  <span style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
                    {t.type === "Local industriel. commercial ou assimilé" ? "Commerce" : t.type}
                  </span>
                  <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#ffdd00" }}>
                      {t.prix_m2_median?.toLocaleString("fr-FR") ?? "—"} €/m²
                    </span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{t.count} tx</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Micro-zones */}
          {analyseData.zones && analyseData.zones.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
                {analyseData.zones.length} micro-zones detectees
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {analyseData.zones.slice(0, 12).map((z: { id: string; cluster_id: number; prix_m2_median: number | null; count: number }) => (
                  <div key={z.id} style={{
                    padding: "6px 10px", borderRadius: 6,
                    background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)",
                    fontSize: 11, color: "rgba(255,255,255,0.5)",
                  }}>
                    Z{z.cluster_id}: <span style={{ color: "#ffdd00", fontWeight: 700 }}>{z.prix_m2_median?.toLocaleString("fr-FR") ?? "—"}</span> €/m²
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CTA vers analyse complète */}
          <Link href={`/analyse/${code}`} style={{
            display: "block", textAlign: "center", padding: "12px 20px", borderRadius: 10,
            background: `${color}15`, border: `1px solid ${color}44`,
            color, fontSize: 13, fontWeight: 700, textDecoration: "none",
            marginTop: 12,
          }}>
            Analyse complete · score + anomalies →
          </Link>
        </div>
      )}
      <style>{`@keyframes panelSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>

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
