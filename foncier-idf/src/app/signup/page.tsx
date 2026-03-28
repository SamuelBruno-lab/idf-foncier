"use client";

import { useState } from "react";
import Link from "next/link";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [prenom, setPrenom] = useState("");
  const [nomFamille, setNomFamille] = useState("");
  const [consentement, setConsentement] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !consentement) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          prenom,
          nom_famille: nomFamille,
          consentement: true,
          source: "signup",
        }),
      });
      if (res.ok) {
        setStatus("done");
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(data.error ?? "Une erreur est survenue");
        setStatus("error");
      }
    } catch {
      setErrorMsg("Erreur de connexion");
      setStatus("error");
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "12px 16px", borderRadius: 10,
    border: "1.5px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)",
    color: "#fff", fontSize: 14, fontFamily: "Segoe UI, Arial, sans-serif",
    outline: "none", boxSizing: "border-box", transition: "border-color 0.15s",
  };

  if (status === "done") {
    return (
      <div style={{ minHeight: "100vh", background: "#070714", color: "#e8e8f0", fontFamily: "Segoe UI, Arial, sans-serif", paddingTop: 52 }}>
        <div style={{ maxWidth: 440, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#fff", marginBottom: 12 }}>
            Compte cree
          </h1>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, marginBottom: 28 }}>
            Bienvenue sur datamerry, {prenom || email}. Vous pouvez maintenant explorer les micro-marches immobiliers d&apos;Ile-de-France.
          </p>
          <Link href="/" style={{
            display: "inline-block", padding: "12px 28px", borderRadius: 10,
            background: "linear-gradient(135deg, #00ff88, #00d4ff)",
            color: "#0a0a1e", fontWeight: 700, fontSize: 14,
            textDecoration: "none",
          }}>
            Explorer la carte
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: "#070714", color: "#e8e8f0", fontFamily: "Segoe UI, Arial, sans-serif", paddingTop: 52 }}>
      {/* Header */}
      <div style={{ background: "linear-gradient(135deg, rgba(0,212,255,0.06), rgba(0,255,136,0.04))", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "16px 32px" }}>
        <Link href="/" style={{ color: "rgba(0,212,255,0.7)", textDecoration: "none", fontSize: 13 }}>← Retour</Link>
      </div>

      <div style={{ maxWidth: 440, margin: "0 auto", padding: "48px 24px" }}>
        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "rgba(0,212,255,0.1)", border: "1px solid rgba(0,212,255,0.25)",
            borderRadius: 99, padding: "5px 14px", fontSize: 11, color: "#00d4ff",
            letterSpacing: 1.2, textTransform: "uppercase", fontWeight: 700, marginBottom: 16,
          }}>
            Gratuit
          </div>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>
            Creer votre compte
          </h1>
          <p style={{ margin: "12px 0 0", fontSize: 14, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
            Acces immediat aux micro-marches de 30 communes IDF + Oise
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6, letterSpacing: 0.5 }}>
                Prenom
              </label>
              <input
                type="text"
                value={prenom}
                onChange={(e) => setPrenom(e.target.value)}
                placeholder="Jean"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(0,212,255,0.5)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)")}
              />
            </div>
            <div>
              <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6, letterSpacing: 0.5 }}>
                Nom
              </label>
              <input
                type="text"
                value={nomFamille}
                onChange={(e) => setNomFamille(e.target.value)}
                placeholder="Dupont"
                style={inputStyle}
                onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(0,212,255,0.5)")}
                onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)")}
              />
            </div>
          </div>

          <div>
            <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6, letterSpacing: 0.5 }}>
              Email *
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jean@exemple.fr"
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(0,212,255,0.5)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)")}
            />
          </div>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginTop: 4 }}>
            <input
              type="checkbox"
              checked={consentement}
              onChange={(e) => setConsentement(e.target.checked)}
              style={{ marginTop: 3, accentColor: "#00d4ff" }}
            />
            <span style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", lineHeight: 1.5 }}>
              J&apos;accepte de recevoir des informations sur les micro-marches immobiliers.
              Vos donnees ne seront jamais revendues. <Link href="/cgu" style={{ color: "#00d4ff", textDecoration: "none" }}>CGU</Link>
            </span>
          </label>

          {errorMsg && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.2)", color: "#ff6b6b", fontSize: 13 }}>
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={!email || !consentement || status === "loading"}
            style={{
              width: "100%", padding: 14, borderRadius: 10, border: "none",
              background: email && consentement ? "linear-gradient(135deg, #00ff88, #00d4ff)" : "rgba(255,255,255,0.08)",
              color: email && consentement ? "#0a0a1e" : "rgba(255,255,255,0.3)",
              fontWeight: 800, fontSize: 15, cursor: email && consentement ? "pointer" : "default",
              fontFamily: "Segoe UI, Arial, sans-serif",
              boxShadow: email && consentement ? "0 4px 24px rgba(0,255,136,0.2)" : "none",
              transition: "all 0.2s",
              opacity: status === "loading" ? 0.7 : 1,
            }}
          >
            {status === "loading" ? "Creation en cours..." : "Creer mon compte gratuit"}
          </button>
        </form>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "28px 0" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>ou</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
        </div>

        {/* Pro upsell */}
        <Link href="/pricing" style={{
          display: "block", textAlign: "center", padding: "14px 20px", borderRadius: 10,
          border: "1px solid rgba(0,255,136,0.2)", background: "rgba(0,255,136,0.04)",
          color: "#00ff88", fontSize: 13, fontWeight: 700, textDecoration: "none",
          transition: "all 0.15s",
        }}>
          Essai Pro 14 jours — Top 100 communes + historique 2020-2025
        </Link>

        <p style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
          Deja inscrit ? Les donnees gratuites sont accessibles sans connexion.
        </p>
      </div>
    </div>
  );
}
