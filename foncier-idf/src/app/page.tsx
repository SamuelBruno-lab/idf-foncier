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
import AnalyseLeadModal from "@/components/AnalyseLeadModal";
import type { Intent } from "@/components/AnalyseLeadModal";
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
        backgroundImage: "url(/skyline-idf.svg)",
        backgroundSize: "cover",
        backgroundPosition: "center bottom",
        backgroundRepeat: "no-repeat",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <div style={{
        fontSize: 28,
        fontWeight: 800,
        fontFamily: "Segoe UI, sans-serif",
        background: "linear-gradient(90deg, #00ff88, #00d4ff)",
        WebkitBackgroundClip: "text",
        WebkitTextFillColor: "transparent",
        backgroundClip: "text",
      }}>
        datamerry
      </div>
      <div style={{
        color: "rgba(255,255,255,0.5)",
        fontFamily: "Segoe UI, sans-serif",
        fontSize: 14,
        letterSpacing: 1,
      }}>
        Initialisation de la carte...
      </div>
      <div style={{
        width: 40,
        height: 3,
        borderRadius: 2,
        background: "linear-gradient(90deg, #00d4ff, #00ff88)",
        animation: "pulse 1.5s ease-in-out infinite",
      }} />
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
  const [showHero, setShowHero] = useState(false);
  const [showLeadModal, setShowLeadModal] = useState(false);
  const [activeFooter, setActiveFooter] = useState<"about" | "contact" | null>(null);
  const [showIntentModal, setShowIntentModal] = useState(false);
  const [selectedIntent, setSelectedIntent] = useState<Intent | undefined>(undefined);
  const [bannerExpanded, setBannerExpanded] = useState(false);
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
      {/* Illustration skyline en arrière-plan */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: "url(/skyline-idf.svg)",
          backgroundSize: "cover",
          backgroundPosition: "center bottom",
          backgroundRepeat: "no-repeat",
          opacity: 0.35,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
      {/* Carte toujours en fond */}
      <DvfMap
        points={points}
        clusters={clusters}
        mode={mode}
        filters={filters}
        isLoading={isLoading}
        onCommuneClick={(code) => window.open(`/analyse/${code}`, "_blank")}
      />

      {/* Panneau filtres — toujours visible */}
      <FilterPanel
        filters={filters}
        onFiltersChange={setFilters}
        mode={mode}
        onModeChange={setMode}
        onLeadClick={() => setShowLeadModal(true)}
        totalTx={totalTx}
      />

      {/* Bandeau onboarding compact — toujours visible en haut */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
          background: "linear-gradient(180deg, rgba(5,5,20,0.92) 0%, rgba(5,5,20,0.7) 100%)",
          backdropFilter: "blur(6px)",
          borderBottom: "1px solid rgba(0,212,255,0.15)",
          fontFamily: "Segoe UI, Arial, sans-serif",
        }}
      >
        {/* Ligne principale du bandeau */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {/* Logo + titre */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <span style={{
              fontSize: 14, fontWeight: 800, color: "#fff",
              background: "linear-gradient(90deg, #00ff88, #00d4ff)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
              whiteSpace: "nowrap",
            }}>
              datamerry
            </span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>
              1,2M transactions DVF · IDF + Oise
            </span>
          </div>

          {/* Recherche commune (compact) */}
          <div ref={searchRef} style={{ position: "relative", flex: "1 1 240px", maxWidth: 360 }}>
            <div style={{ position: "relative" }}>
              <span style={{
                position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)",
                fontSize: 14, pointerEvents: "none", color: "rgba(255,255,255,0.3)",
              }}>&#x1F50D;</span>
              <input
                type="text"
                placeholder="Rechercher une commune…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px 8px 32px",
                  borderRadius: 8,
                  border: "1px solid rgba(0,212,255,0.3)",
                  background: "rgba(10,10,30,0.7)",
                  color: "#fff",
                  fontSize: 13,
                  fontFamily: "Segoe UI, sans-serif",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              {searchLoading && (
                <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", color: "#00d4ff", fontSize: 12 }}>
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
                    onClick={() => { router.push(`/analyse/${s.code}`); setSuggestions([]); setSearchQuery(""); }}
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

          {/* Quick CTAs */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
            {([
              { key: "acheteur" as Intent, label: "J'achète", color: "#00d4ff" },
              { key: "vendeur" as Intent, label: "Je vends", color: "#ff8844" },
              { key: "investisseur" as Intent, label: "J'investis", color: "#a855f7" },
            ]).map((tab) => (
              <button
                key={tab.key}
                onClick={() => { setSelectedIntent(tab.key); setShowIntentModal(true); }}
                style={{
                  background: `${tab.color}15`,
                  border: `1px solid ${tab.color}44`,
                  borderRadius: 6, padding: "6px 12px",
                  color: tab.color,
                  fontSize: 11, fontWeight: 600,
                  fontFamily: "Segoe UI, sans-serif",
                  cursor: "pointer", whiteSpace: "nowrap",
                }}
              >
                {tab.label}
              </button>
            ))}
            <button
              onClick={() => setBannerExpanded(!bannerExpanded)}
              style={{
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 6, padding: "6px 10px",
                color: "rgba(255,255,255,0.5)",
                fontSize: 11, cursor: "pointer",
                fontFamily: "Segoe UI, sans-serif",
              }}
            >
              {bannerExpanded ? "Fermer" : "Plus"}
            </button>
          </div>
        </div>

        {/* Panneau dépliable */}
        {bannerExpanded && (
          <div
            style={{
              padding: "12px 16px 16px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
            }}
          >
            {/* Départements */}
            <div style={{ width: "100%", maxWidth: 640 }}>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", letterSpacing: 2, textTransform: "uppercase", textAlign: "center", marginBottom: 8 }}>
                Explorer par département
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(60px, 1fr))", gap: 6 }}>
                {DEPTS.map((d) => (
                  <Link key={d.code} href={`/dept/${d.code}`} style={{ textDecoration: "none" }}>
                    <div
                      style={{
                        padding: "8px 4px",
                        borderRadius: 8,
                        border: `1px solid ${d.color}44`,
                        background: `${d.color}11`,
                        textAlign: "center",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = `${d.color}22`;
                        (e.currentTarget as HTMLDivElement).style.borderColor = `${d.color}99`;
                      }}
                      onMouseLeave={(e) => {
                        (e.currentTarget as HTMLDivElement).style.background = `${d.color}11`;
                        (e.currentTarget as HTMLDivElement).style.borderColor = `${d.color}44`;
                      }}
                    >
                      <div style={{ fontSize: 14, fontWeight: 800, color: "#fff", fontFamily: "Segoe UI, sans-serif" }}>{d.code}</div>
                      <div style={{ fontSize: 8, color: `${d.color}cc`, marginTop: 1, lineHeight: 1.2 }}>{d.shortName}</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>

            {/* Liens rapides */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              <button
                onClick={() => { setSelectedIntent("agent"); setShowIntentModal(true); }}
                style={{
                  background: "rgba(0,255,136,0.1)", border: "1px solid rgba(0,255,136,0.3)",
                  borderRadius: 6, padding: "6px 14px",
                  color: "#00ff88", fontSize: 11, fontWeight: 600,
                  fontFamily: "Segoe UI, sans-serif", cursor: "pointer",
                }}
              >
                Agent / Promoteur
              </button>
              <Link href="/actualites" style={{ textDecoration: "none" }}>
                <span style={{
                  display: "inline-block", padding: "6px 14px", borderRadius: 6,
                  border: "1px solid rgba(168,85,247,0.3)", background: "rgba(168,85,247,0.1)",
                  color: "#c084fc", fontSize: 11, fontWeight: 600,
                }}>
                  Analyses
                </span>
              </Link>
              <Link href="/methodologie" style={{ textDecoration: "none" }}>
                <span style={{
                  display: "inline-block", padding: "6px 14px", borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.04)",
                  color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600,
                }}>
                  Méthodologie
                </span>
              </Link>
              <button
                onClick={() => setActiveFooter(activeFooter === "about" ? null : "about")}
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 6, padding: "6px 14px",
                  color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600,
                  fontFamily: "Segoe UI, sans-serif", cursor: "pointer",
                }}
              >
                À propos
              </button>
              <button
                onClick={() => setActiveFooter(activeFooter === "contact" ? null : "contact")}
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: 6, padding: "6px 14px",
                  color: "rgba(255,255,255,0.5)", fontSize: 11, fontWeight: 600,
                  fontFamily: "Segoe UI, sans-serif", cursor: "pointer",
                }}
              >
                Contact
              </button>
              <Link href="/cgu" style={{ textDecoration: "none" }}>
                <span style={{
                  display: "inline-block", padding: "6px 14px", borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)",
                  color: "rgba(255,255,255,0.35)", fontSize: 11,
                }}>
                  CGU
                </span>
              </Link>
            </div>

            {/* Panneau À propos / Contact */}
            {activeFooter && (
              <div
                style={{
                  maxWidth: 560, width: "100%",
                  padding: "14px 18px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 10,
                  color: "rgba(255,255,255,0.6)",
                  fontSize: 13, lineHeight: 1.6,
                }}
              >
                {activeFooter === "about" && (
                  <>
                    <p style={{ margin: 0 }}>
                      Datamerry est un prototype d&apos;analyse foncière utilisant les
                      données ouvertes DVF et DPE pour identifier automatiquement les
                      micro-marchés immobiliers.
                    </p>
                    <p style={{ margin: "8px 0 0" }}>
                      L&apos;objectif est d&apos;explorer de nouvelles approches de
                      prospection et d&apos;analyse territoriale pour les
                      professionnels de l&apos;immobilier, les collectivités et les
                      investisseurs.
                    </p>
                  </>
                )}
                {activeFooter === "contact" && (
                  <p style={{ margin: 0 }}>
                    Pour toute question ou retour :{" "}
                    <a href="mailto:contact@datamerry.com" style={{ color: "#00d4ff", textDecoration: "none" }}>
                      contact@datamerry.com
                    </a>
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Signature en bas à droite */}
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 12,
          zIndex: 900,
          fontSize: 10,
          color: "rgba(255,255,255,0.25)",
          fontFamily: "Segoe UI, sans-serif",
        }}
      >
        datamerry.com · Données DVF open data
      </div>

      {/* Modal lead capture */}
      {showLeadModal && (
        <LeadModal onClose={() => setShowLeadModal(false)} />
      )}

      {/* Modal lead capture par intention */}
      {showIntentModal && (
        <AnalyseLeadModal
          commune={{ code: "IDF", nom: "Île-de-France" }}
          initialIntent={selectedIntent}
          onClose={() => { setShowIntentModal(false); setSelectedIntent(undefined); }}
        />
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
