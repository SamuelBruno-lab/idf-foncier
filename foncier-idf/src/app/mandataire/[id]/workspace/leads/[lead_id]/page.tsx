/**
 * Page détail lead — côté mandataire.
 *
 * URL : /mandataire/[id]/workspace/leads/[lead_id]
 *
 * Affiche les infos du lead (client vendeur + bien + prix) et permet
 * de générer un mandat Hoguet conforme via le composant
 * GenerateMandatHoguetCardMandataire.
 *
 * Gate : le mandataire doit être attribué à ce lead (mandataire_id ===
 * id de l'URL). Sinon notFound().
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";

import { GenerateMandatHoguetCardMandataire } from "./GenerateMandatHoguetCardMandataire";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fmtEUR = (n: number | null | undefined) =>
  n
    ? new Intl.NumberFormat("fr-FR", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(n)
    : "—";

const fmtDate = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      })
    : "—";

type Lead = {
  id: string;
  cabinet_slug: string;
  mandataire_id: string | null;
  visitor_name: string | null;
  visitor_email: string | null;
  visitor_phone: string | null;
  address: string | null;
  status: string;
  created_at: string;
  surface_m2: number | null;
  type_bien: string | null;
  prix_estime: number | null;
  wizard_answers: Record<string, unknown> | null;
  mandat_type: string | null;
  mandat_modalite: string | null;
  mandat_duree_mois: number | null;
  mandat_commission_pct: number | null;
  mandat_commission_charge: string | null;
  mandat_prix_net_vendeur: number | null;
  mandat_prix_max: number | null;
  mandat_numero_registre: string | null;
  mandat_signe_at: string | null;
  signature_pdf_url: string | null;
  signature_status: string | null;
};

async function fetchData(mandataireId: string, leadId: string): Promise<{
  lead: Lead | null;
  contractSigned: boolean;
} | null> {
  if (!UUID_RE.test(mandataireId) || !UUID_RE.test(leadId)) return null;

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const [{ data: lead }, { data: mandataire }] = await Promise.all([
    sb
      .from("dim_cabinet_leads")
      .select(
        "id, cabinet_slug, mandataire_id, visitor_name, visitor_email, visitor_phone, address, status, created_at, surface_m2, type_bien, prix_estime, wizard_answers, mandat_type, mandat_modalite, mandat_duree_mois, mandat_commission_pct, mandat_commission_charge, mandat_prix_net_vendeur, mandat_prix_max, mandat_numero_registre, mandat_signe_at, signature_pdf_url, signature_status",
      )
      .eq("id", leadId)
      .maybeSingle(),
    sb
      .from("eurealimmo_mandataires")
      .select("contract_signed_at")
      .eq("id", mandataireId)
      .maybeSingle(),
  ]);

  return {
    lead: lead as Lead | null,
    contractSigned: !!mandataire?.contract_signed_at,
  };
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  new: { label: "Nouveau", color: "#3b82f6" },
  contacted: { label: "Contacté", color: "#8b5cf6" },
  rdv_planifie: { label: "RDV planifié", color: "#f59e0b" },
  visite_planifiee: { label: "Visite planifiée", color: "#f59e0b" },
  mandat_signe: { label: "Mandat signé", color: "#10b981" },
  vendu: { label: "Vendu", color: "#059669" },
  perdu: { label: "Perdu", color: "#6b7280" },
};

export default async function MandataireLeadDetailPage({
  params,
}: {
  params: Promise<{ id: string; lead_id: string }>;
}) {
  const { id, lead_id } = await params;
  const data = await fetchData(id, lead_id);

  if (!data || !data.lead) notFound();

  const { lead, contractSigned } = data;

  // Lead doit être attribué à ce mandataire — sinon notFound (pas leak d'info)
  if (lead.mandataire_id !== id) notFound();

  const status = STATUS_LABELS[lead.status] ?? { label: lead.status, color: "#6b7280" };

  return (
    <div>
      {/* ─── Breadcrumb ────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/mandataire/${id}/workspace/leads`}
          style={{
            fontSize: 12,
            color: MUTED,
            textDecoration: "none",
            fontWeight: 500,
          }}
        >
          ← Retour à mes leads
        </Link>
      </div>

      {/* ─── Titre + statut ────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1
            style={{
              fontFamily: "Georgia, serif",
              fontSize: 26,
              fontWeight: 700,
              margin: "0 0 4px",
            }}
          >
            {lead.visitor_name ?? "Client anonyme"}
          </h1>
          <p style={{ color: MUTED, fontSize: 13, margin: 0 }}>
            Lead créé le {fmtDate(lead.created_at)}
          </p>
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 700,
            padding: "4px 12px",
            borderRadius: 4,
            background: status.color + "20",
            color: status.color,
            border: `1px solid ${status.color}`,
          }}
        >
          {status.label}
        </span>
      </div>

      {/* ─── 2 colonnes : infos client + infos bien ────────────────────── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 20,
        }}
      >
        {/* Client */}
        <section
          style={{
            background: "white",
            borderRadius: 6,
            padding: 18,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px", color: PRIMARY, letterSpacing: "0.05em" }}>
            CLIENT VENDEUR
          </h2>
          <Row label="Nom" value={lead.visitor_name ?? "—"} />
          <Row label="Email" value={lead.visitor_email ?? "—"} />
          <Row label="Téléphone" value={lead.visitor_phone ?? "—"} />
        </section>

        {/* Bien */}
        <section
          style={{
            background: "white",
            borderRadius: 6,
            padding: 18,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <h2 style={{ fontSize: 14, fontWeight: 700, margin: "0 0 12px", color: PRIMARY, letterSpacing: "0.05em" }}>
            BIEN À VENDRE
          </h2>
          <Row label="Adresse" value={lead.address ?? "—"} />
          <Row
            label="Type"
            value={
              [lead.type_bien, lead.surface_m2 ? `${lead.surface_m2} m²` : null]
                .filter(Boolean)
                .join(" · ") || "—"
            }
          />
          {lead.wizard_answers && (
            <WizardExtras answers={lead.wizard_answers} />
          )}
          <Row label="Estimation DATAMERRY" value={fmtEUR(lead.prix_estime)} highlight />
        </section>
      </div>

      {/* ─── Mandat existant (si déjà signé) ───────────────────────────── */}
      {lead.mandat_signe_at && (
        <section
          style={{
            background: "#ecfdf5",
            border: "1px solid #10b981",
            borderRadius: 6,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: "#064e3b", marginBottom: 6 }}>
            ✅ Mandat déjà signé
          </div>
          <div style={{ fontSize: 12, color: MUTED }}>
            N° {lead.mandat_numero_registre ?? "—"} ·{" "}
            {lead.mandat_type ?? "—"} · {lead.mandat_modalite ?? "—"} ·
            Signé le {fmtDate(lead.mandat_signe_at)}
          </div>
          {lead.signature_pdf_url && (
            <a
              href={lead.signature_pdf_url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-block",
                marginTop: 8,
                fontSize: 12,
                color: "#064e3b",
                fontWeight: 600,
              }}
            >
              ⬇️ Télécharger le mandat
            </a>
          )}
        </section>
      )}

      {/* ─── Carte génération mandat Hoguet ────────────────────────────── */}
      <GenerateMandatHoguetCardMandataire
        lead={{
          id: lead.id,
          mandat_type: lead.mandat_type,
          mandat_modalite: lead.mandat_modalite,
          mandat_duree_mois: lead.mandat_duree_mois,
          mandat_commission_pct: lead.mandat_commission_pct,
          mandat_commission_charge: lead.mandat_commission_charge,
          mandat_prix_net_vendeur: lead.mandat_prix_net_vendeur,
          mandat_prix_max: lead.mandat_prix_max,
          mandat_numero_registre: lead.mandat_numero_registre,
        }}
        mandataireId={id}
        leadId={lead.id}
        primary={PRIMARY}
        contractSigned={contractSigned}
      />

      {/* ─── Note légale ───────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 24,
          padding: 14,
          background: "#fafafa",
          border: `1px solid ${BORDER}`,
          borderRadius: 6,
          fontSize: 11,
          color: MUTED,
          lineHeight: 1.6,
        }}
      >
        Mandat signé entre <strong>Eurealimmo SARL</strong> (titulaire Carte T
        CPI 7501 2024 000 000 219 — préfecture de Police de Paris) et le client
        vendeur ci-dessus. Vous intervenez en tant que mandataire commercial
        Eurealimmo (loi Hoguet n°70-9, décret 72-678 art. 4). Le mandat est
        ajouté automatiquement à votre registre des mandats (art. 65 décret
        72-678) avec un numéro chronologique unique.
      </div>
    </div>
  );
}

function WizardExtras({ answers }: { answers: Record<string, unknown> }) {
  const KEYS_LABELS: Array<[string, string]> = [
    ["nb_pieces", "Pièces"],
    ["etage", "Étage"],
    ["etat", "État"],
    ["dpe", "DPE"],
    ["exposition", "Exposition"],
    ["balcon", "Balcon/Terrasse"],
    ["cave", "Cave"],
    ["parking", "Parking"],
  ];
  const rows = KEYS_LABELS.flatMap(([k, label]) => {
    const v = answers[k];
    if (v === null || v === undefined || v === "" || v === false) return [];
    const display = typeof v === "boolean" ? "Oui" : String(v);
    return [<Row key={k} label={label} value={display} />];
  });
  return <>{rows}</>;
}

function Row({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "8px 0",
        borderBottom: `1px solid ${BORDER}`,
        fontSize: 13,
      }}
    >
      <span style={{ color: MUTED, fontWeight: 500 }}>{label}</span>
      <span
        style={{
          color: highlight ? PRIMARY : DARK,
          fontWeight: highlight ? 700 : 500,
          textAlign: "right",
        }}
      >
        {value}
      </span>
    </div>
  );
}
