"use client";

/**
 * Page démo /chatbot — accessible publiquement pour pitch à Diara.
 *
 * Modes :
 *   - Sans ?key=... : prompt visuel pour saisir une clé API DATAMERRY temporaire
 *     (stockée en sessionStorage uniquement, jamais envoyée ailleurs que l'API DATAMERRY)
 *   - Avec ?key=wdmk_live_... : démarre direct
 *
 * Pour la démo Collabimmo, Samuel peut envoyer un lien type :
 *   https://datamerry.com/chatbot?key=wdmk_live_xxxx&cabinet=Collabimmo&color=%23c2410c
 */

import { useEffect, useMemo, useState } from "react";
import ChatbotWidget from "@/components/ChatbotWidget";

const STORAGE_KEY = "dm-chatbot-apikey";

export default function ChatbotDemoPage() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [ready, setReady] = useState(false);
  const [params, setParams] = useState<{
    cabinet?: string;
    color?: string;
  }>({});

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlKey = urlParams.get("key");
    const stored = sessionStorage.getItem(STORAGE_KEY);
    const found = urlKey ?? stored;
    if (found) {
      setApiKey(found);
      if (urlKey) sessionStorage.setItem(STORAGE_KEY, urlKey);
    }
    setParams({
      cabinet: urlParams.get("cabinet") ?? undefined,
      color: urlParams.get("color") ?? undefined,
    });
    setReady(true);
  }, []);

  const cabinetName = params.cabinet ?? "DATAMERRY";
  const primaryColor = params.color ?? "#1f3a8a";

  const wrapperStyle = useMemo(
    () => ({
      background: "linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)",
      minHeight: "100vh",
      padding: "32px 16px",
    }),
    [],
  );

  if (!ready) return null;

  if (!apiKey) {
    return (
      <div style={wrapperStyle}>
        <div
          style={{
            maxWidth: 520,
            margin: "10vh auto 0",
            background: "white",
            borderRadius: 16,
            padding: 32,
            boxShadow: "0 4px 24px rgba(0,0,0,.06)",
            border: "1px solid #e2e8f0",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22, color: primaryColor }}>
            Assistant IA DATAMERRY
          </h1>
          <p style={{ marginTop: 8, color: "#64748b", fontSize: 14 }}>
            Entre ta clé API DATAMERRY pour démarrer la conversation. Format :{" "}
            <code
              style={{
                background: "#f1f5f9",
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              dmk_live_…
            </code>{" "}
            ou{" "}
            <code
              style={{
                background: "#f1f5f9",
                padding: "1px 6px",
                borderRadius: 4,
                fontSize: 12,
              }}
            >
              wdmk_live_…
            </code>
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const k = keyInput.trim();
              if (!k.startsWith("dmk_") && !k.startsWith("wdmk_")) return;
              sessionStorage.setItem(STORAGE_KEY, k);
              setApiKey(k);
            }}
            style={{ marginTop: 20, display: "flex", gap: 8 }}
          >
            <input
              type="text"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="dmk_live_xxxxxxxx ou wdmk_live_xxxxxxxx"
              style={{
                flex: 1,
                padding: "10px 12px",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                fontSize: 13,
                fontFamily: "inherit",
                outline: "none",
              }}
            />
            <button
              type="submit"
              style={{
                background: primaryColor,
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "10px 20px",
                fontWeight: 600,
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Démarrer
            </button>
          </form>
          <p style={{ marginTop: 16, fontSize: 11, color: "#94a3b8" }}>
            🔒 Ta clé reste sur ton navigateur (sessionStorage). Pas de stockage
            serveur, pas de cookies tiers.
          </p>
          <p style={{ marginTop: 8, fontSize: 11, color: "#94a3b8" }}>
            Pas encore de clé ? Souscris au tarif standard 39€ TTC/mo
            (1er mois offert) sur datamerry.com/api.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 24px",
            background: "white",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            marginBottom: 16,
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          <span style={{ fontWeight: 800, fontSize: 20, color: primaryColor }}>
            {cabinetName.toUpperCase()}
          </span>
          <button
            onClick={() => {
              sessionStorage.removeItem(STORAGE_KEY);
              setApiKey(null);
              setKeyInput("");
            }}
            style={{
              background: "transparent",
              border: "1px solid #cbd5e1",
              borderRadius: 8,
              padding: "6px 12px",
              fontSize: 11,
              cursor: "pointer",
              color: "#64748b",
              fontFamily: "inherit",
            }}
          >
            Changer de clé
          </button>
        </header>

        <ChatbotWidget
          apiKey={apiKey}
          cabinetName={cabinetName}
          primaryColor={primaryColor}
        />

        <p
          style={{
            marginTop: 16,
            textAlign: "center",
            fontSize: 11,
            color: "#94a3b8",
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          Stack : Groq Llama 3.3 70B (primary) · Cerebras Llama 3.3 70B (fallback)
          · 5 tools function calling sur endpoints DATAMERRY
        </p>
      </div>
    </div>
  );
}
