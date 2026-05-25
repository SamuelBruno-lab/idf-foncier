"use client";

/**
 * Page /chatbot/embed — version iframe-friendly (sans nav globale, sans bouton
 * "changer de clé"). Chargée par /public/chatbot.js dans une iframe sur le
 * site du cabinet.
 *
 * Query params attendus :
 *   ?key=wdmk_live_...   (obligatoire)
 *   &cabinet=Collabimmo  (nom affiché)
 *   &color=%23c2410c     (couleur primaire URL-encoded)
 *   &greeting=...        (message d'accueil custom, optionnel)
 *
 * Comportement :
 *   - Si pas de clé : message d'erreur lisible (pas de prompt — c'est embed)
 *   - Auto-resize : envoie postMessage('datamerry-chatbot-height', N) au parent
 *     à chaque changement de hauteur du contenu.
 */

import { useEffect, useRef, useState } from "react";
import ChatbotWidget from "@/components/ChatbotWidget";

export default function ChatbotEmbedPage() {
  const [ready, setReady] = useState(false);
  const [params, setParams] = useState<{
    key?: string;
    cabinet?: string;
    color?: string;
    greeting?: string;
  }>({});
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setParams({
      key: sp.get("key") ?? undefined,
      cabinet: sp.get("cabinet") ?? undefined,
      color: sp.get("color") ?? undefined,
      greeting: sp.get("greeting") ?? undefined,
    });
    setReady(true);
  }, []);

  // Auto-resize : notifie le parent (host page Collabimmo) de la hauteur
  // du contenu à chaque mutation du DOM, pour qu'il ajuste l'iframe.
  useEffect(() => {
    if (!ready) return;
    const el = containerRef.current;
    if (!el) return;

    let lastHeight = 0;
    const notify = () => {
      const h = el.scrollHeight;
      if (h !== lastHeight && h > 0) {
        lastHeight = h;
        window.parent.postMessage(
          { type: "datamerry-chatbot-height", height: h },
          "*",
        );
      }
    };

    // Initial + ResizeObserver + MutationObserver pour suivre tous les changements
    notify();
    const ro = new ResizeObserver(notify);
    ro.observe(el);
    const mo = new MutationObserver(notify);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    const interval = window.setInterval(notify, 800); // fallback poll

    return () => {
      ro.disconnect();
      mo.disconnect();
      window.clearInterval(interval);
    };
  }, [ready]);

  if (!ready) return null;

  if (!params.key) {
    return (
      <div
        style={{
          padding: 24,
          fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
          fontSize: 13,
          color: "#991b1b",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 12,
          textAlign: "center",
        }}
      >
        ⚠️ Attribut <code>data-key</code> manquant ou invalide. Récupérez votre
        clé widget (wdmk_live_…) auprès de DATAMERRY.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        margin: 0,
        padding: 0,
        background: "transparent",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      }}
    >
      <ChatbotWidget
        apiKey={params.key}
        cabinetName={params.cabinet ?? "DATAMERRY"}
        primaryColor={params.color ?? "#1f3a8a"}
        initialMessage={params.greeting}
      />
    </div>
  );
}
