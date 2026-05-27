"use client";

/**
 * Page login admin cabinet — saisie email puis envoi du magic link.
 *
 * URL : /cabinets/{slug}/admin/login
 *
 * Branding cabinet (couleur primary) pour cohérence visuelle avec la page
 * publique /estimer. Si l'email matche contact_email du cabinet, un lien
 * de connexion est envoyé par Resend.
 */

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type Cabinet = {
  cabinet_name: string;
  primary_color: string;
};

export default function AdminLoginPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [slug, setSlug] = useState<string>("");
  const [cabinet, setCabinet] = useState<Cabinet | null>(null);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const search = useSearchParams();
  const errorParam = search?.get("error");

  useEffect(() => {
    (async () => {
      const { slug: s } = await params;
      setSlug(s);
      try {
        const res = await fetch(`/api/cabinets/${s}`, { cache: "no-store" });
        if (res.ok) setCabinet(await res.json());
      } catch {
        /* ignore */
      }
    })();
  }, [params]);

  const primary = cabinet?.primary_color ?? "#1f3a8a";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      await fetch(`/api/cabinets/${slug}/admin/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      // On affiche toujours "envoyé" même si email mismatch — anti-énumération.
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (!cabinet) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        Chargement…
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 480,
        margin: "60px auto",
        padding: "0 16px",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: 16,
          padding: 32,
          border: "1px solid #e2e8f0",
          boxShadow: "0 4px 24px rgba(0,0,0,0.04)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              color: primary,
              letterSpacing: "0.02em",
              marginBottom: 4,
            }}
          >
            {cabinet.cabinet_name.toUpperCase()}
          </div>
          <div style={{ fontSize: 12, color: "#64748b", letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Dashboard cabinet
          </div>
        </div>

        {sent ? (
          <div
            style={{
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              borderRadius: 10,
              padding: 16,
              color: "#065f46",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          >
            ✅ Si votre email correspond à celui du cabinet, vous recevez sous
            quelques secondes un lien sécurisé pour accéder au dashboard.
            <br />
            <span style={{ fontSize: 12, color: "#047857", marginTop: 8, display: "block" }}>
              Le lien est valable 7 jours et à usage unique. Vérifiez aussi votre dossier "promotions" ou "spam".
            </span>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ fontSize: 13, color: "#475569", margin: 0, marginBottom: 8 }}>
              Entrez l&apos;email du cabinet pour recevoir votre lien de connexion sécurisé.
            </p>

            <label style={{ display: "block" }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "#64748b",
                  marginBottom: 6,
                  display: "block",
                }}
              >
                Email
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="vous@cabinet.com"
                required
                autoComplete="email"
                autoFocus
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  border: "1.5px solid #cbd5e1",
                  borderRadius: 10,
                  fontSize: 14,
                  fontFamily: "inherit",
                  outline: "none",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => ((e.target as HTMLInputElement).style.borderColor = primary)}
                onBlur={(e) => ((e.target as HTMLInputElement).style.borderColor = "#cbd5e1")}
              />
            </label>

            {Boolean(errorParam) && (
              <div
                style={{
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  padding: 10,
                  color: "#991b1b",
                  fontSize: 12,
                }}
              >
                {errorParam === "invalid_or_expired"
                  ? "Votre lien a expiré ou a déjà été utilisé. Demandez-en un nouveau ci-dessous."
                  : errorParam === "missing_token"
                    ? "Lien invalide."
                    : "Erreur de connexion."}
              </div>
            )}

            <button
              type="submit"
              disabled={!email.trim() || submitting}
              style={{
                background: email.trim() && !submitting ? primary : "#cbd5e1",
                color: "white",
                border: "none",
                borderRadius: 10,
                padding: "12px 22px",
                fontSize: 14,
                fontWeight: 700,
                cursor: email.trim() && !submitting ? "pointer" : "not-allowed",
                fontFamily: "inherit",
                marginTop: 6,
              }}
            >
              {submitting ? "Envoi en cours…" : "Recevoir mon lien de connexion →"}
            </button>
          </form>
        )}

        <div
          style={{
            marginTop: 20,
            paddingTop: 16,
            borderTop: "1px solid #e2e8f0",
            fontSize: 11,
            color: "#94a3b8",
            textAlign: "center",
          }}
        >
          Propulsé par <strong>DATAMERRY®</strong> — connexion par lien magique, sans mot de passe.
        </div>
      </div>
    </div>
  );
}
