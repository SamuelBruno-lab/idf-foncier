"use client";

/**
 * Formulaire candidature mandataire Eurealimmo Réseau.
 *
 * POST → /api/eurealimmo-reseau/apply
 *   - Insert dans table eurealimmo_applications (Supabase)
 *   - Email Resend vers contact@datamerry.com (avec récap)
 *   - Email auto-réponse au candidat (confirmation 48h)
 */

import { useState } from "react";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

type FormState = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  current_status: string;
  current_network: string;
  years_experience: string;
  has_carte_t: string;
  specialty: string;
  motivation: string;
  consent: boolean;
};

const INITIAL: FormState = {
  first_name: "",
  last_name: "",
  email: "",
  phone: "",
  current_status: "",
  current_network: "",
  years_experience: "",
  has_carte_t: "",
  specialty: "",
  motivation: "",
  consent: false,
};

export function ApplicationForm() {
  const [form, setForm] = useState<FormState>(INITIAL);
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
      setError("Vous devez accepter le traitement de vos données pour candidater.");
      return;
    }
    setError(null);
    setSending(true);
    try {
      const res = await fetch("/api/eurealimmo-reseau/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setError(j.error ?? "Erreur lors de l'envoi. Réessayez ou écrivez à contact@datamerry.com");
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
    return (
      <div
        style={{
          background: "white",
          padding: 40,
          borderRadius: 8,
          textAlign: "center",
          border: `2px solid ${PRIMARY}`,
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>✓</div>
        <h3 style={{ fontFamily: "Georgia, serif", fontSize: 24, color: DARK, marginBottom: 12 }}>
          Candidature reçue
        </h3>
        <p style={{ color: "#475569", lineHeight: 1.6, maxWidth: 460, margin: "0 auto" }}>
          Merci {form.first_name}. Vous recevrez une réponse personnalisée sous{" "}
          <strong>48 heures ouvrées</strong> à l&apos;adresse <strong>{form.email}</strong>.
          <br />
          <br />
          Pour toute question urgente :{" "}
          <a href="mailto:contact@datamerry.com" style={{ color: PRIMARY }}>
            contact@datamerry.com
          </a>
        </p>
      </div>
    );
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
        gap: 16,
      }}
    >
      <Row>
        <Field label="Prénom *">
          <input
            required
            value={form.first_name}
            onChange={(e) => set("first_name", e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Nom *">
          <input
            required
            value={form.last_name}
            onChange={(e) => set("last_name", e.target.value)}
            style={inputStyle}
          />
        </Field>
      </Row>

      <Row>
        <Field label="Email professionnel *">
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => set("email", e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Téléphone *">
          <input
            required
            type="tel"
            value={form.phone}
            onChange={(e) => set("phone", e.target.value)}
            style={inputStyle}
          />
        </Field>
      </Row>

      <Row>
        <Field label="Statut actuel *">
          <select
            required
            value={form.current_status}
            onChange={(e) => set("current_status", e.target.value)}
            style={inputStyle}
          >
            <option value="">— Choisir —</option>
            <option value="mandataire_actif">Mandataire actif (autre réseau)</option>
            <option value="agent_commercial">Agent commercial salarié</option>
            <option value="ex_banque_privee">Ex-banque privée (HSBC, BNP, SG, etc.)</option>
            <option value="reconversion">Reconversion (formation immo récente)</option>
            <option value="independant_carte_t">Indépendant avec carte T propre</option>
            <option value="autre">Autre</option>
          </select>
        </Field>
        <Field label="Années d'expérience immo *">
          <select
            required
            value={form.years_experience}
            onChange={(e) => set("years_experience", e.target.value)}
            style={inputStyle}
          >
            <option value="">— Choisir —</option>
            <option value="0-1">Moins d&apos;1 an</option>
            <option value="1-3">1 à 3 ans</option>
            <option value="3-7">3 à 7 ans</option>
            <option value="7-15">7 à 15 ans</option>
            <option value="15+">Plus de 15 ans</option>
          </select>
        </Field>
      </Row>

      <Row>
        <Field
          label="Réseau actuel (si applicable)"
          hint="SAFTI, IAD, Capifrance, Olean, HSBC Privée, etc."
        >
          <input
            value={form.current_network}
            onChange={(e) => set("current_network", e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Spécialité *">
          <select
            required
            value={form.specialty}
            onChange={(e) => set("specialty", e.target.value)}
            style={inputStyle}
          >
            <option value="">— Choisir —</option>
            <option value="hnwi">HNWI / Premium (≥ 1 M€)</option>
            <option value="ancien_standing">Ancien standing (300 k€ - 1 M€)</option>
            <option value="standard">Marché standard</option>
            <option value="commercial">Commercial / Bureaux</option>
            <option value="location">Location</option>
            <option value="mixte">Mixte / Polyvalent</option>
          </select>
        </Field>
      </Row>

      <Field label="Avez-vous votre propre carte T ? *">
        <div style={{ display: "flex", gap: 16, marginTop: 6 }}>
          {[
            { v: "non", l: "Non, je cherche un cabinet qui couvre" },
            { v: "oui", l: "Oui, carte T personnelle" },
            { v: "transition", l: "Carte T en cours de renouvellement / transition" },
          ].map((opt) => (
            <label key={opt.v} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 13 }}>
              <input
                type="radio"
                name="has_carte_t"
                required
                value={opt.v}
                checked={form.has_carte_t === opt.v}
                onChange={(e) => set("has_carte_t", e.target.value)}
              />
              {opt.l}
            </label>
          ))}
        </div>
      </Field>

      <Field
        label="Motivations & projet *"
        hint="Pourquoi Eurealimmo ? Quels sont vos objectifs sur les 12 prochains mois ? (500 caractères max)"
      >
        <textarea
          required
          rows={4}
          maxLength={500}
          value={form.motivation}
          onChange={(e) => set("motivation", e.target.value)}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Field>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
        <input
          type="checkbox"
          checked={form.consent}
          onChange={(e) => set("consent", e.target.checked)}
          style={{ marginTop: 4 }}
        />
        <span>
          J&apos;accepte que mes données soient traitées par <strong>EUREALIMMO</strong> (SARL, SIREN
          984 449 470) dans le cadre du recrutement, conformément au RGPD. Aucune communication
          commerciale tierce. Conservation : 12 mois maximum si candidature non retenue.
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
          padding: "16px 24px",
          borderRadius: 4,
          fontSize: 15,
          fontWeight: 700,
          letterSpacing: "0.02em",
          cursor: sending ? "not-allowed" : "pointer",
          opacity: sending ? 0.6 : 1,
        }}
      >
        {sending ? "Envoi en cours…" : "Envoyer ma candidature"}
      </button>

      <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 4 }}>
        Réponse sous 48 h ouvrées · Strictement confidentiel
      </div>
    </form>
  );
}

// ─── UI primitives ─────────────────────────────────────────────────────

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>{children}</div>
  );
}

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
      <span style={{ fontSize: 12, color: "#475569", fontWeight: 600, letterSpacing: "0.02em" }}>
        {label}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>{hint}</span>}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "12px 14px",
  border: "1.5px solid #cbd5e1",
  borderRadius: 4,
  fontSize: 14,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  background: "white",
};
