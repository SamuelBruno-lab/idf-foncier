"use client";

/**
 * Détail d'un lead — pipeline CRM/ERP complet :
 *   - Infos visiteur + bien + estimation DATAMERRY
 *   - Workflow visite : planifier / marquer réalisée
 *   - Workflow mandat : type (vente/recherche/location), modalité, durée,
 *     commission, prix net vendeur ou budget max, numéro registre auto
 *   - Workflow vente : prix final, dates compromis et vente
 *   - Ancrage blockchain : bouton "Ancrer dans registre des mandats" qui
 *     calcule le SHA256 canonique et le queue pour le batch Solana Y2
 *   - Historique des transitions de statuts
 *
 * URL : /cabinets/{slug}/admin/lead/{id}
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { GenerateMandatHoguetCard } from "./GenerateMandatHoguetCard";

type Lead = {
  id: string;
  visitor_name: string;
  visitor_email: string;
  visitor_phone: string | null;
  intent: string | null;
  type_bien: string;
  address: string;
  surface: number | null;
  wizard_answers: Record<string, unknown>;
  prix_m2_median: number | null;
  prix_m2_p10: number | null;
  prix_m2_p90: number | null;
  prix_total_median: number | null;
  nb_ventes: number | null;
  status: string;
  email_to_cabinet_sent: boolean;
  email_to_visitor_sent: boolean;
  created_at: string;
  // Migration 36 — champs mandat
  mandat_type: "vente" | "recherche" | "location" | null;
  mandat_modalite: "simple" | "exclusif" | "semi_exclusif" | null;
  mandat_signe_at: string | null;
  mandat_duree_mois: number | null;
  mandat_date_fin: string | null;
  mandat_commission_pct: number | null;
  mandat_prix_net_vendeur: number | null;
  mandat_prix_max: number | null;
  mandat_numero_registre: string | null;
  mandat_criteres_recherche: Record<string, unknown> | null;
  visite_planifiee_at: string | null;
  visite_realisee_at: string | null;
  visite_notes: string | null;
  vente_prix_final: number | null;
  vente_date: string | null;
  vente_compromis_date: string | null;
  notes_agent: string | null;
  // Migration 37 — pipeline signature
  signature_provider: "yousign" | "docusign" | "paper_upload" | null;
  signature_status:
    | "not_started"
    | "pdf_generated"
    | "sent_for_signature"
    | "signed_electronic"
    | "uploaded_paper"
    | "matched_ok"
    | "mismatch_pending_review"
    | "cancelled"
    | null;
  signed_pdf_url: string | null;
  signature_mismatch_alerts: Array<{
    field: string;
    expected: string | number | null;
    found: string | number | null;
    severity: "high" | "medium" | "low";
    reason: string;
  }> | null;
  signature_match_attempts: number;
};

type HistoryRow = {
  from_status: string | null;
  to_status: string;
  changed_at: string;
  changed_by_email: string | null;
  note: string | null;
};

type AnchorRow = {
  id: string;
  mandate_hash_sha256: string;
  anchor_status: "pending" | "batched" | "anchored" | "failed" | "opted_out";
  merkle_root_batch_id: string | null;
  solana_tx_sig: string | null;
  solana_slot: number | null;
  anchored_at: string | null;
  triggered_by_email: string | null;
  retry_count: number;
  created_at: string;
  updated_at: string;
  error_message?: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  new: "Reçu",
  contacted: "Contacté",
  rdv_planifie: "RDV planifié",
  mandat_signe: "Mandat signé",
  vendu: "Vendu",
  non_vendu: "Non vendu",
  lost: "Perdu",
};

const STATUS_KEYS = ["new", "contacted", "rdv_planifie", "mandat_signe", "vendu", "non_vendu", "lost"];

const MANDAT_TYPE_LABELS: Record<string, string> = {
  vente: "Mandat de vente",
  recherche: "Mandat de recherche",
  location: "Mandat de location",
};

const MANDAT_MODALITE_LABELS: Record<string, string> = {
  simple: "Simple (non exclusif)",
  exclusif: "Exclusif",
  semi_exclusif: "Semi-exclusif",
};

const ANCHOR_STATUS_LABELS: Record<string, string> = {
  pending: "En file d'attente",
  batched: "Inclus dans le batch Merkle",
  anchored: "Ancré on-chain Solana",
  failed: "Échec — peut être relancé",
  opted_out: "Exclu volontairement",
};

const ANCHOR_STATUS_COLORS: Record<string, string> = {
  pending: "#f59e0b",
  batched: "#8b5cf6",
  anchored: "#10b981",
  failed: "#ef4444",
  opted_out: "#94a3b8",
};

const fmt = (n: number | null | undefined) =>
  n != null && Number.isFinite(n)
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)
    : "—";

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "—";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/** Pour les inputs datetime-local : "YYYY-MM-DDTHH:mm" (sans fuseau). */
const toDateTimeLocal = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** Pour les inputs date : "YYYY-MM-DD". */
const toDateInput = (iso: string | null): string => {
  if (!iso) return "";
  return iso.slice(0, 10);
};

