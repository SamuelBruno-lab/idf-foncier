"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";

const DEPTS = [
  { code: "75", shortName: "Paris", color: "#ef4444" },
  { code: "92", shortName: "Hts-de-Seine", color: "#00d4ff" },
  { code: "93", shortName: "Seine-St-Denis", color: "#00ff88" },
  { code: "94", shortName: "Val-de-Marne", color: "#a78bfa" },
  { code: "95", shortName: "Val-d'Oise", color: "#f59e0b" },
  { code: "78", shortName: "Yvelines", color: "#06b6d4" },
  { code: "91", shortName: "Essonne", color: "#10b981" },
  { code: "77", shortName: "Seine-et-Marne", color: "#f97316" },
  { code: "60", shortName: "Oise", color: "#ec4899" },
];
import FilterPanel from "@/components/FilterPanel";
import LeadModal from "@/components/LeadModal";
import CookieBanner from "@/components/CookieBanner";
import type { DvfFilters, DvfPoint, DvfCluster } from "@/types/dvf";

type CommuneSuggestion = { code: string; nom: string };

// DvfMap importé dynamiquement (WebGL, no SSR)
const DvfMap = dynamic(() => import("@/components/DvfMap"), {
  ssr: false,
  loading: () => (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#0a0a1e",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#00d4ff",
        fontFamily: "Segoe UI, sans-serif",
        fontSize: 14,
      }}
    >
      Initialisation de la carte...
    </div>
  ),
});

