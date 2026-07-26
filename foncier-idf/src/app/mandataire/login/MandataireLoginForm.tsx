"use client";

import { useState } from "react";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";
const BORDER = "#e2e8f0";
const GREEN = "#10b981";
const RED = "#dc2626";

export function MandataireLoginForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/mandataire/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json()) as {
        ok: boolean;
        message?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        throw new Error(data.message ?? data.error ?? "Erreur");
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div
        style={{
          background: "#ecfdf5",
          border: `1px solid ${GREEN}`,
          borderRadius: 6,
          padding: 16,
          color: "#064e3b",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
          ✅ Email envoyé
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          Si <strong>{email}</strong> correspond à un mandataire Eurealimmo, vous
          venez de recevoir un email contenant votre lien d'accès personnel.
          <br />
          <br />
          Pensez à vérifier le dossier <strong>spam / courriers indésirables</strong>.
          L'expéditeur est <em>samuel@datamerry.com</em>.
        </div>
        <button
          type="button"
          onClick={() => {
            setSent(false);
            setEmail("");
          }}
          style={{
            marginTop: 12,
            background: "transparent",
            color: "#064e3b",
            border: `1px solid #064e3b`,
            padding: "6px 12px",
            borderRadius: 4,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Renvoyer
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <label style={{ display: "block" }}>
        <span
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            color: DARK,
            marginBottom: 6,
          }}
        >
          Email professionnel
        </span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="diara.camara@example.com"
          autoComplete="email"
          disabled={loading}
          style={{
            width: "100%",
            padding: "10px 12px",
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            fontSize: 14,
            color: DARK,
            fontFamily: "inherit",
          }}
        />
      </label>

      {error && (
        <div
          style={{
            padding: 10,
            background: "#fee2e2",
            border: `1px solid ${RED}`,
            borderRadius: 4,
            color: RED,
            fontSize: 12,
          }}
        >
          ⚠️ {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading || !email.trim()}
        style={{
          padding: "12px 20px",
          background: loading ? "#94a3b8" : DARK,
          color: "white",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 700,
          cursor: loading ? "wait" : "pointer",
          marginTop: 4,
        }}
      >
        {loading ? "Envoi en cours…" : "Recevoir mon lien d'accès"}
      </button>
    </form>
  );
}
