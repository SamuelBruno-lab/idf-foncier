"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";

const ROLES = [
  { key: "agent", label: "Agent immobilier", emoji: "🏠" },
  { key: "promoteur", label: "Promoteur / Marchand de biens", emoji: "🏗️" },
  { key: "investisseur", label: "Investisseur", emoji: "📈" },
  { key: "collectivite", label: "Collectivité", emoji: "🏛️" },
  { key: "autre", label: "Autre", emoji: "👤" },
];

const GOALS = [
  { key: "estimer", label: "Estimer un bien", emoji: "🎯" },
  { key: "opportunites", label: "Trouver des opportunités", emoji: "🔍" },
  { key: "analyser", label: "Analyser un marché", emoji: "📊" },
  { key: "convaincre", label: "Convaincre un client", emoji: "💼" },
];

type CommuneSuggestion = { code: string; nom: string };

export default function OnboardingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [step, setStep] = useState(0); // 0=role, 1=goal, 2=zone
  const [role, setRole] = useState("");
  const [goal, setGoal] = useState("");
  const [communeQuery, setCommuneQuery] = useState("");
  const [communeCode, setCommuneCode] = useState("");
  const [communeNom, setCommuneNom] = useState("");
  const [suggestions, setSuggestions] = useState<CommuneSuggestion[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Redirect if not logged in
  useEffect(() => {
    if (!loading && !user) router.replace("/signup");
  }, [loading, user, router]);

  // Commune autocomplete
  useEffect(() => {
    if (communeQuery.length < 2) { setSuggestions([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/communes/search?q=${encodeURIComponent(communeQuery)}`);
        setSuggestions(await res.json());
      } catch { /* ignore */ }
    }, 250);
    return () => clearTimeout(timer);
  }, [communeQuery]);

  const handleSubmit = useCallback(async () => {
    if (!user || !role || !goal) return;
    setSubmitting(true);

    await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: user.id,
        email: user.email,
        prenom: user.user_metadata?.prenom ?? "",
        nom: user.user_metadata?.nom_famille ?? "",
        role,
        goal,
        commune_code: communeCode,
        commune_nom: communeNom,
      }),
    }).catch(() => {});

    // Redirect to their commune or home
    if (communeCode) {
      router.push(`/commune/${communeCode}`);
    } else {
      router.push("/");
    }
  }, [user, role, goal, communeCode, communeNom, router]);

  if (loading) return null;

  const prenom = user?.user_metadata?.prenom ?? user?.email?.split("@")[0] ?? "";

  const pillStyle = (selected: boolean, color: string): React.CSSProperties => ({
    padding: "14px 18px", borderRadius: 12,
    background: selected ? `${color}15` : "rgba(255,255,255,0.03)",
    border: `1.5px solid ${selected ? color : "rgba(255,255,255,0.08)"}`,
    color: selected ? "#fff" : "rgba(255,255,255,0.5)",
    fontSize: 14, fontWeight: selected ? 700 : 500,
    cursor: "pointer", transition: "all 0.15s",
    display: "flex", alignItems: "center", gap: 10,
    fontFamily: "Segoe UI, Arial, sans-serif",
    textAlign: "left" as const,
    width: "100%",
  });

  return (
    <div style={{ minHeight: "100vh", background: "#070714", color: "#e8e8f0", fontFamily: "Segoe UI, Arial, sans-serif", paddingTop: 52 }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "48px 24px" }}>

        {/* Progress bar */}
        <div style={{ display: "flex", gap: 6, marginBottom: 36 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: i <= step ? "linear-gradient(90deg, #00ff88, #00d4ff)" : "rgba(255,255,255,0.08)",
              transition: "background 0.3s",
            }} />
          ))}
        </div>

        {/* Step 0: Role */}
        {step === 0 && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#fff", margin: "0 0 8px" }}>
              Bienvenue{prenom ? `, ${prenom}` : ""} 👋
            </h1>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", marginBottom: 28 }}>
              Quel est votre profil ?
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {ROLES.map((r) => (
                <button key={r.key} onClick={() => { setRole(r.key); setStep(1); }} style={pillStyle(role === r.key, "#00d4ff")}>
                  <span style={{ fontSize: 18 }}>{r.emoji}</span>
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Goal */}
        {step === 1 && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#fff", margin: "0 0 8px" }}>
              Votre objectif principal ?
            </h1>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", marginBottom: 28 }}>
              On adapte l&apos;expérience à votre besoin
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {GOALS.map((g) => (
                <button key={g.key} onClick={() => { setGoal(g.key); setStep(2); }} style={pillStyle(goal === g.key, "#00ff88")}>
                  <span style={{ fontSize: 18 }}>{g.emoji}</span>
                  {g.label}
                </button>
              ))}
            </div>
            <button onClick={() => setStep(0)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 12, marginTop: 16, fontFamily: "inherit" }}>
              ← Retour
            </button>
          </div>
        )}

        {/* Step 2: Zone */}
        {step === 2 && (
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#fff", margin: "0 0 8px" }}>
              Votre zone d&apos;intérêt ?
            </h1>
            <p style={{ fontSize: 14, color: "rgba(255,255,255,0.45)", marginBottom: 28 }}>
              On centre la carte sur votre commune
            </p>

            <div style={{ position: "relative", marginBottom: 20 }}>
              <input
                type="text"
                value={communeQuery}
                onChange={(e) => { setCommuneQuery(e.target.value); setCommuneCode(""); setCommuneNom(""); }}
                placeholder="Rechercher une commune..."
                autoFocus
                style={{
                  width: "100%", padding: "14px 16px", borderRadius: 12,
                  border: `1.5px solid ${communeCode ? "#00ff88" : "rgba(255,255,255,0.12)"}`,
                  background: communeCode ? "rgba(0,255,136,0.05)" : "rgba(255,255,255,0.04)",
                  color: "#fff", fontSize: 15, fontFamily: "Segoe UI, Arial, sans-serif",
                  outline: "none", boxSizing: "border-box",
                }}
              />
              {communeCode && (
                <span style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", color: "#00ff88", fontSize: 18 }}>✓</span>
              )}
              {suggestions.length > 0 && !communeCode && (
                <div style={{
                  position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                  background: "#0d0d2b", border: "1px solid rgba(0,212,255,0.3)",
                  borderRadius: 10, overflow: "hidden", zIndex: 100, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
                }}>
                  {suggestions.map((s) => (
                    <div key={s.code}
                      onClick={() => { setCommuneCode(s.code); setCommuneNom(s.nom); setCommuneQuery(s.nom); setSuggestions([]); }}
                      style={{
                        padding: "12px 16px", cursor: "pointer", color: "#fff",
                        fontSize: 14, borderBottom: "1px solid rgba(255,255,255,0.06)",
                        display: "flex", justifyContent: "space-between",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(0,212,255,0.1)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <span>{s.nom}</span>
                      <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>{s.code}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              style={{
                width: "100%", padding: 14, borderRadius: 10, border: "none",
                background: "linear-gradient(135deg, #00ff88, #00d4ff)",
                color: "#0a0a1e", fontWeight: 800, fontSize: 15, cursor: "pointer",
                fontFamily: "Segoe UI, Arial, sans-serif",
                boxShadow: "0 4px 24px rgba(0,255,136,0.2)",
                opacity: submitting ? 0.7 : 1,
                transition: "all 0.2s",
              }}
            >
              {submitting
                ? "Chargement..."
                : communeCode
                  ? `Voir les micro-marchés de ${communeNom}`
                  : "Explorer la carte IDF"
              }
            </button>

            <button onClick={() => setStep(1)} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 12, marginTop: 16, fontFamily: "inherit" }}>
              ← Retour
            </button>

            <button
              onClick={handleSubmit}
              style={{ display: "block", background: "none", border: "none", color: "rgba(255,255,255,0.25)", cursor: "pointer", fontSize: 12, marginTop: 8, fontFamily: "inherit" }}
            >
              Passer cette étape →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
