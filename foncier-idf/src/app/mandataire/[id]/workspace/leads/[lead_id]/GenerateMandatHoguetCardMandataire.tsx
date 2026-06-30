"use client";

/**
 * Variante de GenerateMandatHoguetCard pour le workspace mandataire.
 * Appelle /api/mandataire/[id]/leads/[lead_id]/generate-mandat-hoguet
 * au lieu de l'endpoint admin.
 */

import { useState } from "react";

interface Lead {
  id: string;
  mandat_type: string | null;
  mandat_modalite: string | null;
  mandat_duree_mois: number | null;
  mandat_commission_pct: number | null;
  mandat_commission_charge: string | null;
  mandat_prix_net_vendeur: number | null;
  mandat_prix_max: number | null;
  mandat_numero_registre: string | null;
}

interface Props {
  lead: Lead;
  mandataireId: string;
  leadId: string;
  primary: string;
  contractSigned: boolean;
}

interface GenResult {
  docx_url: string;
  filename: string;
  hash_sha256: string;
  numero_registre: string;
  template_used: string;
}

const DM_DARK = "#064e3b";
const DM_GREEN = "#10b981";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const BG = "#f8fafc";
const HIGHLIGHT = "#fef3c7";
const RED = "#dc2626";

const MANDAT_TYPE_OPTIONS = [
  { value: "vente", label: "Mandat de vente" },
  { value: "recherche_acquereur", label: "Mandat de recherche acquéreur" },
  { value: "mise_en_location", label: "Mandat de mise en location (bailleur)" },
  { value: "recherche_bien_locatif", label: "Mandat de recherche bien locatif" },
];

const MODALITE_OPTIONS = [
  { value: "simple", label: "Simple" },
  { value: "exclusif", label: "Exclusif" },
  { value: "semi_exclusif", label: "Semi-exclusif" },
];

const COMMISSION_CHARGE_OPTIONS = [
  {
    value: "acquereur",
    label: "Charge Acquéreur (FAI)",
    hint: "Prix saisi = prix net vendeur. Acquéreur paie net + honos.",
  },
  {
    value: "vendeur",
    label: "Charge Vendeur",
    hint: "Prix saisi = prix de vente TTC. Vendeur reçoit prix - honos.",
  },
];

function normalizeMandatType(t: string | null): string {
  if (!t) return "vente";
  if (t === "recherche") return "recherche_acquereur";
  if (t === "location") return "mise_en_location";
  return t;
}

function eur(n: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
}

