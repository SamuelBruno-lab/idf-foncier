"use client";

import { useState, useEffect } from "react";

interface Props {
  commune: { code: string; nom: string };
}

export default function WaitlistBox({ commune }: Props) {
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"idle" | "notify" | "paid">("idle");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [waitCount, setWaitCount] = useState<number | null>(null);

  useEffect(() => {
    fetch(`/api/waitlist?commune_code=${commune.code}`)
      .then((r) => r.json())
      .then((d) => { if (d.count >= 3) setWaitCount(d.count); })
      .catch(() => {});
  }, [commune.code]);

  async function submit() {
    setError("");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Adresse email invalide.");
      return;
    }
    setLoading(true);
    try {
      const endpoint = mode === "paid" ? "/api/demande-analyse" : "/api/waitlist";
      const body =
        mode === "paid"
          ? { email, commune_code: commune.code, commune_nom: commune.nom }
          : { email, commune_code: commune.code, commune_nom: commune.nom, type: "notify" };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      setDone(true);
    } catch {
      setError("Une erreur s'est produite. Réessayez.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div style={{
        background: "rgba(0,255,136,0.06)", border: "1px solid rgba(0,255,136,0.25)",
        borderRadius: 16, padding: "28px 24px", textAlign: "center",
      }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>✅</div>
        <div style={{ fontWeight: 700, color: "#00ff88", fontSize: 16, marginBottom: 8 }}>
          {mode === "paid" ? "Demande enregistrée !" : "Vous êtes sur la liste !"}
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
          {mode === "paid"
            ? `Nous vous contactons sous 24h à ${email} pour finaliser le paiement (19,99€ TTC). L'analyse sera publiée dans les 72h suivant le règlement.`
            : `Vous serez notifié à ${email} dès que l'analyse de ${commune.nom} sera disponible gratuitement.`}
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 16, padding: "28px 24px",
    }}>
      <div style={{ marginBottom: 6, fontSize: 11, color: "rgba(255,255,255,0.3)", textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 600 }}>
        Analyse non disponible
      </div>
      <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 800, color: "#fff" }}>
        {commune.nom} n'est pas encore répertoriée
      </h3>
      <p style={{ margin: "0 0 20px", fontSize: 13, color: "rgba(255,255,255,0.45)", lineHeight: 1.6 }}>
        L'analyse IA de cette commune peut être générée à la demande — carte interactive, micro-marchés, rendements locatifs.
      </p>

      {waitCount !== null && (
        <div style={{
          marginBottom: 16, padding: "8px 14px", borderRadius: 8,
          background: "rgba(0,212,255,0.08)", border: "1px solid rgba(0,212,255,0.2)",
          fontSize: 12, color: "#00d4ff",
        }}>
          <strong>{waitCount} personnes</strong> attendent cette analyse gratuitement
        </div>
      )}

      {/* Mode selector */}
      {mode === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <button
            onClick={() => setMode("paid")}
            style={{
              padding: "14px 20px", borderRadius: 10, border: "none",
              background: "linear-gradient(135deg, #00d4ff, #0099cc)",
              color: "#000", fontWeight: 700, fontSize: 15, cursor: "pointer",
              fontFamily: "Segoe UI, sans-serif", textAlign: "left",
            }}
          >
            <div>Débloquer en premier · 19,99€ TTC</div>
            <div style={{ fontWeight: 400, fontSize: 12, marginTop: 4, opacity: 0.7 }}>
              Analyse générée sous 72h — carte publique ensuite
            </div>
          </button>
          <button
            onClick={() => setMode("notify")}
            style={{
              padding: "12px 20px", borderRadius: 10, cursor: "pointer",
              border: "1px solid rgba(255,255,255,0.12)", background: "transparent",
              color: "rgba(255,255,255,0.55)", fontSize: 13, fontFamily: "Segoe UI, sans-serif",
            }}
          >
            Me prévenir quand c'est gratuit
          </button>
        </div>
      )}

      {/* Email form */}
      {mode !== "idle" && (
        <div>
          <div style={{ fontSize: 13, color: mode === "paid" ? "#00d4ff" : "rgba(255,255,255,0.5)", marginBottom: 10, fontWeight: 600 }}>
            {mode === "paid" ? "Débloquer · 19,99€ TTC" : "Me prévenir gratuitement"}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="email"
              placeholder="votre@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={{
                flex: 1, minWidth: 220, padding: "11px 14px", borderRadius: 8,
                border: "1.5px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.05)",
                color: "#fff", fontSize: 13, fontFamily: "Segoe UI, sans-serif", outline: "none",
              }}
            />
            <button
              onClick={submit}
              disabled={loading}
              style={{
                padding: "11px 20px", borderRadius: 8, border: "none",
                background: mode === "paid" ? "linear-gradient(135deg, #00d4ff, #0099cc)" : "rgba(255,255,255,0.1)",
                color: mode === "paid" ? "#000" : "#fff",
                fontWeight: 700, fontSize: 13, cursor: loading ? "default" : "pointer",
                fontFamily: "Segoe UI, sans-serif", opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "…" : mode === "paid" ? "Envoyer ma demande" : "M'inscrire"}
            </button>
          </div>
          {error && <div style={{ marginTop: 8, fontSize: 12, color: "#ff6b6b" }}>{error}</div>}
          <button
            onClick={() => { setMode("idle"); setEmail(""); setError(""); }}
            style={{ marginTop: 10, background: "none", border: "none", color: "rgba(255,255,255,0.25)", fontSize: 11, cursor: "pointer" }}
          >
            ← Retour
          </button>
        </div>
      )}
    </div>
  );
}