export default function LeadDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const [slug, setSlug] = useState("");
  const [leadId, setLeadId] = useState("");
  const [lead, setLead] = useState<Lead | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [anchor, setAnchor] = useState<AnchorRow | null>(null);
  const [cabinet, setCabinet] = useState<{ cabinet_name: string; primary_color: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [newStatus, setNewStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [anchoring, setAnchoring] = useState(false);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const router = useRouter();

  const load = useCallback(async (s: string, id: string) => {
    const [leadRes, cabRes] = await Promise.all([
      fetch(`/api/cabinets/${s}/admin/leads/${id}`, { cache: "no-store" }),
      fetch(`/api/cabinets/${s}`, { cache: "no-store" }),
    ]);
    if (leadRes.status === 401) {
      router.push(`/cabinets/${s}/admin/login?error=invalid_or_expired`);
      return;
    }
    if (leadRes.ok) {
      const data = (await leadRes.json()) as {
        lead: Lead;
        history: HistoryRow[];
        anchor: AnchorRow | null;
      };
      setLead(data.lead);
      setHistory(data.history);
      setAnchor(data.anchor);
      setNewStatus(data.lead.status);
    }
    if (cabRes.ok) setCabinet(await cabRes.json());
  }, [router]);

  useEffect(() => {
    (async () => {
      const { slug: s, id } = await params;
      setSlug(s);
      setLeadId(id);
      await load(s, id);
    })();
  }, [params, load]);

  function showToast(kind: "ok" | "err", msg: string) {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 4000);
  }

  // ── PATCH générique sur le lead ───────────────────────────────────────────
  async function patchLead(patch: Partial<Lead>) {
    if (!lead || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/cabinets/${slug}/admin/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        showToast("err", j.detail ?? j.error ?? "Erreur");
        return;
      }
      await load(slug, leadId);
      showToast("ok", "Enregistré");
    } finally {
      setSaving(false);
    }
  }

  // ── Change status ─────────────────────────────────────────────────────────
  async function applyChange() {
    if (!lead || saving) return;
    if (newStatus === lead.status && !noteText.trim()) return;
    setSaving(true);
    try {
      await fetch(`/api/cabinets/${slug}/admin/leads/${leadId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          new_status: newStatus,
          note: noteText.trim() || undefined,
        }),
      });
      setNoteText("");
      await load(slug, leadId);
      showToast("ok", `Statut → ${STATUS_LABELS[newStatus] ?? newStatus}`);
    } finally {
      setSaving(false);
    }
  }

  // ── Ancrer dans registre blockchain ──────────────────────────────────────
  async function triggerAnchor() {
    if (!lead || anchoring) return;
    if (!lead.mandat_signe_at) {
      showToast("err", "Renseigne d'abord la date de signature du mandat");
      return;
    }
    if (!lead.mandat_type) {
      showToast("err", "Renseigne d'abord le type de mandat");
      return;
    }
    setAnchoring(true);
    try {
      const res = await fetch(`/api/cabinets/${slug}/admin/leads/${leadId}/anchor`, {
        method: "POST",
      });
      const j = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        anchor?: AnchorRow;
        error?: string;
        message?: string;
      };
      if (!res.ok || !j.success) {
        showToast("err", j.message ?? j.error ?? "Échec ancrage");
        return;
      }
      await load(slug, leadId);
      showToast("ok", "Mandat ancré (status pending)");
    } finally {
      setAnchoring(false);
    }
  }

  if (!lead || !cabinet) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        Chargement…
      </div>
    );
  }

  const primary = cabinet.primary_color;
  const a = lead.wizard_answers ?? {};

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 16 }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        {/* Back link */}
        <a
          href={`/cabinets/${slug}/admin`}
          style={{ fontSize: 13, color: primary, textDecoration: "none" }}
        >
          ← Retour au pipeline
        </a>

        {/* Header */}
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>
                {lead.visitor_name}
              </div>
              <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
                <a href={`mailto:${lead.visitor_email}`} style={{ color: primary, textDecoration: "none" }}>
                  {lead.visitor_email}
                </a>
                {lead.visitor_phone && (
                  <>
                    {" · "}
                    <a href={`tel:${lead.visitor_phone}`} style={{ color: primary, textDecoration: "none" }}>
                      {lead.visitor_phone}
                    </a>
                  </>
                )}
              </div>
              <div
                style={{
                  marginTop: 12,
                  display: "inline-block",
                  padding: "4px 12px",
                  background: primary + "15",
                  color: primary,
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {STATUS_LABELS[lead.status] ?? lead.status}
              </div>
            </div>
            {lead.mandat_numero_registre && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Registre carte T
                </div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", fontFamily: "monospace" }}>
                  {lead.mandat_numero_registre}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Bien */}
        <Card>
          <SectionTitle primary={primary}>Bien</SectionTitle>
          <div style={{ marginTop: 10 }}>
            <DetailRow label="Adresse" value={lead.address} />
            <DetailRow label="Type" value={lead.type_bien} />
            {lead.surface != null && <DetailRow label="Surface" value={`${lead.surface} m²`} />}
            {Boolean(a.pieces) && <DetailRow label="Pièces" value={`T${String(a.pieces)}`} />}
            {Boolean(a.etage) && <DetailRow label="Étage" value={String(a.etage)} />}
            {Boolean(a.annee_construction) && <DetailRow label="Année" value={String(a.annee_construction)} />}
            {Boolean(a.dpe) && a.dpe !== "inconnu" && <DetailRow label="DPE" value={`Classe ${String(a.dpe).toUpperCase()}`} />}
            {Boolean(a.etat) && <DetailRow label="État" value={String(a.etat)} />}
            {Array.isArray(a.exterieurs) && a.exterieurs.length > 0 && (
              <DetailRow label="Extérieurs" value={(a.exterieurs as string[]).join(", ")} />
            )}
            {Boolean(a.usage) && <DetailRow label="Usage" value={String(a.usage)} />}
          </div>
        </Card>

        {/* Estimation */}
        {lead.prix_total_median != null && (
          <Card>
            <SectionTitle primary={primary}>Estimation DATAMERRY</SectionTitle>
            <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
              <Stat label="Estimation centrale" value={`${fmt(lead.prix_total_median)} €`} highlight={primary} />
              {lead.prix_m2_median != null && (
                <Stat label="Prix m² médian" value={`${fmt(lead.prix_m2_median)} €/m²`} />
              )}
              {lead.prix_m2_p10 != null && lead.surface && (
                <Stat label="Plancher" value={`${fmt(Math.round(lead.prix_m2_p10 * lead.surface))} €`} />
              )}
              {lead.prix_m2_p90 != null && lead.surface && (
                <Stat label="Plafond" value={`${fmt(Math.round(lead.prix_m2_p90 * lead.surface))} €`} />
              )}
              {lead.nb_ventes != null && (
                <Stat label="Ventes DVF dans la zone" value={`${lead.nb_ventes}`} />
              )}
            </div>
          </Card>
        )}

        {/* ── WORKFLOW VISITE ────────────────────────────────────────────── */}
        <VisiteForm
          lead={lead}
          primary={primary}
          saving={saving}
          onSubmit={patchLead}
        />

        {/* ── WORKFLOW MANDAT ───────────────────────────────────────────── */}
        <MandatForm
          lead={lead}
          anchor={anchor}
          primary={primary}
          saving={saving}
          onSubmit={patchLead}
        />

        {/* ── GÉNÉRATION DU MANDAT HOGUET (DOCX) ─────────────────────────── */}
        <GenerateMandatHoguetCard
          lead={lead}
          slug={slug}
          leadId={leadId}
          primary={primary}
          onGenerated={() => load(slug, leadId)}
          onToast={showToast}
        />

        {/* ── SIGNATURE ÉLECTRONIQUE OU PAPIER UPLOAD ───────────────────── */}
        <SignatureCard
          lead={lead}
          slug={slug}
          leadId={leadId}
          primary={primary}
          onUploaded={() => load(slug, leadId)}
          onToast={showToast}
        />

        {/* ── WORKFLOW VENTE ─────────────────────────────────────────────── */}
        {(lead.status === "mandat_signe" || lead.status === "vendu" || lead.vente_prix_final != null) && (
          <VenteForm
            lead={lead}
            primary={primary}
            saving={saving}
            onSubmit={patchLead}
          />
        )}

        {/* ── ANCRAGE BLOCKCHAIN ─────────────────────────────────────────── */}
        {lead.mandat_signe_at && (
          <BlockchainCard
            lead={lead}
            anchor={anchor}
            primary={primary}
            anchoring={anchoring}
            onAnchor={triggerAnchor}
          />
        )}

        {/* Change status */}
        <Card>
          <SectionTitle primary={primary}>Changer le statut</SectionTitle>
          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
            <select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              style={selectStyle}
            >
              {STATUS_KEYS.map((k) => (
                <option key={k} value={k}>
                  {STATUS_LABELS[k]}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Note (optionnel)"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              maxLength={1000}
              style={{ ...inputStyle, flex: 1, minWidth: 200 }}
            />
            <button
              onClick={applyChange}
              disabled={saving || (newStatus === lead.status && !noteText.trim())}
              style={buttonStyle(primary, saving)}
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </Card>

        {/* Notes agent libre */}
        <NotesAgentCard lead={lead} primary={primary} saving={saving} onSubmit={patchLead} />

        {/* History */}
        <Card>
          <SectionTitle primary={primary}>Historique</SectionTitle>
          <div style={{ marginTop: 12 }}>
            {history.length === 0 ? (
              <div style={{ fontSize: 13, color: "#94a3b8" }}>Aucun historique.</div>
            ) : (
              history.map((h, i) => (
                <div
                  key={i}
                  style={{
                    padding: "8px 0",
                    borderBottom: i < history.length - 1 ? "1px solid #f1f5f9" : "none",
                  }}
                >
                  <div style={{ fontSize: 12, color: "#0f172a", fontWeight: 600 }}>
                    {h.from_status
                      ? `${STATUS_LABELS[h.from_status] ?? h.from_status} → ${STATUS_LABELS[h.to_status] ?? h.to_status}`
                      : `Création (statut initial : ${STATUS_LABELS[h.to_status] ?? h.to_status})`}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {fmtDateTime(h.changed_at)}
                    {h.changed_by_email && ` · par ${h.changed_by_email}`}
                  </div>
                  {h.note && (
                    <div style={{ fontSize: 12, color: "#475569", marginTop: 4, fontStyle: "italic" }}>
                      « {h.note} »
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>

        <div style={{ marginTop: 24, textAlign: "center", fontSize: 11, color: "#94a3b8" }}>
          Propulsé par <strong>DATAMERRY®</strong>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            background: toast.kind === "ok" ? "#10b981" : "#ef4444",
            color: "white",
            padding: "10px 18px",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
            zIndex: 1000,
          }}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Sous-composants formulaires workflow
// ══════════════════════════════════════════════════════════════════════════

function VisiteForm({
  lead,
  primary,
  saving,
  onSubmit,
}: {
  lead: Lead;
  primary: string;
  saving: boolean;
  onSubmit: (p: Partial<Lead>) => void;
}) {
  const [planifiee, setPlanifiee] = useState(toDateTimeLocal(lead.visite_planifiee_at));
  const [realisee, setRealisee] = useState(toDateTimeLocal(lead.visite_realisee_at));
  const [notes, setNotes] = useState(lead.visite_notes ?? "");

  useEffect(() => {
    setPlanifiee(toDateTimeLocal(lead.visite_planifiee_at));
    setRealisee(toDateTimeLocal(lead.visite_realisee_at));
    setNotes(lead.visite_notes ?? "");
  }, [lead]);

  return (
    <Card>
      <SectionTitle primary={primary}>Visite</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
        <Field label="Visite planifiée le">
          <input
            type="datetime-local"
            value={planifiee}
            onChange={(e) => setPlanifiee(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Visite réalisée le">
          <input
            type="datetime-local"
            value={realisee}
            onChange={(e) => setRealisee(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>
      <Field label="Notes de visite">
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="État réel, prestations, vue, exposition, vétusté, points forts/faibles…"
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Field>
      <div style={{ marginTop: 10 }}>
        <button
          onClick={() =>
            onSubmit({
              visite_planifiee_at: planifiee ? new Date(planifiee).toISOString() : null,
              visite_realisee_at: realisee ? new Date(realisee).toISOString() : null,
              visite_notes: notes.trim() || null,
            })
          }
          disabled={saving}
          style={buttonStyle(primary, saving)}
        >
          {saving ? "Enregistrement…" : "Enregistrer visite"}
        </button>
      </div>
    </Card>
  );
}

function MandatForm({
  lead,
  anchor,
  primary,
  saving,
  onSubmit,
}: {
  lead: Lead;
  anchor: AnchorRow | null;
  primary: string;
  saving: boolean;
  onSubmit: (p: Partial<Lead>) => void;
}) {
  const [type, setType] = useState<string>(lead.mandat_type ?? "");
  const [modalite, setModalite] = useState<string>(lead.mandat_modalite ?? "");
  const [signeAt, setSigneAt] = useState(toDateInput(lead.mandat_signe_at));
  const [duree, setDuree] = useState<string>(lead.mandat_duree_mois?.toString() ?? "3");
  const [com, setCom] = useState<string>(lead.mandat_commission_pct?.toString() ?? "");
  const [prixNet, setPrixNet] = useState<string>(lead.mandat_prix_net_vendeur?.toString() ?? "");
  const [prixMax, setPrixMax] = useState<string>(lead.mandat_prix_max?.toString() ?? "");

  useEffect(() => {
    setType(lead.mandat_type ?? "");
    setModalite(lead.mandat_modalite ?? "");
    setSigneAt(toDateInput(lead.mandat_signe_at));
    setDuree(lead.mandat_duree_mois?.toString() ?? "3");
    setCom(lead.mandat_commission_pct?.toString() ?? "");
    setPrixNet(lead.mandat_prix_net_vendeur?.toString() ?? "");
    setPrixMax(lead.mandat_prix_max?.toString() ?? "");
  }, [lead]);

  const isVente = type === "vente";
  const isRecherche = type === "recherche";

  return (
    <Card>
      <SectionTitle primary={primary}>Mandat</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
        <Field label="Type de mandat" required>
          <select value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
            <option value="">— Choisir —</option>
            <option value="vente">Mandat de vente (vendeur)</option>
            <option value="recherche">Mandat de recherche (acquéreur)</option>
            <option value="location">Mandat de location</option>
          </select>
        </Field>
        {isVente && (
          <Field label="Modalité">
            <select value={modalite} onChange={(e) => setModalite(e.target.value)} style={selectStyle}>
              <option value="">— Choisir —</option>
              <option value="simple">Simple (non exclusif)</option>
              <option value="exclusif">Exclusif</option>
              <option value="semi_exclusif">Semi-exclusif</option>
            </select>
          </Field>
        )}
        <Field label="Date de signature">
          <input
            type="date"
            value={signeAt}
            onChange={(e) => setSigneAt(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Durée (mois)" hint="1 à 36 mois">
          <input
            type="number"
            min={1}
            max={36}
            value={duree}
            onChange={(e) => setDuree(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Commission (% TTC)" hint="3-7 % pour vente, 1-3 % pour recherche">
          <input
            type="number"
            min={0}
            max={20}
            step={0.1}
            value={com}
            onChange={(e) => setCom(e.target.value)}
            style={inputStyle}
          />
        </Field>
        {isVente && (
          <Field label="Prix net vendeur (€)">
            <input
              type="number"
              min={0}
              step={1000}
              value={prixNet}
              onChange={(e) => setPrixNet(e.target.value)}
              style={inputStyle}
            />
          </Field>
        )}
        {isRecherche && (
          <Field label="Budget max acquéreur (€)">
            <input
              type="number"
              min={0}
              step={10000}
              value={prixMax}
              onChange={(e) => setPrixMax(e.target.value)}
              style={inputStyle}
            />
          </Field>
        )}
      </div>
      {lead.mandat_date_fin && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#64748b" }}>
          Date de fin calculée : <strong>{fmtDate(lead.mandat_date_fin)}</strong>
        </div>
      )}
      {/* Label dynamique selon l'état d'ancrage blockchain :
            - jamais signé        → "Signer le mandat"
            - signé + pending     → "Mettre à jour mandat" (autorisé jusqu'à publication mensuelle)
            - signé + anchored    → "Créer un avenant" (immuable on-chain, nouvelle entrée Y2) */}
      {(() => {
        const isAnchored = anchor?.anchor_status === "anchored";
        const isSigned = Boolean(lead.mandat_signe_at);
        let buttonLabel: string;
        if (saving) buttonLabel = "Enregistrement…";
        else if (!isSigned) buttonLabel = "Signer le mandat";
        else if (isAnchored) buttonLabel = "Créer un avenant";
        else buttonLabel = "Mettre à jour mandat";

        return (
          <>
            <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={() => {
                  if (isAnchored) {
                    alert(
                      "Le mandat est ancré on-chain (immuable). " +
                        "La création d'avenants sera disponible quand le smart contract Solana sera déployé (Y2). " +
                        "Pour l'instant, contacte DATAMERRY pour traiter cette modification.",
                    );
                    return;
                  }
                  onSubmit({
                    mandat_type: (type || null) as Lead["mandat_type"],
                    mandat_modalite: isVente ? ((modalite || null) as Lead["mandat_modalite"]) : null,
                    mandat_signe_at: signeAt ? new Date(signeAt + "T12:00:00").toISOString() : null,
                    mandat_duree_mois: duree ? Number(duree) : null,
                    mandat_commission_pct: com ? Number(com) : null,
                    mandat_prix_net_vendeur: isVente && prixNet ? Number(prixNet) : null,
                    mandat_prix_max: isRecherche && prixMax ? Number(prixMax) : null,
                  });
                }}
                disabled={saving || !type}
                style={buttonStyle(primary, saving || !type)}
              >
                {buttonLabel}
              </button>
              {isSigned && (
                <span style={{ fontSize: 11, color: "#64748b", alignSelf: "center" }}>
                  Mandat n° <strong>{lead.mandat_numero_registre ?? "—"}</strong> signé le {fmtDate(lead.mandat_signe_at)}
                </span>
              )}
            </div>

            {/* Warnings contextuels selon l'état d'ancrage */}
            {isSigned && !isAnchored && (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 12px",
                  background: "#fef3c7",
                  borderLeft: "3px solid #f59e0b",
                  borderRadius: 4,
                  fontSize: 11,
                  color: "#78350f",
                  lineHeight: 1.5,
                }}
              >
                <strong>Phase de grâce :</strong> le mandat n&apos;est pas encore publié on-chain.
                Toute modification recalcule le hash et reste possible jusqu&apos;à la publication
                mensuelle Solana (Merkle Root agrégé).
              </div>
            )}
            {isSigned && isAnchored && (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 12px",
                  background: "#dcfce7",
                  borderLeft: "3px solid #10b981",
                  borderRadius: 4,
                  fontSize: 11,
                  color: "#065f46",
                  lineHeight: 1.5,
                }}
              >
                <strong>Mandat scellé on-chain.</strong> Le hash est immuable depuis la
                publication. Toute modification doit faire l&apos;objet d&apos;un{" "}
                <strong>avenant</strong> (nouveau document juridique → nouvelle entrée
                ancrée séparément).
              </div>
            )}
          </>
        );
      })()}
    </Card>
  );
}

function VenteForm({
  lead,
  primary,
  saving,
  onSubmit,
}: {
  lead: Lead;
  primary: string;
  saving: boolean;
  onSubmit: (p: Partial<Lead>) => void;
}) {
  const [prixFinal, setPrixFinal] = useState<string>(lead.vente_prix_final?.toString() ?? "");
  const [compromisDate, setCompromisDate] = useState(toDateInput(lead.vente_compromis_date));
  const [venteDate, setVenteDate] = useState(toDateInput(lead.vente_date));

  useEffect(() => {
    setPrixFinal(lead.vente_prix_final?.toString() ?? "");
    setCompromisDate(toDateInput(lead.vente_compromis_date));
    setVenteDate(toDateInput(lead.vente_date));
  }, [lead]);

  const com = lead.mandat_commission_pct;
  const comEstimee = prixFinal && com ? Math.round(Number(prixFinal) * com / 100) : null;

  return (
    <Card>
      <SectionTitle primary={primary}>Vente</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginTop: 12 }}>
        <Field label="Prix final (€)">
          <input
            type="number"
            min={0}
            step={1000}
            value={prixFinal}
            onChange={(e) => setPrixFinal(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Compromis signé le">
          <input
            type="date"
            value={compromisDate}
            onChange={(e) => setCompromisDate(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Acte authentique le">
          <input
            type="date"
            value={venteDate}
            onChange={(e) => setVenteDate(e.target.value)}
            style={inputStyle}
          />
        </Field>
      </div>
      {comEstimee != null && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#15803d", fontWeight: 600 }}>
          Commission estimée : <strong>{fmt(comEstimee)} €</strong> ({com} %)
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <button
          onClick={() =>
            onSubmit({
              vente_prix_final: prixFinal ? Number(prixFinal) : null,
              vente_compromis_date: compromisDate || null,
              vente_date: venteDate || null,
            })
          }
          disabled={saving}
          style={buttonStyle(primary, saving)}
        >
          {saving ? "Enregistrement…" : "Enregistrer vente"}
        </button>
      </div>
    </Card>
  );
}

function NotesAgentCard({
  lead,
  primary,
  saving,
  onSubmit,
}: {
  lead: Lead;
  primary: string;
  saving: boolean;
  onSubmit: (p: Partial<Lead>) => void;
}) {
  const [notes, setNotes] = useState(lead.notes_agent ?? "");
  useEffect(() => setNotes(lead.notes_agent ?? ""), [lead]);
  return (
    <Card>
      <SectionTitle primary={primary}>Notes agent</SectionTitle>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={4}
        placeholder="Suivi qualitatif libre : motivation vendeur, contraintes, négociation, etc."
        style={{ ...inputStyle, marginTop: 10, resize: "vertical" }}
      />
      <div style={{ marginTop: 10 }}>
        <button
          onClick={() => onSubmit({ notes_agent: notes.trim() || null })}
          disabled={saving}
          style={buttonStyle(primary, saving)}
        >
          {saving ? "Enregistrement…" : "Enregistrer notes"}
        </button>
      </div>
    </Card>
  );
}

function BlockchainCard({
  lead,
  anchor,
  primary,
  anchoring,
  onAnchor,
}: {
  lead: Lead;
  anchor: AnchorRow | null;
  primary: string;
  anchoring: boolean;
  onAnchor: () => void;
}) {
  const [showHash, setShowHash] = useState(false);
  const statusColor = anchor ? ANCHOR_STATUS_COLORS[anchor.anchor_status] : "#94a3b8";
  return (
    <Card>
      <SectionTitle primary={primary}>Registre blockchain — Solana</SectionTitle>
      {anchor ? (
        <>
          <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span
              style={{
                display: "inline-block",
                padding: "4px 12px",
                background: statusColor + "22",
                color: statusColor,
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {ANCHOR_STATUS_LABELS[anchor.anchor_status]}
            </span>
            {anchor.retry_count > 0 && (
              <span style={{ fontSize: 11, color: "#64748b" }}>
                Tentative n°{anchor.retry_count + 1}
              </span>
            )}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "#475569" }}>
            <div>
              Hash SHA256 :{" "}
              <code style={{ fontSize: 11, color: "#0f172a", fontFamily: "monospace" }}>
                {showHash ? anchor.mandate_hash_sha256 : anchor.mandate_hash_sha256.slice(0, 16) + "…"}
              </code>{" "}
              <button
                type="button"
                onClick={() => setShowHash((v) => !v)}
                style={{ background: "none", border: "none", color: primary, fontSize: 11, cursor: "pointer", textDecoration: "underline", padding: 0 }}
              >
                {showHash ? "masquer" : "voir"}
              </button>
            </div>
            {anchor.solana_tx_sig && (
              <div style={{ marginTop: 4 }}>
                Tx Solana :{" "}
                <a
                  href={`https://explorer.solana.com/tx/${anchor.solana_tx_sig}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: primary, textDecoration: "none", fontFamily: "monospace", fontSize: 11 }}
                >
                  {anchor.solana_tx_sig.slice(0, 16)}…
                </a>
              </div>
            )}
            {anchor.anchored_at && (
              <div style={{ marginTop: 4 }}>Ancré le {fmtDateTime(anchor.anchored_at)}</div>
            )}
            {anchor.error_message && (
              <div style={{ marginTop: 4, color: "#ef4444" }}>
                Erreur : {anchor.error_message}
              </div>
            )}
          </div>
          {anchor.anchor_status === "failed" && (
            <div style={{ marginTop: 12 }}>
              <button onClick={onAnchor} disabled={anchoring} style={buttonStyle(primary, anchoring)}>
                {anchoring ? "Relance…" : "Relancer l'ancrage"}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "#475569", marginTop: 10, lineHeight: 1.5 }}>
            <strong>Ancrage automatique à la signature du mandat.</strong>
            {" "}Dès que tu enregistres la signature, l&apos;empreinte cryptographique SHA256 du
            mandat est mise en file d&apos;attente pour publication on-chain Solana. Seule
            l&apos;empreinte est publiée — jamais les données personnelles.
          </p>
          <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 6, fontStyle: "italic" }}>
            Conformité : CNIL délibération 2018-303 (blockchain &amp; RGPD), loi Hoguet n° 70-9.
            {" "}Le Merkle Root mensuel sera publié sur Solana à compter de la mise en service du
            smart contract Anchor (Y2).
          </p>
          {!lead.mandat_signe_at && (
            <p style={{ fontSize: 11, color: "#94a3b8", marginTop: 8, fontStyle: "italic" }}>
              En attente de la signature du mandat ci-dessus.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Signature électronique (Yousign Y1 Q1) OU upload PDF papier
// ══════════════════════════════════════════════════════════════════════════

function SignatureCard({
  lead,
  slug,
  leadId,
  primary,
  onUploaded,
  onToast,
}: {
  lead: Lead;
  slug: string;
  leadId: string;
  primary: string;
  onUploaded: () => void;
  onToast: (kind: "ok" | "err", msg: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [showAlerts, setShowAlerts] = useState(true);

  async function handleUpload(file: File) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      onToast("err", "Fichier trop volumineux (max 20 Mo)");
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      onToast("err", "Le fichier doit être un PDF");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(
        `/api/cabinets/${slug}/admin/leads/${leadId}/signature/upload`,
        { method: "POST", body: formData },
      );
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        match_ok?: boolean;
        match_score?: number;
        alerts?: Lead["signature_mismatch_alerts"];
        error?: string;
        message?: string;
      };
      if (!res.ok || !j.ok) {
        onToast("err", j.message ?? j.error ?? `Échec upload (${res.status})`);
        return;
      }
      if (j.match_ok) {
        onToast("ok", `Mandat validé (score ${j.match_score}/100)`);
      } else {
        const n = j.alerts?.length ?? 0;
        onToast("err", `Mismatch détecté sur ${n} champ${n > 1 ? "s" : ""} (à revoir)`);
      }
      onUploaded();
    } catch (e) {
      onToast("err", "Erreur réseau : " + (e instanceof Error ? e.message : "inconnue"));
    } finally {
      setUploading(false);
    }
  }

  const status = lead.signature_status;
  const provider = lead.signature_provider;
  const alerts = lead.signature_mismatch_alerts ?? [];
  const isMatched = status === "matched_ok";
  const isMismatch = status === "mismatch_pending_review";

  return (
    <Card>
      <SectionTitle primary={primary}>Signature du mandat</SectionTitle>

      {/* État : pas encore lancé */}
      {!status && !lead.mandat_signe_at && (
        <>
          <p style={{ fontSize: 13, color: "#475569", marginTop: 10, lineHeight: 1.5 }}>
            Le mandat n&apos;est juridiquement opposable qu&apos;une fois <strong>signé</strong>.
            Deux options selon ton client :
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
            <SignatureOption
              icon="📧"
              title="Signature électronique"
              desc="Yousign / DocuSign — eIDAS qualifiée. Idéal pour clients à l'aise avec le digital."
              primary={primary}
              comingSoon
            />
            <SignatureOption
              icon="📄"
              title="Mandat papier signé"
              desc="Faire signer en physique puis uploader le PDF scanné. Vérification automatique des champs."
              primary={primary}
              uploading={uploading}
              onUpload={handleUpload}
            />
          </div>
        </>
      )}

      {/* État : matched OK */}
      {isMatched && (
        <>
          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span
              style={{
                display: "inline-block",
                padding: "4px 12px",
                background: "#dcfce7",
                color: "#065f46",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              ✓ Signature validée
            </span>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {provider === "paper_upload" ? "Mandat papier uploadé" : "Signature électronique"}
              {" — "}tous les champs CRM correspondent au PDF
            </span>
          </div>
          {lead.signed_pdf_url && (
            <div style={{ marginTop: 10 }}>
              <a
                href={lead.signed_pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 12, color: primary, textDecoration: "none" }}
              >
                📎 Voir le PDF signé →
              </a>
            </div>
          )}
        </>
      )}

      {/* État : mismatch pending review */}
      {isMismatch && alerts.length > 0 && (
        <>
          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <span
              style={{
                display: "inline-block",
                padding: "4px 12px",
                background: "#fef3c7",
                color: "#78350f",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              ⚠️ {alerts.length} divergence{alerts.length > 1 ? "s" : ""} détectée{alerts.length > 1 ? "s" : ""}
            </span>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              Tentative n°{lead.signature_match_attempts}
            </span>
            <button
              type="button"
              onClick={() => setShowAlerts((v) => !v)}
              style={{
                background: "none",
                border: "none",
                color: primary,
                fontSize: 11,
                cursor: "pointer",
                textDecoration: "underline",
                padding: 0,
              }}
            >
              {showAlerts ? "Masquer détails" : "Voir détails"}
            </button>
          </div>

          {showAlerts && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              {alerts.map((a, i) => (
                <div
                  key={i}
                  style={{
                    padding: "8px 12px",
                    background: a.severity === "high" ? "#fee2e2" : a.severity === "medium" ? "#fef3c7" : "#f1f5f9",
                    borderLeft: `3px solid ${a.severity === "high" ? "#ef4444" : a.severity === "medium" ? "#f59e0b" : "#94a3b8"}`,
                    borderRadius: 4,
                    fontSize: 11,
                    color: "#0f172a",
                  }}
                >
                  <div style={{ fontWeight: 700, color: a.severity === "high" ? "#991b1b" : a.severity === "medium" ? "#78350f" : "#475569" }}>
                    {SEVERITY_LABEL[a.severity]} · {FIELD_LABEL[a.field] ?? a.field}
                  </div>
                  <div style={{ marginTop: 4, lineHeight: 1.5 }}>{a.reason}</div>
                  <div style={{ marginTop: 4, color: "#64748b", fontFamily: "monospace", fontSize: 10 }}>
                    CRM : <strong>{String(a.expected ?? "—")}</strong> — PDF : <strong>{String(a.found ?? "—")}</strong>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {lead.signed_pdf_url && (
              <a
                href={lead.signed_pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  padding: "8px 14px",
                  background: "transparent",
                  color: primary,
                  border: `1.5px solid ${primary}`,
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 700,
                  textDecoration: "none",
                  display: "inline-block",
                }}
              >
                📎 Voir le PDF
              </a>
            )}
            <label
              htmlFor="reupload-pdf"
              style={{
                padding: "8px 14px",
                background: primary,
                color: "white",
                borderRadius: 8,
                fontSize: 12,
                fontWeight: 700,
                cursor: uploading ? "not-allowed" : "pointer",
                opacity: uploading ? 0.5 : 1,
                display: "inline-block",
              }}
            >
              {uploading ? "Upload…" : "Re-uploader un nouveau PDF"}
            </label>
            <input
              id="reupload-pdf"
              type="file"
              accept="application/pdf,.pdf"
              style={{ display: "none" }}
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
          </div>
        </>
      )}

      {/* État : déjà signé mais via une autre voie (manuel CRM) */}
      {!status && lead.mandat_signe_at && (
        <p style={{ fontSize: 12, color: "#64748b", marginTop: 10, fontStyle: "italic" }}>
          Mandat marqué comme signé via le formulaire ci-dessus. Pour bénéficier de la vérification
          automatique CRM ↔ PDF, uploade le PDF papier signé du mandat (eIDAS-compliant).
        </p>
      )}
    </Card>
  );
}

const SEVERITY_LABEL: Record<string, string> = {
  high: "⛔ Critique",
  medium: "⚠️ Important",
  low: "ℹ️ Mineur",
};

const FIELD_LABEL: Record<string, string> = {
  mandat_type: "Type de mandat",
  mandat_modalite: "Modalité",
  mandat_duree_mois: "Durée (mois)",
  mandat_commission_pct: "Commission %",
  mandat_prix_net_vendeur: "Prix net vendeur",
  mandat_prix_max: "Budget max",
  address: "Adresse",
  surface: "Surface",
  type_bien: "Type de bien",
  visitor_name: "Nom du mandant",
  mandat_signe_at: "Date de signature",
};

function SignatureOption({
  icon,
  title,
  desc,
  primary,
  comingSoon,
  uploading,
  onUpload,
}: {
  icon: string;
  title: string;
  desc: string;
  primary: string;
  comingSoon?: boolean;
  uploading?: boolean;
  onUpload?: (file: File) => void;
}) {
  return (
    <div
      style={{
        padding: 14,
        background: "white",
        border: `1.5px solid ${comingSoon ? "#e2e8f0" : primary}`,
        borderRadius: 10,
        opacity: comingSoon ? 0.6 : 1,
      }}
    >
      <div style={{ fontSize: 20 }}>{icon}</div>
      <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a", marginTop: 6 }}>{title}</div>
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>{desc}</div>
      {comingSoon ? (
        <div style={{ marginTop: 10, fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>
          Disponible Y1 Q1 2027 (abonnement Yousign requis)
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <label
            htmlFor="upload-pdf-mandat"
            style={{
              padding: "7px 12px",
              background: primary,
              color: "white",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              cursor: uploading ? "not-allowed" : "pointer",
              opacity: uploading ? 0.5 : 1,
              display: "inline-block",
            }}
          >
            {uploading ? "Analyse en cours…" : "📎 Uploader le PDF signé"}
          </label>
          <input
            id="upload-pdf-mandat"
            type="file"
            accept="application/pdf,.pdf"
            style={{ display: "none" }}
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && onUpload) onUpload(f);
              e.target.value = "";
            }}
          />
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// UI primitives
// ══════════════════════════════════════════════════════════════════════════

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        marginTop: 16,
        padding: 20,
        background: "white",
        borderRadius: 12,
        border: "1px solid #e2e8f0",
      }}
    >
      {children}
    </div>
  );
}

function SectionTitle({ primary, children }: { primary: string; children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: 11,
        color: primary,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        margin: 0,
      }}
    >
      {children}
    </h2>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span
        style={{
          fontSize: 11,
          color: "#64748b",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          fontWeight: 600,
        }}
      >
        {label}
        {required && <span style={{ color: "#ef4444" }}> *</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 10, color: "#94a3b8", fontStyle: "italic" }}>{hint}</span>}
    </label>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", marginBottom: 6 }}>
      <div style={{ flex: "0 0 130px", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", paddingTop: 2 }}>
        {label}
      </div>
      <div style={{ flex: 1, fontSize: 13, color: "#0f172a", fontWeight: 500 }}>
        {value}
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: string }) {
  return (
    <div style={{ minWidth: 110 }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: highlight ? 20 : 15,
          fontWeight: highlight ? 800 : 700,
          color: highlight ?? "#0f172a",
          marginTop: 4,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "9px 12px",
  border: "1.5px solid #cbd5e1",
  borderRadius: 8,
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  background: "white",
  cursor: "pointer",
};

const buttonStyle = (color: string, disabled?: boolean): React.CSSProperties => ({
  background: color,
  color: "white",
  border: "none",
  borderRadius: 8,
  padding: "10px 18px",
  fontSize: 14,
  fontWeight: 700,
  cursor: disabled ? "not-allowed" : "pointer",
  fontFamily: "inherit",
  opacity: disabled ? 0.5 : 1,
});
