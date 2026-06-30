"use client";

/**
 * Formulaire de création manuelle d'un mandat depuis le workspace mandataire.
 * Crée le lead + génère le mandat Hoguet en une seule action.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AddressAutocomplete } from "./AddressAutocomplete";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const BG = "#f8fafc";
const GREEN = "#10b981";
const RED = "#dc2626";

interface Props {
  mandataireId: string;
  cabinetSlug: string;
}

const MANDAT_TYPES = [
  { value: "vente", label: "Mandat de vente" },
  { value: "recherche_acquereur", label: "Mandat de recherche acquéreur" },
  { value: "mise_en_location", label: "Mandat de mise en location" },
  { value: "recherche_bien_locatif", label: "Mandat de recherche bien locatif" },
];

const MODALITES = [
  { value: "simple", label: "Simple" },
  { value: "exclusif", label: "Exclusif" },
  { value: "semi_exclusif", label: "Semi-exclusif" },
];

const CHARGE_OPTIONS = [
  { value: "acquereur", label: "Charge Acquéreur (FAI)" },
  { value: "vendeur", label: "Charge Vendeur (style OLEAN)" },
];

const TYPES_BIEN = [
  "Appartement",
  "Maison",
  "Studio",
  "Loft",
  "Duplex",
  "Local commercial",
  "Bureau",
  "Terrain",
  "Autre",
];

function fmtEUR(n: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

export function ManualMandatForm({ mandataireId, cabinetSlug }: Props) {
  const router = useRouter();

  // Client
  const [visitorName, setVisitorName] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const [visitorPhone, setVisitorPhone] = useState("");

  // Bien
  const [address, setAddress] = useState("");
  const [typeBien, setTypeBien] = useState("Appartement");
  const [surface, setSurface] = useState("");
  const [description, setDescription] = useState("");

  // Mandat
  const [mandatType, setMandatType] = useState("vente");
  const [modalite, setModalite] = useState("simple");
  const [dureeMois, setDureeMois] = useState(3);
  const [commissionPct, setCommissionPct] = useState(5);
  const [commissionCharge, setCommissionCharge] = useState<"vendeur" | "acquereur">("acquereur");
  const [prix, setPrix] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isVente = mandatType === "vente";
  const isRecherche =
    mandatType === "recherche_acquereur" || mandatType === "recherche_bien_locatif";

  const prixNumber = Number(prix.replace(/\s/g, "")) || 0;
  const commissionEur = Math.round(prixNumber * (commissionPct / 100));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (!visitorName.trim() || !address.trim()) {
      setError("Nom du client et adresse du bien sont requis.");
      setLoading(false);
      return;
    }

    const body = {
      cabinet_slug: cabinetSlug,
      visitor_name: visitorName.trim(),
      visitor_email: visitorEmail.trim(),
      visitor_phone: visitorPhone.trim(),
      address: address.trim(),
      type_bien: typeBien,
      surface: surface ? Number(surface) : null,
      description: description.trim() || null,
      mandat_type: mandatType,
      mandat_modalite: modalite,
      duree_mois: dureeMois,
      commission_pct: commissionPct,
      commission_charge: isVente ? commissionCharge : undefined,
      prix_net_vendeur: isVente ? prixNumber : undefined,
      prix_max: isRecherche ? prixNumber : undefined,
    };

    try {
      const res = await fetch(`/api/mandataire/${mandataireId}/mandats/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? "Erreur création");
      }
      // Redirige vers la page détail du lead créé
      router.push(`/mandataire/${mandataireId}/workspace/leads/${data.lead_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ─── Client ──────────────────────────────────────────────────── */}
      <Section title="1. Client vendeur / acquéreur">
        <Row>
          <Field label="Nom complet *">
            <input
              type="text"
              required
              value={visitorName}
              onChange={(e) => setVisitorName(e.target.value)}
              placeholder="Ex. Nathalie BERNARD"
              style={inputStyle()}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Email">
            <input
              type="email"
              value={visitorEmail}
              onChange={(e) => setVisitorEmail(e.target.value)}
              placeholder="nathalie.bernard@example.com"
              style={inputStyle()}
            />
          </Field>
          <Field label="Téléphone">
            <input
              type="tel"
              value={visitorPhone}
              onChange={(e) => setVisitorPhone(e.target.value)}
              placeholder="+33 6 12 34 56 78"
              style={inputStyle()}
            />
          </Field>
        </Row>
      </Section>

      {/* ─── Bien ────────────────────────────────────────────────────── */}
      <Section title="2. Bien">
        <div>
          <span
            style={{
              display: "block",
              fontSize: 12,
              fontWeight: 600,
              color: DARK,
              marginBottom: 4,
            }}
          >
            Adresse du bien *
          </span>
          <AddressAutocomplete
            value={address}
            onChange={setAddress}
            onSelect={(d) => {
              // Auto-remplit l'adresse à partir de la suggestion
              setAddress(d.label);
            }}
            placeholder="Tape l'adresse — ex. 109 rue Constant Coquelin Vitry"
            required
          />
          <span
            style={{
              display: "block",
              fontSize: 10,
              color: MUTED,
              marginTop: 4,
            }}
          >
            💡 Suggestions BAN (Base Adresse Nationale) — tape au moins 3 caractères. Flèches ↑↓ + Entrée pour valider.
          </span>
        </div>
        <Row>
          <Field label="Type">
            <select
              value={typeBien}
              onChange={(e) => setTypeBien(e.target.value)}
              style={inputStyle()}
            >
              {TYPES_BIEN.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Surface (m²)">
            <input
              type="number"
              value={surface}
              onChange={(e) => setSurface(e.target.value)}
              placeholder="68"
              min={0}
              style={inputStyle()}
            />
          </Field>
        </Row>
        <Row>
          <Field label="Description courte (optionnel)">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Local d'activité avec grande surface, studio attenant et bureau..."
              style={{ ...inputStyle(), resize: "vertical" }}
            />
          </Field>
        </Row>
      </Section>

      {/* ─── Mandat ──────────────────────────────────────────────────── */}
      <Section title="3. Paramètres du mandat">
        <Row>
          <Field label="Type de mandat">
            <select
              value={mandatType}
              onChange={(e) => setMandatType(e.target.value)}
              style={inputStyle()}
            >
              {MANDAT_TYPES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Modalité">
            <select
              value={modalite}
              onChange={(e) => setModalite(e.target.value)}
              style={inputStyle()}
            >
              {MODALITES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Field>
        </Row>
        <Row>
          <Field label={`Durée : ${dureeMois} mois`}>
            <input
              type="range"
              min={1}
              max={30}
              value={dureeMois}
              onChange={(e) => setDureeMois(Number(e.target.value))}
              style={{ width: "100%", accentColor: PRIMARY }}
            />
          </Field>
          <Field label={`Commission : ${commissionPct} %`}>
            <input
              type="range"
              min={0}
              max={10}
              step={0.1}
              value={commissionPct}
              onChange={(e) => setCommissionPct(Number(e.target.value))}
              style={{ width: "100%", accentColor: PRIMARY }}
            />
          </Field>
        </Row>
        {isVente && (
          <Row>
            <Field label="Charge des honoraires">
              <select
                value={commissionCharge}
                onChange={(e) => setCommissionCharge(e.target.value as "vendeur" | "acquereur")}
                style={inputStyle()}
              >
                {CHARGE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <span style={hintStyle()}>
                {commissionCharge === "vendeur"
                  ? "Prix saisi = prix de vente TTC. Vendeur reçoit prix - honos."
                  : "Prix saisi = prix net vendeur. Acquéreur paie net + honos."}
              </span>
            </Field>
          </Row>
        )}
        <Row>
          <Field
            label={
              isVente
                ? "Prix NET vendeur (€)"
                : isRecherche
                  ? "Budget max (€)"
                  : "Loyer mensuel HC (€)"
            }
          >
            <input
              type="number"
              value={prix}
              onChange={(e) => setPrix(e.target.value)}
              placeholder="560000"
              min={0}
              step={1000}
              style={inputStyle()}
            />
          </Field>
        </Row>
        {prixNumber > 0 && commissionPct > 0 && (
          <div
            style={{
              background: "#fef3c7",
              padding: "10px 12px",
              borderRadius: 6,
              fontSize: 13,
              color: "#78350f",
            }}
          >
            💰 Honoraires estimés : <strong>{fmtEUR(commissionEur)}</strong> ({commissionPct}% de {fmtEUR(prixNumber)})
          </div>
        )}
      </Section>

      {error && (
        <div
          style={{
            padding: 12,
            background: "#fee2e2",
            border: `1px solid ${RED}`,
            borderRadius: 6,
            color: RED,
            fontSize: 13,
          }}
        >
          ⚠️ {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={() => router.back()}
          disabled={loading}
          style={{
            padding: "10px 18px",
            background: "transparent",
            color: MUTED,
            border: `1px solid ${BORDER}`,
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={loading || !visitorName.trim() || !address.trim()}
          style={{
            padding: "10px 22px",
            background: loading ? MUTED : GREEN,
            color: "white",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "⏳ Création + génération…" : "📄 Créer & générer le mandat"}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "white",
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: 18,
      }}
    >
      <h2
        style={{
          fontFamily: "Georgia, serif",
          fontSize: 16,
          fontWeight: 700,
          margin: "0 0 14px",
          color: DARK,
        }}
      >
        {title}
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>{children}</div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", gridColumn: "auto" }}>
      <span
        style={{
          display: "block",
          fontSize: 12,
          fontWeight: 600,
          color: DARK,
          marginBottom: 4,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "8px 10px",
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    fontSize: 13,
    color: DARK,
    background: "white",
    fontFamily: "inherit",
  };
}

function hintStyle(): React.CSSProperties {
  return {
    display: "block",
    fontSize: 10,
    color: MUTED,
    marginTop: 4,
  };
}
