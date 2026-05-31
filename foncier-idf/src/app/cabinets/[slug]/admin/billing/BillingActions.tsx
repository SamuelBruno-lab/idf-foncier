"use client";

/**
 * Boutons d'action billing côté client.
 *
 * action="checkout" : lance la souscription via Stripe Checkout
 * action="portal"   : ouvre le portail client Stripe (gestion abonnement)
 */

import { useState } from "react";

export function BillingActions({
  slug,
  action,
  brandColor,
}: {
  slug: string;
  action: "checkout" | "portal";
  brandColor: string;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setLoading(true);
    setError(null);
    try {
      const url =
        action === "checkout"
          ? `/api/cabinets/${slug}/billing/checkout`
          : `/api/cabinets/${slug}/billing/portal`;
      const res = await fetch(url, { method: "POST" });
      const j = (await res.json()) as { ok?: boolean; url?: string; error?: string; detail?: string; hint?: string };
      if (!j.ok || !j.url) {
        setError(`${j.error ?? "Erreur"}${j.detail ? ` : ${j.detail}` : ""}${j.hint ? ` — ${j.hint}` : ""}`);
        setLoading(false);
        return;
      }
      window.location.href = j.url;
    } catch (err) {
      setError("Erreur réseau : " + (err instanceof Error ? err.message : "inconnue"));
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        style={{
          background: brandColor,
          color: "white",
          border: "none",
          padding: "14px 28px",
          borderRadius: 6,
          fontWeight: 700,
          fontSize: 15,
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.7 : 1,
          letterSpacing: "0.02em",
          minWidth: 240,
        }}
      >
        {loading
          ? "Redirection…"
          : action === "checkout"
            ? "🚀 Souscrire à DATAMERRY Pro"
            : "⚙️ Gérer mon abonnement"}
      </button>
      {error && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: "#fee2e2",
            color: "#991b1b",
            borderRadius: 6,
            fontSize: 12,
            textAlign: "left",
            maxWidth: 500,
            margin: "12px auto 0",
          }}
        >
          ⚠️ {error}
        </div>
      )}
    </>
  );
}
