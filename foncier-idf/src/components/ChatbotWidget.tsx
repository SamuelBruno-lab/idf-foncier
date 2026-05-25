"use client";

/**
 * DATAMERRY ChatbotWidget — composant React conversationnel.
 *
 * Usage côté page Next.js :
 *   <ChatbotWidget apiKey="dmk_live_..." apiBase="https://datamerry.com" />
 *
 * Pour l'embed cross-site (cabinets), un wrapper /public/chatbot.js sera créé
 * dans un second temps (équivalent du widget.js existant).
 *
 * Architecture :
 *   - state: messages[] + isStreaming
 *   - submit: POST /api/chatbot/converse → SSE stream → on append les tokens
 *   - tool calls : affichés comme événements intermédiaires (chip status)
 */

import { useEffect, useMemo, useRef, useState } from "react";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolEvents?: ToolEvent[];
  isStreaming?: boolean;
};

type ToolEvent = {
  name: string;
  status: "running" | "done";
};

type StreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call_start"; name: string; arguments: string }
  | { type: "tool_call_result"; name: string; result: unknown }
  | { type: "provider"; name: "groq" | "cerebras" | "degraded" }
  | { type: "done" }
  | { type: "error"; message: string };

export type ChatbotWidgetProps = {
  apiKey: string;
  apiBase?: string;
  cabinetName?: string;
  primaryColor?: string;
  initialMessage?: string;
  suggestions?: string[];
};

// ──────────────────────────────────────────────────────────────────────────────
// Markdown léger (sans dépendance)
// ──────────────────────────────────────────────────────────────────────────────

function renderInlineMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function renderMarkdown(md: string): string {
  // Ultra-light : paragraphes, listes -, tableaux pipe-style
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Table : ligne avec | + ligne suivante avec --- = header
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (!inTable) {
        out.push('<table class="dm-cb-table">');
        inTable = true;
      }
      const cells = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      const isSeparator = cells.every((c) => /^:?-+:?$/.test(c));
      if (isSeparator) continue;
      const tag = lines[i + 1]?.trim().match(/^\|[\s|:-]+\|$/) ? "th" : "td";
      out.push("<tr>" + cells.map((c) => `<${tag}>${renderInlineMarkdown(c)}</${tag}>`).join("") + "</tr>");
      continue;
    } else if (inTable) {
      out.push("</table>");
      inTable = false;
    }

    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      if (!inList) {
        out.push("<ul>");
        inList = true;
      }
      out.push(`<li>${renderInlineMarkdown(trimmed.slice(2))}</li>`);
      continue;
    } else if (inList) {
      out.push("</ul>");
      inList = false;
    }

    if (trimmed.startsWith("### ")) {
      out.push(`<h4>${renderInlineMarkdown(trimmed.slice(4))}</h4>`);
    } else if (trimmed.startsWith("## ")) {
      out.push(`<h3>${renderInlineMarkdown(trimmed.slice(3))}</h3>`);
    } else if (trimmed.startsWith("# ")) {
      out.push(`<h2>${renderInlineMarkdown(trimmed.slice(2))}</h2>`);
    } else if (trimmed === "") {
      out.push("<br>");
    } else {
      out.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
    }
  }

  if (inList) out.push("</ul>");
  if (inTable) out.push("</table>");
  return out.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────────
// Tool name → label FR human-readable
// ──────────────────────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  estimate_property: "Estimation marché",
  compute_yield: "Calcul rendement locatif",
  get_fiscal_zone: "Zone fiscale + plafonds",
  compare_rental_strategies: "Comparaison 8 stratégies locatives",
  neighborhood_report: "Analyse quartier",
};

// ──────────────────────────────────────────────────────────────────────────────
// Composant
// ──────────────────────────────────────────────────────────────────────────────