export function GenerateMandatHoguetCardMandataire({
  lead,
  mandataireId,
  leadId,
  primary,
  contractSigned,
}: Props) {
  const initialType = normalizeMandatType(lead.mandat_type);
  const [mandatType, setMandatType] = useState(initialType);
  const [modalite, setModalite] = useState(lead.mandat_modalite ?? "simple");
  const [dureeMois, setDureeMois] = useState(
    lead.mandat_duree_mois ?? (initialType === "vente" ? 3 : 6),
  );
  const [commissionPct, setCommissionPct] = useState(
    lead.mandat_commission_pct ?? (initialType === "vente" ? 5 : 3),
  );
  const [commissionCharge, setCommissionCharge] = useState<"vendeur" | "acquereur">(
    (lead.mandat_commission_charge as "vendeur" | "acquereur" | null) ?? "acquereur",
  );
  const [prix, setPrix] = useState(
    lead.mandat_prix_net_vendeur ?? lead.mandat_prix_max ?? 0,
  );

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isVente = mandatType === "vente";
  const isRecherche =
    mandatType === "recherche_acquereur" || mandatType === "recherche_bien_locatif";
  const isLocation =
    mandatType === "mise_en_location" || mandatType === "recherche_bien_locatif";

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const body = {
        mandat_type: mandatType,
        mandat_modalite: modalite,
        duree_mois: dureeMois,
        commission_pct: commissionPct,
        commission_charge: isVente ? commissionCharge : undefined,
        prix_net_vendeur: isVente ? prix : undefined,
        prix_max: isRecherche ? prix : undefined,
      };

      const res = await fetch(
        `/api/mandataire/${mandataireId}/leads/${leadId}/generate-mandat-hoguet`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      const data = await res.json();
      if (!res.ok) {
        const msg = (data as { message?: string; error?: string }).message ??
          (data as { error?: string }).error ?? "Erreur génération";
        throw new Error(msg);
      }

      setResult(data as GenResult);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const commissionEur = Math.round(prix * (commissionPct / 100));

  if (!contractSigned) {
    return (
      <div
        style={{
          background: "#fef3c7",
          border: `1px solid #f59e0b`,
          borderRadius: 8,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#78350f" }}>
          🔒 Génération de mandat verrouillée
        </h3>
        <p
          style={{
            fontSize: 13,
            color: "#78350f",
            margin: "8px 0 0 0",
            lineHeight: 1.6,
          }}
        >
          La signature de mandats Hoguet sera activée dès que votre contrat de
          mandataire commercial Eurealimmo aura été signé et que votre inscription
          au RSAC sera effective. Cet espace reste consultable en prévisualisation.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderLeft: `4px solid ${primary}`,
        borderRadius: 8,
        padding: 18,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: DM_DARK }}>
          📄 Générer le mandat Hoguet (.docx)
        </h3>
        {lead.mandat_numero_registre && (
          <span
            style={{
              fontSize: 11,
              color: MUTED,
              background: BG,
              padding: "2px 8px",
              borderRadius: 4,
            }}
          >
            Reg. n° {lead.mandat_numero_registre}
          </span>
        )}
      </div>

      <p style={{ fontSize: 12, color: MUTED, margin: "0 0 14px 0", lineHeight: 1.5 }}>
        Mandat entre <strong>Eurealimmo SARL</strong> (titulaire Carte T CPI 7501 2024 000 000 219,
        représentée par vous en tant que mandataire commercial) et le client vendeur.
        Conforme décret 72-678 art. 73 (9 mentions obligatoires + droit de rétractation +
        RGPD). DOCX stocké privé + hash SHA-256 ancré <code>dim_mandate_anchor</code>.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <label style={{ display: "block" }}>
          <span style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Type de mandat
          </span>
          <select
            value={mandatType}
            onChange={(e) => setMandatType(e.target.value)}
            disabled={loading}
            style={{
              width: "100%",
              padding: 8,
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            {MANDAT_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label style={{ display: "block" }}>
          <span style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Modalité
          </span>
          <select
            value={modalite}
            onChange={(e) => setModalite(e.target.value)}
            disabled={loading}
            style={{
              width: "100%",
              padding: 8,
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              fontSize: 13,
            }}
          >
            {MODALITE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        {isVente && (
          <label style={{ display: "block", gridColumn: "span 2" }}>
            <span style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
              Charge des honoraires
            </span>
            <select
              value={commissionCharge}
              onChange={(e) => setCommissionCharge(e.target.value as "vendeur" | "acquereur")}
              disabled={loading}
              style={{
                width: "100%",
                padding: 8,
                border: `1px solid ${BORDER}`,
                borderRadius: 6,
                fontSize: 13,
              }}
            >
              {COMMISSION_CHARGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span style={{ fontSize: 10, color: MUTED, marginTop: 4, display: "block" }}>
              {COMMISSION_CHARGE_OPTIONS.find((o) => o.value === commissionCharge)?.hint}
            </span>
          </label>
        )}

        <label style={{ display: "block" }}>
          <span style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Durée : <strong>{dureeMois} mois</strong>
          </span>
          <input
            type="range"
            min={1}
            max={30}
            value={dureeMois}
            onChange={(e) => setDureeMois(Number(e.target.value))}
            disabled={loading}
            style={{ width: "100%", accentColor: primary }}
          />
        </label>

        <label style={{ display: "block" }}>
          <span style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
            Commission : <strong>{commissionPct} %</strong>
          </span>
          <input
            type="range"
            min={0}
            max={10}
            step={0.1}
            value={commissionPct}
            onChange={(e) => setCommissionPct(Number(e.target.value))}
            disabled={loading}
            style={{ width: "100%", accentColor: primary }}
          />
        </label>

        <label style={{ display: "block", gridColumn: "span 2" }}>
          <span style={{ fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4 }}>
            {isVente
              ? "Prix NET vendeur (€)"
              : isLocation && !isRecherche
                ? "Loyer mensuel hors charges (€)"
                : "Budget max (€)"}
          </span>
          <input
            type="number"
            value={prix || ""}
            onChange={(e) => setPrix(Number(e.target.value) || 0)}
            disabled={loading}
            min={0}
            step={1000}
            placeholder={isLocation && !isRecherche ? "1500" : "1500000"}
            style={{
              width: "100%",
              padding: 8,
              border: `1px solid ${BORDER}`,
              borderRadius: 6,
              fontSize: 13,
              fontVariantNumeric: "tabular-nums",
            }}
          />
        </label>
      </div>

      {prix > 0 && commissionPct > 0 && (
        <div
          style={{
            background: HIGHLIGHT,
            padding: "8px 12px",
            borderRadius: 6,
            fontSize: 12,
            color: DM_DARK,
            marginBottom: 14,
          }}
        >
          💰 Honoraires estimés : <strong>{eur(commissionEur)} TTC</strong>{" "}
          ({commissionPct} % de {eur(prix)})
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={loading || !prix || !mandatType}
        style={{
          padding: "10px 20px",
          background: loading ? MUTED : DM_GREEN,
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 700,
          cursor: loading ? "wait" : "pointer",
          opacity: loading || !prix ? 0.6 : 1,
        }}
      >
        {loading ? "⏳ Génération en cours..." : "📄 Générer le mandat (.docx)"}
      </button>

      {result && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            background: "#ecfdf5",
            border: `1px solid ${DM_GREEN}`,
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: DM_DARK, marginBottom: 8 }}>
            ✅ Mandat n° {result.numero_registre} généré
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginBottom: 8, fontFamily: "monospace" }}>
            Fichier : {result.filename}<br/>
            Template : {result.template_used}<br/>
            Hash SHA-256 : {result.hash_sha256.slice(0, 24)}...
          </div>
          <a
            href={result.docx_url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-block",
              padding: "6px 14px",
              background: DM_DARK,
              color: "#fff",
              textDecoration: "none",
              borderRadius: 4,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            ⬇️ Télécharger le DOCX
          </a>
          <div style={{ fontSize: 10, color: MUTED, marginTop: 6 }}>
            URL signée valable 1 heure. Régénère si expirée.
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            background: "#fee2e2",
            border: `1px solid ${RED}`,
            borderRadius: 6,
            color: RED,
            fontSize: 12,
          }}
        >
          ❌ {error}
        </div>
      )}
    </div>
  );
}
