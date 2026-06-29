"use client";

/**
 * Formulaire candidature ULTRA-SIMPLIFIÉ pour Eurealimmo Réseau.
 *
 * Stratégie : zéro friction. 4 champs obligatoires (prénom/nom/email/phone).
 * Tout le reste = optionnel sous accordéon "Précisez si vous voulez".
 *
 * Si l'utilisateur arrive via un code referral (`?ref=DIARA`), le formulaire
 * affiche un banner d'accueil personnalisé et pré-applique l'offre Fondateur.
 *
 * Post-soumission : page de bienvenue claire avec next steps.
 */

import { useState } from "react";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

type ReferralContext = {
  code: string;
  referrer_name: string;
  display_name: string | null;
  message_public: string | null;
  tier: "founder" | "standard" | "partner";
  places_remaining: number;
} | null;

type FormState = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  // Optionnels
  current_network: string;
  motivation: string;
  preferred_contact: "call" | "email";
  consent: boolean;
};

const INITIAL: FormState = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  current_network: "",
  motivation: "",
  preferred_contact: "call",
  consent: true, // pré-coché — RGPD compliant car explicit text au-dessus
};

export function ApplicationForm({ referral }: { referral?: ReferralContext }) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [showOptional, setShowOptional] = useState(false);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    if (!form.consent) {
      setError("Merci d'accepter le traitement des données pour rejoindre.");
      return;
    }
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/eurealimmo-reseau/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          referral_code: referral?.code ?? null,
          tier_requested: referral?.tier ?? "standard",
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        detail?: string;
      };
      if (!res.ok || !j.ok) {
        // Mapping des codes d'erreur vers messages utilisateur clairs
        const errorMap: Record<string, string> = {
          db_error:
            "Notre base de données n'est pas encore opérationnelle pour l'enregistrement. Écrivez-nous directement à contact@eurealimmo.com — votre candidature sera traitée manuellement.",
          invalid_email: "L'adresse email saisie n'est pas valide.",
          invalid_phone: "Le numéro de téléphone est trop court.",
          name_required: "Merci de saisir votre prénom et votre nom.",
          consent_required: "Merci d'accepter le traitement de vos données.",
          rejected: "Votre message contient des mots-clés détectés comme spam.",
          invalid_json: "Erreur technique. Réessayez ou contactez-nous.",
        };
        const friendly = errorMap[j.error ?? ""] ?? null;
        const detailSuffix = j.detail ? ` (détail technique : ${j.detail})` : "";
        setError(
          friendly ?? `Erreur : ${j.error ?? "inconnue"}${detailSuffix}. Écrivez à contact@eurealimmo.com.`,
        );
        return;
      }
      setSubmitted(true);
    } catch (err) {
      setError("Erreur réseau : " + (err instanceof Error ? err.message : "inconnue"));
    } finally {
      setSending(false);
    }
  }

  if (submitted) {
    return <SuccessScreen firstName={form.first_name} referral={referral ?? null} preferred={form.preferred_contact} />;
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        background: "white",
        padding: 32,
        borderRadius: 8,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
      }}
    >
      {/* Banner referral (si applicable) */}
      {referral && referral.tier === "founder" && (
        <div
          style={{
            padding: "12px 16px",
            background: `${PRIMARY}15`,
            border: `1px solid ${PRIMARY}`,
            borderRadius: 4,
            fontSize: 13,
            color: DARK,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            ✨ Offre Fondateur — invité par {referral.display_name ?? referral.referrer_name}
          </div>
          <div style={{ color: "#475569" }}>
            6 mois gratuits · 5 % de commission · Programme exclusif · Plus que{" "}
            <strong style={{ color: PRIMARY }}>{referral.places_remaining} places</strong> disponibles.
          </div>
        </div>
      )}

      {/* 4 champs essentiels */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Field label="Prénom">
          <input
            required
            autoFocus
            value={form.first_name}
            onChange={(e) => set("first_name", e.target.value)}
            placeholder="Diara"
            style={inputStyle}
          />
        </Field>
        <Field label="Nom">
          <input
            required
            value={form.last_name}
            onChange={(e) => set("last_name", e.target.value)}
            placeholder="CAMARA"
            style={inputStyle}
          />
        </Field>
      </div>

      <Field label="Email">
        <input
          required
          type="email"
          value={form.email}
          onChange={(e) => set("email", e.target.value)}
          placeholder="diara@exemple.com"
          style={inputStyle}
        />
      </Field>

      <Field label="Téléphone">
        <input
          required
          type="tel"
          value={form.phone}
          onChange={(e) => set("phone", e.target.value)}
          placeholder="06 12 34 56 78"
          style={inputStyle}
        />
      </Field>

      <Field label="Préférence de contact">
        <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
          <ContactOption
            selected={form.preferred_contact === "call"}
            onClick={() => set("preferred_contact", "call")}
            label="📞 Appelez-moi cette semaine"
            sublabel="Réponse en 24-48 h"
          />
          <ContactOption
            selected={form.preferred_contact === "email"}
            onClick={() => set("preferred_contact", "email")}
            label="📧 Par email d'abord"
            sublabel="Documentation envoyée"
          />
        </div>
      </Field>

      {/* Bloc optionnel */}
      <button
        type="button"
        onClick={() => setShowOptional((v) => !v)}
        style={{
          background: "transparent",
          border: "none",
          color: PRIMARY,
          fontSize: 12,
          textDecoration: "underline",
          cursor: "pointer",
          padding: 0,
          textAlign: "left",
          marginTop: 4,
        }}
      >
        {showOptional ? "− Masquer les détails optionnels" : "+ Préciser votre profil (optionnel)"}
      </button>

      {showOptional && (
        <>
          <Field label="Réseau actuel (si applicable)" hint="Précisez le nom de votre réseau ou cabinet actuel">
            <input
              value={form.current_network}
              onChange={(e) => set("current_network", e.target.value)}
              placeholder="HSBC Banque Privée"
              style={inputStyle}
            />
          </Field>
          <Field label="Un mot sur votre projet" hint="Pas obligatoire, on en parlera au téléphone">
            <textarea
              rows={3}
              maxLength={500}
              value={form.motivation}
              onChange={(e) => set("motivation", e.target.value)}
              placeholder="Je cherche un cabinet qui couvre ma carte T et m'apporte de bons outils data…"
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </Field>
        </>
      )}

      {/* Consentement RGPD (pré-coché mais clair) */}
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 11, color: "#64748b", lineHeight: 1.5, marginTop: 4 }}>
        <input
          type="checkbox"
          checked={form.consent}
          onChange={(e) => set("consent", e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          J&apos;accepte que mes données soient traitées par EUREALIMMO (SARL, SIREN 984 449 470)
          pour le suivi de ma candidature. RGPD respecté · Suppression possible à tout moment ·
          Conservation 12 mois max.
        </span>
      </label>

      {error && (
        <div
          style={{
            padding: 12,
            background: "#fee2e2",
            color: "#991b1b",
            borderRadius: 4,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={sending}
        style={{
          background: PRIMARY,
          color: DARK,
          border: "none",
          padding: "18px 24px",
          borderRadius: 4,
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: "0.02em",
          cursor: sending ? "not-allowed" : "pointer",
          opacity: sending ? 0.6 : 1,
          marginTop: 8,
        }}
      >
        {sending
          ? "Envoi en cours…"
          : referral?.tier === "founder"
            ? "Rejoindre Eurealimmo (offre Fondateur) →"
            : "Rejoindre Eurealimmo Réseau →"}
      </button>

      <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center" }}>
        On vous recontacte sous 24-48 h ouvrées · Aucun spam, jamais
      </div>
    </form>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, color: "#0f172a", fontWeight: 700, letterSpacing: "0.02em" }}>
        {label}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>{hint}</span>}
    </label>
  );
}

function ContactOption({
  selected,
  onClick,
  label,
  sublabel,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  sublabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "12px 16px",
        background: selected ? `${PRIMARY}15` : "white",
        border: selected ? `2px solid ${PRIMARY}` : "1.5px solid #cbd5e1",
        borderRadius: 4,
        textAlign: "left",
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: DARK }}>{label}</div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{sublabel}</div>
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "14px 16px",
  border: "1.5px solid #cbd5e1",
  borderRadius: 4,
  fontSize: 15,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  background: "white",
};

// ══════════════════════════════════════════════════════════════════════════
// Success screen — post-soumission avec next steps clairs
// ══════════════════════════════════════════════════════════════════════════

function SuccessScreen({
  firstName,
  referral,
  preferred,
}: {
  firstName: string;
  referral: ReferralContext;
  preferred: "call" | "email";
}) {
  return (
    <div
      style={{
        background: "white",
        padding: 40,
        borderRadius: 8,
        textAlign: "center",
        boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          background: PRIMARY,
          color: DARK,
          fontSize: 32,
          fontWeight: 700,
          margin: "0 auto 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ✓
      </div>
      <h3 style={{ fontFamily: "Georgia, serif", fontSize: 28, color: DARK, margin: "0 0 16px" }}>
        Bienvenue {firstName}
      </h3>

      {referral && referral.tier === "founder" && (
        <div
          style={{
            display: "inline-block",
            padding: "6px 14px",
            background: `${PRIMARY}22`,
            color: DARK,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.1em",
            borderRadius: 999,
            marginBottom: 20,
          }}
        >
          OFFRE FONDATEUR · INVITÉ PAR {(referral.display_name ?? referral.referrer_name).toUpperCase()}
        </div>
      )}

      <p style={{ color: "#475569", lineHeight: 1.7, maxWidth: 480, margin: "0 auto 28px" }}>
        Votre candidature est reçue. Voici la suite — pas de papier, pas de perte de temps :
      </p>

      <div style={{ textAlign: "left", maxWidth: 460, margin: "0 auto 28px" }}>
        <NextStep
          num="1"
          title={preferred === "call" ? "Appel de bienvenue sous 24-48 h" : "Email avec dossier détaillé sous 24 h"}
          text="Un agent Eurealimmo vous contacte pour valider la cohérence et répondre à vos questions."
        />
        <NextStep
          num="2"
          title="Signature contrat sous 7 jours"
          text="Contrat de mandataire conforme loi Hoguet, signature électronique sécurisée. Pas de RDV physique nécessaire."
        />
        <NextStep
          num="3"
          title="Déclaration CCI Paris (50 € à votre charge)"
          text="Nous déposons votre RCO auprès de la CCI Paris (3-7 jours ouvrés). Vous réglez les 50 € directement à la CCI — frais réglementaire incompressible."
        />
        <NextStep
          num="4"
          title="Souscriptions à votre charge à finaliser en parallèle"
          text="RCP agent commercial (150-200 €/an, obligatoire) + formation Loi ALUR initiale (150-200 € one-shot) + création de votre structure si pas déjà fait (auto-entrepreneur : 0 € · SASU/EURL : 200-400 €). Nous vous orientons vers nos partenaires."
        />
        <NextStep
          num="5"
          title="Onboarding sous 48 h après validation RCO"
          text="Accès DATAMERRY®, carte T active, suivi ALUR planifié, premiers leads dans le CRM. Premier mandat possible sous 15-30 jours."
        />
      </div>

      <p style={{ fontSize: 13, color: "#64748b", lineHeight: 1.6 }}>
        Question urgente ?{" "}
        <a href="mailto:contact@eurealimmo.com" style={{ color: PRIMARY, fontWeight: 700 }}>
          contact@eurealimmo.com
        </a>
      </p>
    </div>
  );
}

function NextStep({ num, title, text }: { num: string; title: string; text: string }) {
  return (
    <div style={{ display: "flex", gap: 14, padding: "12px 0", borderBottom: "1px solid #f1f5f9" }}>
      <div
        style={{
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: 16,
          background: PRIMARY,
          color: DARK,
          fontWeight: 700,
          fontSize: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {num}
      </div>
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: DARK, marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>{text}</div>
      </div>
    </div>
  );
}