export default function HomePage() {
  const router = useRouter();
  const [filters, setFilters] = useState<DvfFilters>({ type_local: ["Appartement"] });
  const [mode, setMode] = useState<"clusters" | "heatmap">("clusters");
  const [points, setPoints] = useState<DvfPoint[]>([]);
  const [clusters, setClusters] = useState<DvfCluster[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [zoom] = useState(10);
  const [showHero, setShowHero] = useState(true);
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [activeFooter, setActiveFooter] = useState<"about" | "contact" | null>(null);
  const didCheckModal = useRef(false);

  // Recherche commune
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<CommuneSuggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchQuery.length < 2) { setSuggestions([]); return; }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/communes/search?q=${encodeURIComponent(searchQuery)}`);
        setSuggestions(await res.json());
      } finally {
        setSearchLoading(false);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fermer dropdown si clic extérieur
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSuggestions([]);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.dept?.length) params.set("dept", filters.dept.join(","));
      if (filters.type_local?.length) params.set("type_local", filters.type_local[0]);
      if (filters.annee?.length) {
        params.set("annee_min", String(Math.min(...filters.annee)));
        params.set("annee_max", String(Math.max(...filters.annee)));
      }
      params.set("zoom", String(zoom));
      params.set("mode", mode);

      const res = await fetch(`/api/dvf/clusters?${params}`);
      const json = await res.json();

      if (json.mode === "points") {
        setPoints(json.data ?? []);
        setClusters([]);
      } else {
        setClusters(json.data ?? []);
        setPoints([]);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [filters, zoom, mode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Ouvre le modal leads si ?modal=leads (ex: depuis page /analyse)
  useEffect(() => {
    if (didCheckModal.current) return;
    didCheckModal.current = true;
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("modal") === "leads") {
      setShowHero(false);
      setShowLeadModal(true);
    }
  }, []);

  const totalTx =
    mode === "heatmap"
      ? points.length
      : clusters.reduce((s, c) => s + c.count, 0);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", background: "#0a0a1e" }}>
      {/* Carte toujours en fond */}
      <DvfMap
        points={points}
        clusters={clusters}
        mode={mode}
        filters={filters}
        isLoading={isLoading}
        onCommuneClick={(code) => window.open(`/analyse/${code}`, "_blank")}
      />

      {/* Panneau filtres — visible uniquement si hero fermé */}
      {!showHero && (
        <FilterPanel
          filters={filters}
          onFiltersChange={setFilters}
          mode={mode}
          onModeChange={setMode}
          onLeadClick={() => setShowLeadModal(true)}
          totalTx={totalTx}
        />
      )}

      {/* Hero overlay landing page */}
      {showHero && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(180deg, rgba(5,5,20,0.92) 0%, rgba(5,5,20,0.75) 60%, rgba(5,5,20,0.55) 100%)",
            backdropFilter: "blur(1px)",
            padding: "24px",
          }}
        >
          {/* Badge */}
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "rgba(0,212,255,0.12)",
              border: "1px solid rgba(0,212,255,0.35)",
              borderRadius: 99,
              padding: "6px 16px",
              marginBottom: 28,
              fontSize: 12,
              color: "#00d4ff",
              letterSpacing: 1.5,
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00d4ff", display: "inline-block", animation: "pulse 2s infinite" }} />
            Île-de-France + Oise · 2025
          </div>

          {/* Titre principal */}
          <h1
            style={{
              margin: 0,
              fontFamily: "Segoe UI, Arial, sans-serif",
              fontSize: "clamp(32px, 5vw, 64px)",
              fontWeight: 800,
              color: "#fff",
              textAlign: "center",
              lineHeight: 1.15,
              maxWidth: 800,
            }}
          >
            Explorez les prix de
            <br />
            <span
              style={{
                background: "linear-gradient(90deg, #00ff88, #00d4ff)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              l&apos;immobilier
            </span>{" "}
            en IDF
          </h1>

          {/* Sous-titre */}
          <p
            style={{
              margin: "20px 0 36px",
              fontFamily: "Segoe UI, Arial, sans-serif",
              fontSize: "clamp(15px, 2vw, 20px)",
              color: "rgba(255,255,255,0.65)",
              textAlign: "center",
              maxWidth: 560,
              lineHeight: 1.6,
            }}
          >
            1,2 million de ventes DVF · Prix au m² par commune,
            cartographié et analysé commune par commune
          </p>

          {/* Stats */}
          <div
            style={{
              display: "flex",
              gap: "clamp(20px, 4vw, 48px)",
              marginBottom: 40,
              flexWrap: "wrap",
              justifyContent: "center",
            }}
          >
            {[
              { val: "9 depts", label: "IDF + Oise" },
              { val: "2025", label: "Période" },
              { val: "1 200+", label: "Communes" },
            ].map(({ val, label }) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontSize: "clamp(20px, 3vw, 30px)", fontWeight: 800, color: "#fff", fontFamily: "Segoe UI, sans-serif" }}>
                  {val}
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 2, letterSpacing: 0.5 }}>
                  {label}
                </div>
              </div>
            ))}
          </div>

          {/* Barre de recherche commune */}
          <div ref={searchRef} style={{ position: "relative", width: "100%", maxWidth: 480, marginBottom: 24 }}>
            <div style={{ position: "relative" }}>
              <span style={{
                position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)",
                fontSize: 18, pointerEvents: "none"
              }}>🔍</span>
              <input
                type="text"
                placeholder="Rechercher une commune IDF…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "14px 16px 14px 46px",
                  borderRadius: 12,
                  border: "1.5px solid rgba(0,212,255,0.4)",
                  background: "rgba(10,10,30,0.85)",
                  color: "#fff",
                  fontSize: 16,
                  fontFamily: "Segoe UI, sans-serif",
                  outline: "none",
                  boxSizing: "border-box",
                  boxShadow: "0 0 20px rgba(0,212,255,0.15)",
                }}
              />
              {searchLoading && (
                <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: "#00d4ff", fontSize: 13 }}>
                  …
                </span>
              )}
            </div>
            {suggestions.length > 0 && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                background: "#0d0d2b", border: "1px solid rgba(0,212,255,0.3)",
                borderRadius: 10, overflow: "hidden", zIndex: 2000,
                boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
              }}>
                {suggestions.map((s) => (
                  <div
                    key={s.code}
                    onClick={() => router.push(`/analyse/${s.code}`)}
                    style={{
                      padding: "11px 16px",
                      cursor: "pointer",
                      color: "#fff",
                      fontFamily: "Segoe UI, sans-serif",
                      fontSize: 14,
                      borderBottom: "1px solid rgba(255,255,255,0.06)",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,212,255,0.1)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <span>{s.nom}</span>
                    <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{s.code}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Navigation départements */}
          <div style={{ width: "100%", maxWidth: 640, marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", letterSpacing: 2, textTransform: "uppercase", textAlign: "center", marginBottom: 12 }}>
              Explorer par département
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {DEPTS.map((d) => (
                <Link key={d.code} href={`/dept/${d.code}`} style={{ textDecoration: "none" }}>
                  <div
                    style={{
                      padding: "12px 6px",
                      borderRadius: 10,
                      border: `1px solid ${d.color}44`,
                      background: `${d.color}11`,
                      textAlign: "center",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = `${d.color}22`;
                      (e.currentTarget as HTMLDivElement).style.borderColor = `${d.color}99`;
                      (e.currentTarget as HTMLDivElement).style.transform = "scale(1.04)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = `${d.color}11`;
                      (e.currentTarget as HTMLDivElement).style.borderColor = `${d.color}44`;
                      (e.currentTarget as HTMLDivElement).style.transform = "scale(1)";
                    }}
                  >
                    <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", fontFamily: "Segoe UI, sans-serif" }}>{d.code}</div>
                    <div style={{ fontSize: 9, color: `${d.color}cc`, marginTop: 2, lineHeight: 1.3 }}>{d.shortName}</div>
                  </div>
                </Link>
              ))}
            </div>
          </div>

          {/* CTAs — 5 boutons centrés */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            {/* Radar foncier — masqué temporairement, en cours de développement
            <Link href="/foncier" style={{ textDecoration: "none" }}>
              <div
                style={{
                  padding: "14px 32px",
                  borderRadius: 12,
                  border: "none",
                  background: "linear-gradient(135deg, #00ff88, #00d4ff)",
                  color: "#0a0a1e",
                  fontWeight: 700,
                  fontSize: 15,
                  cursor: "pointer",
                  fontFamily: "Segoe UI, sans-serif",
                  transition: "transform 0.15s",
                  boxShadow: "0 4px 24px rgba(0,212,255,0.3)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.06)")}
                onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
              >
                Trouver 50 terrains mutables en IDF
              </div>
            </Link>
            */}
            <button
              onClick={() => setShowHero(false)}
              style={{
                padding: "12px 28px",
                borderRadius: 10,
                border: "1px solid rgba(0,212,255,0.4)",
                background: "rgba(0,212,255,0.1)",
                color: "#00d4ff",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "Segoe UI, sans-serif",
                transition: "transform 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              Carte DVF IDF →
            </button>
            <Link href="/actualites" style={{ textDecoration: "none" }}>
              <div
                style={{
                  padding: "12px 28px",
                  borderRadius: 10,
                  border: "1px solid rgba(168,85,247,0.4)",
                  background: "rgba(168,85,247,0.1)",
                  color: "#c084fc",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                  fontFamily: "Segoe UI, sans-serif",
                  transition: "transform 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget as HTMLDivElement).style.transform = "scale(1.04)"}
                onMouseLeave={(e) => (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"}
              >
                Actualités & projets pilotes
              </div>
            </Link>
            <button
              onClick={() => setActiveFooter(activeFooter === "about" ? null : "about")}
              style={{
                padding: "12px 28px",
                borderRadius: 10,
                border: `1px solid ${activeFooter === "about" ? "rgba(16,185,129,0.7)" : "rgba(16,185,129,0.4)"}`,
                background: `rgba(16,185,129,${activeFooter === "about" ? "0.2" : "0.1"})`,
                color: "#34d399",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "Segoe UI, sans-serif",
                transition: "transform 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              À propos
            </button>
            <button
              onClick={() => setActiveFooter(activeFooter === "contact" ? null : "contact")}
              style={{
                padding: "12px 28px",
                borderRadius: 10,
                border: `1px solid ${activeFooter === "contact" ? "rgba(251,191,36,0.7)" : "rgba(251,191,36,0.4)"}`,
                background: `rgba(251,191,36,${activeFooter === "contact" ? "0.2" : "0.1"})`,
                color: "#fbbf24",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "Segoe UI, sans-serif",
                transition: "transform 0.15s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.04)")}
              onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
            >
              Contact
            </button>
            <Link href="/methodologie" style={{ textDecoration: "none" }}>
              <div
                style={{
                  padding: "12px 28px",
                  borderRadius: 10,
                  border: "1px solid rgba(0,255,136,0.4)",
                  background: "rgba(0,255,136,0.1)",
                  color: "#00ff88",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                  fontFamily: "Segoe UI, sans-serif",
                  transition: "transform 0.15s",
                }}
                onMouseEnter={(e) => (e.currentTarget as HTMLDivElement).style.transform = "scale(1.04)"}
                onMouseLeave={(e) => (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"}
              >
                Méthodologie
              </div>
            </Link>
          </div>

          {/* Panneau dépliable À propos / Contact */}
          {activeFooter && (
            <div
              style={{
                maxWidth: 560,
                width: "100%",
                marginTop: 20,
                padding: "20px 24px",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                color: "rgba(255,255,255,0.6)",
                fontSize: 14,
                lineHeight: 1.7,
                fontFamily: "Segoe UI, Arial, sans-serif",
              }}
            >
              {activeFooter === "about" && (
                <>
                  <p>
                    Datamerry est un prototype d&apos;analyse foncière utilisant les
                    données ouvertes DVF et DPE pour identifier automatiquement les
                    micro-marchés immobiliers.
                  </p>
                  <p style={{ marginTop: 10 }}>
                    L&apos;objectif est d&apos;explorer de nouvelles approches de
                    prospection et d&apos;analyse territoriale pour les
                    professionnels de l&apos;immobilier, les collectivités et les
                    investisseurs.
                  </p>
                </>
              )}
              {activeFooter === "contact" && (
                <p>
                  Pour toute question ou retour :{" "}
                  <a href="mailto:contact@datamerry.com" style={{ color: "#00d4ff", textDecoration: "none" }}>
                    contact@datamerry.com
                  </a>
                </p>
              )}
            </div>
          )}

          {/* Signature open data — bas droite */}
          <div
            style={{
              position: "absolute",
              bottom: 14,
              right: 20,
              fontSize: 11,
              color: "rgba(255,255,255,0.2)",
              fontFamily: "Segoe UI, sans-serif",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <Link href="/cgu" style={{ color: "rgba(255,255,255,0.25)", textDecoration: "none", fontSize: 11 }}>CGU</Link>
            <Link href="/methodologie" style={{ color: "rgba(255,255,255,0.25)", textDecoration: "none", fontSize: 11 }}>Méthodologie</Link>
            <span>Built with open data{" "}
            <span style={{ color: "rgba(0,212,255,0.5)", fontWeight: 600 }}>DVF / data.gouv.fr</span></span>
          </div>
        </div>
      )}

      {/* Bouton retour hero (quand carte visible) */}
      {!showHero && (
        <button
          onClick={() => setShowHero(true)}
          style={{
            position: "absolute",
            bottom: 16,
            right: 16,
            zIndex: 900,
            padding: "8px 16px",
            borderRadius: 8,
            border: "1px solid rgba(0,212,255,0.3)",
            background: "rgba(10,10,30,0.9)",
            color: "rgba(0,212,255,0.7)",
            fontSize: 11,
            cursor: "pointer",
            fontFamily: "Segoe UI, sans-serif",
          }}
        >
          datamerry.com
        </button>
      )}

      {/* Modal lead capture */}
      {showLeadModal && (
        <LeadModal onClose={() => setShowLeadModal(false)} />
      )}

      {/* Bandeau cookies */}
      <CookieBanner />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
