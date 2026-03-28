"use client";

import { useState } from "react";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setStatus("loading");
    setErrorMsg("");

    // For now: magic link flow — store the login attempt and show confirmation
    // TODO: wire to Supabase Auth magic link when auth is configured
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          consentement: true,
          source: "login",
        }),
      });
      if (res.ok) {
        setStatus("sent");
      } else {
        setErrorMsg("Email non reconnu. Avez-vous un compte ?");
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

  if (status === "sent") {
    return (
      <div style={{ minHeight: "100vh", background: "#070714", color: "#e8e8f0", fontFamily: "Segoe UI, Arial, sans-serif", paddingTop: 52 }}>
        <div style={{ maxWidth: 440, margin: "0 auto", padding: "80px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "#fff", marginBottom: 12 }}>
            Lien de connexion envoye
          </h1>
          <p style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, marginBottom: 28 }}>
            Consultez votre boite mail <strong style={{ color: "#00d4ff" }}>{email}</strong> et cliquez sur le lien pour vous connecter. Le lien expire dans 15 minutes.
          </p>
          <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>
            Pas de mail recu ? Verifiez vos spams ou{" "}
            <button onClick={() => setStatus("idle")} style={{ background: "none", border: "none", color: "#00d4ff", cursor: "pointer", fontSize: 12, fontFamily: "inherit", padding: 0 }}>
              reessayez
            </button>
          </p>
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

      <div style={{ maxWidth: 400, margin: "0 auto", padding: "60px 24px" }}>
        {/* Title */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>
            Connexion
          </h1>
          <p style={{ margin: "12px 0 0", fontSize: 14, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
            Entrez votre email pour recevoir un lien de connexion
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", display: "block", marginBottom: 6, letterSpacing: 0.5 }}>
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jean@exemple.fr"
              autoFocus
              style={inputStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = "rgba(0,212,255,0.5)")}
              onBlur={(e) => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)")}
            />
          </div>

          {errorMsg && (
            <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(255,107,107,0.1)", border: "1px solid rgba(255,107,107,0.2)", color: "#ff6b6b", fontSize: 13 }}>
              {errorMsg}
            </div>
          )}

          <button
            type="submit"
            disabled={!email || status === "loading"}
            style={{
              width: "100%", padding: 14, borderRadius: 10, border: "none",
              background: email ? "linear-gradient(135deg, #00d4ff, #a855f7)" : "rgba(255,255,255,0.08)",
              color: email ? "#fff" : "rgba(255,255,255,0.3)",
              fontWeight: 800, fontSize: 15, cursor: email ? "pointer" : "default",
              fontFamily: "Segoe UI, Arial, sans-serif",
              boxShadow: email ? "0 4px 24px rgba(0,212,255,0.2)" : "none",
              transition: "all 0.2s",
              opacity: status === "loading" ? 0.7 : 1,
            }}
          >
            {status === "loading" ? "Envoi en cours..." : "Envoyer le lien de connexion"}
          </button>
        </form>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "28px 0" }}>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.25)" }}>pas encore de compte ?</span>
          <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.08)" }} />
        </div>

        <Link href="/signup" style={{
          display: "block", textAlign: "center", padding: "12px 20px", borderRadius: 10,
          border: "1px solid rgba(0,255,136,0.2)", background: "rgba(0,255,136,0.04)",
          color: "#00ff88", fontSize: 13, fontWeight: 700, textDecoration: "none",
        }}>
          Creer un compte gratuit
        </Link>
      </div>
    </div>
  );
}