export default function ChatbotWidget({
  apiKey,
  apiBase = "",
  cabinetName = "DATAMERRY",
  primaryColor = "#1f3a8a",
  initialMessage,
  suggestions = [
    "Estime le 10 rue de Rivoli 75001, 62 m², T3, achat 850k€, TMI 41%",
    "Quel dispositif fiscal choisir à Drancy 93700 pour un T2 ?",
    "Compare libre marché vs LLI vs Jeanbrun à Boulogne-Billancourt",
    "Profil quartier 15 rue de la Roquette 75011",
  ],
}: ChatbotWidgetProps) {
  const greeting =
    initialMessage ??
    `Bonjour 👋 Je suis l'assistant IA ${cabinetName}, propulsé par DATAMERRY. Donne-moi une adresse, surface, prix d'achat éventuel et TMI : j'estime, je calcule rendement et plafonds fiscaux, et je compare les 8 stratégies locatives. Pose ta question en langage naturel.`;

  const [messages, setMessages] = useState<Msg[]>([
    { id: "init", role: "assistant", content: greeting },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll bottom on new message
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  async function submit(textOverride?: string) {
    const text = (textOverride ?? input).trim();
    if (!text || isStreaming) return;

    setError(null);
    setInput("");
    setIsStreaming(true);

    const userMsg: Msg = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
    };
    const assistantId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      userMsg,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        toolEvents: [],
        isStreaming: true,
      },
    ]);

    // Build history pour le backend (uniquement les msgs valides — pas le greeting initial)
    const history = [...messages, userMsg]
      .filter((m) => m.id !== "init")
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const resp = await fetch(`${apiBase}/api/chatbot/converse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify({ messages: history }),
      });

      if (!resp.ok || !resp.body) {
        const errBody = await resp.text().catch(() => "");
        throw new Error(`HTTP ${resp.status}: ${errBody.slice(0, 200)}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          let ev: StreamEvent;
          try {
            ev = JSON.parse(data) as StreamEvent;
          } catch {
            continue;
          }
          handleEvent(assistantId, ev);
        }
      }
    } catch (err) {
      console.error("[chatbot] stream failed:", err);
      setError(String(err));
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, content: m.content + "\n\n⚠️ Erreur de connexion. Réessaie.", isStreaming: false }
            : m,
        ),
      );
    } finally {
      setIsStreaming(false);
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, isStreaming: false } : m)),
      );
    }
  }

  function handleEvent(assistantId: string, ev: StreamEvent) {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId) return m;
        switch (ev.type) {
          case "token":
            return { ...m, content: m.content + ev.content };
          case "tool_call_start":
            return {
              ...m,
              toolEvents: [...(m.toolEvents ?? []), { name: ev.name, status: "running" }],
            };
          case "tool_call_result":
            return {
              ...m,
              toolEvents: (m.toolEvents ?? []).map((te) =>
                te.name === ev.name && te.status === "running" ? { ...te, status: "done" } : te,
              ),
            };
          case "error":
            return { ...m, content: m.content + `\n\n⚠️ ${ev.message}` };
          default:
            return m;
        }
      }),
    );
  }

  const cssVars = useMemo(
    () =>
      ({
        "--dm-cb-primary": primaryColor,
      }) as React.CSSProperties,
    [primaryColor],
  );

  return (
    <div className="dm-cb" style={cssVars}>
      <header className="dm-cb__hdr">
        <span className="dm-cb__title">
          <span className="dm-cb__dot" /> Assistant IA {cabinetName}
        </span>
        <span className="dm-cb__powered">propulsé par DATAMERRY</span>
      </header>

      <div ref={bodyRef} className="dm-cb__body">
        {messages.map((m) => (
          <div key={m.id} className={`dm-cb__msg dm-cb__msg--${m.role}`}>
            <div className="dm-cb__avatar">{m.role === "user" ? "👤" : "🤖"}</div>
            <div className="dm-cb__bubble">
              {m.toolEvents && m.toolEvents.length > 0 ? (
                <div className="dm-cb__tools">
                  {m.toolEvents.map((te, i) => (
                    <span key={i} className={`dm-cb__tool dm-cb__tool--${te.status}`}>
                      {te.status === "running" ? "⏳" : "✅"}{" "}
                      {TOOL_LABELS[te.name] ?? te.name}
                    </span>
                  ))}
                </div>
              ) : null}
              <div
                className="dm-cb__content"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }}
              />
              {m.isStreaming && (
                <span className="dm-cb__typing">
                  <span /> <span /> <span />
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      {!isStreaming && messages.length <= 2 && (
        <div className="dm-cb__suggestions">
          {suggestions.map((s, i) => (
            <button key={i} className="dm-cb__suggestion" onClick={() => submit(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        className="dm-cb__input"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          type="text"
          className="dm-cb__field"
          placeholder="Pose ta question en langage naturel…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={isStreaming}
        />
        <button type="submit" className="dm-cb__send" disabled={isStreaming || !input.trim()}>
          {isStreaming ? "…" : "Envoyer"}
        </button>
      </form>

      {error && <div className="dm-cb__error">{error}</div>}

      <style jsx>{`
        .dm-cb {
          --dm-cb-bg: #ffffff;
          --dm-cb-muted: #64748b;
          --dm-cb-border: #e2e8f0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          background: var(--dm-cb-bg);
          border: 1px solid var(--dm-cb-border);
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
          display: flex;
          flex-direction: column;
          max-height: 720px;
          color: #0f172a;
        }
        .dm-cb__hdr {
          background: linear-gradient(135deg, var(--dm-cb-primary) 0%, color-mix(in srgb, var(--dm-cb-primary) 70%, black) 100%);
          color: white;
          padding: 14px 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .dm-cb__title {
          font-weight: 700;
          font-size: 15px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .dm-cb__dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #4ade80;
          box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6);
          animation: dm-cb-pulse 2s infinite;
        }
        @keyframes dm-cb-pulse {
          0% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0.6); }
          70% { box-shadow: 0 0 0 8px rgba(74, 222, 128, 0); }
          100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
        }
        .dm-cb__powered {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          opacity: 0.85;
        }
        .dm-cb__body {
          flex: 1;
          overflow-y: auto;
          padding: 16px 20px;
          background: #f8fafc;
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-height: 400px;
        }
        .dm-cb__msg {
          display: flex;
          gap: 10px;
          max-width: 92%;
        }
        .dm-cb__msg--user {
          flex-direction: row-reverse;
          align-self: flex-end;
        }
        .dm-cb__avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          background: white;
          border: 1px solid var(--dm-cb-border);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          flex-shrink: 0;
        }
        .dm-cb__bubble {
          background: white;
          padding: 10px 14px;
          border-radius: 12px;
          border: 1px solid var(--dm-cb-border);
          font-size: 13px;
          line-height: 1.5;
          max-width: 100%;
        }
        .dm-cb__msg--user .dm-cb__bubble {
          background: var(--dm-cb-primary);
          color: white;
          border-color: var(--dm-cb-primary);
        }
        .dm-cb__msg--user :global(p) { color: white; }
        .dm-cb__content :global(p) { margin: 0 0 6px 0; }
        .dm-cb__content :global(p:last-child) { margin-bottom: 0; }
        .dm-cb__content :global(h2),
        .dm-cb__content :global(h3),
        .dm-cb__content :global(h4) {
          color: var(--dm-cb-primary);
          margin: 8px 0 4px 0;
          font-size: 13px;
          font-weight: 700;
        }
        .dm-cb__content :global(ul) { margin: 4px 0; padding-left: 20px; }
        .dm-cb__content :global(li) { margin-bottom: 2px; }
        .dm-cb__content :global(strong) { color: inherit; }
        .dm-cb__content :global(table.dm-cb-table) {
          width: 100%;
          border-collapse: collapse;
          margin: 6px 0;
          font-size: 11px;
        }
        .dm-cb__content :global(table.dm-cb-table th),
        .dm-cb__content :global(table.dm-cb-table td) {
          border: 1px solid var(--dm-cb-border);
          padding: 4px 6px;
          text-align: left;
        }
        .dm-cb__content :global(table.dm-cb-table th) {
          background: #f1f5f9;
          font-weight: 600;
        }
        .dm-cb__content :global(code) {
          background: #f1f5f9;
          padding: 1px 4px;
          border-radius: 3px;
          font-size: 11px;
          font-family: "SF Mono", Menlo, monospace;
        }
        .dm-cb__tools {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-bottom: 8px;
        }
        .dm-cb__tool {
          font-size: 11px;
          padding: 3px 8px;
          border-radius: 10px;
          background: #f1f5f9;
          color: #475569;
          border: 1px solid var(--dm-cb-border);
        }
        .dm-cb__tool--done {
          background: #ecfdf5;
          color: #065f46;
          border-color: #a7f3d0;
        }
        .dm-cb__typing { display: inline-flex; gap: 3px; margin-left: 4px; }
        .dm-cb__typing span {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #94a3b8;
          animation: dm-cb-bounce 1.4s infinite;
        }
        .dm-cb__typing span:nth-child(2) { animation-delay: 0.2s; }
        .dm-cb__typing span:nth-child(3) { animation-delay: 0.4s; }
        @keyframes dm-cb-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        .dm-cb__suggestions {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          padding: 8px 20px 0;
        }
        .dm-cb__suggestion {
          background: white;
          border: 1px solid var(--dm-cb-border);
          padding: 6px 12px;
          border-radius: 16px;
          font-size: 11px;
          color: #475569;
          cursor: pointer;
          font-family: inherit;
        }
        .dm-cb__suggestion:hover {
          background: var(--dm-cb-primary);
          color: white;
          border-color: var(--dm-cb-primary);
        }
        .dm-cb__input {
          border-top: 1px solid var(--dm-cb-border);
          padding: 12px 20px;
          background: white;
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .dm-cb__field {
          flex: 1;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 13px;
          font-family: inherit;
          outline: none;
        }
        .dm-cb__field:focus { border-color: var(--dm-cb-primary); }
        .dm-cb__send {
          background: var(--dm-cb-primary);
          color: white;
          border: none;
          border-radius: 8px;
          padding: 9px 16px;
          font-weight: 600;
          cursor: pointer;
          font-size: 13px;
          font-family: inherit;
        }
        .dm-cb__send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .dm-cb__error {
          background: #fef2f2;
          color: #991b1b;
          padding: 8px 20px;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}
