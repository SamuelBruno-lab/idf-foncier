"use client";

/**
 * Détail d'un lead — infos visiteur, bien, estimation, caractéristiques
 * wizard, historique des transitions de statuts, action change-status.
 *
 * URL : /cabinets/{slug}/admin/lead/{id}
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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
};

type HistoryRow = {
  from_status: string | null;
  to_status: string;
  changed_at: string;
  changed_by_email: string | null;
  note: string | null;
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

const fmt = (n: number | null | undefined) =>
  n != null && Number.isFinite(n)
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)
    : "—";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function LeadDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const [slug, setSlug] = useState("");
  const [leadId, setLeadId] = useState("");
  const [lead, setLead] = useState<Lead | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [cabinet, setCabinet] = useState<{ cabinet_name: string; primary_color: string } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [newStatus, setNewStatus] = useState<string>("");
  const [saving, setSaving] = useState(false);
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
      const data = (await leadRes.json()) as { lead: Lead; history: HistoryRow[] };
      setLead(data.lead);
      setHistory(data.history);
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
    } finally {
      setSaving(false);
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
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        {/* Back link */}
        <a
          href={`/cabinets/${slug}/admin`}
          style={{ fontSize: 13, color: primary, textDecoration: "none" }}
        >
          ← Retour au pipeline
        </a>

        {/* Header */}
        <div
          style={{
            marginTop: 12,
            padding: 24,
            background: "white",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
          }}
        >
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

        {/* Bien */}
        <div
          style={{
            marginTop: 16,
            padding: 20,
            background: "white",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
          }}
        >
          <h2 style={{ fontSize: 11, color: primary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
            Bien
          </h2>
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
        </div>

        {/* Estimation */}
        {lead.prix_total_median != null && (
          <div
            style={{
              marginTop: 16,
              padding: 20,
              background: "white",
              borderRadius: 12,
              border: "1px solid #e2e8f0",
            }}
          >
            <h2 style={{ fontSize: 11, color: primary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
              Estimation DATAMERRY
            </h2>
            <div style={{ display: "flex", gap: 16, marginTop: 12, flexWrap: "wrap" }}>
              <Stat label="Estimation centrale" value={`${fmt(lead.prix_total_median)} €`} highlight={primary} />
              {lead.prix_m2_median != null && (
                <Stat label="Prix m² médian" value={`${fmt(lead.prix_m2_median)} €/m²`} />
              )}
              {lead.prix_m2_p10 != null && lead.surface && (
                <Stat
                  label="Plancher"
                  value={`${fmt(Math.round(lead.prix_m2_p10 * lead.surface))} €`}
                />
              )}
              {lead.prix_m2_p90 != null && lead.surface && (
                <Stat
                  label="Plafond"
                  value={`${fmt(Math.round(lead.prix_m2_p90 * lead.surface))} €`}
                />
              )}
              {lead.nb_ventes != null && (
                <Stat label="Ventes DVF dans la zone" value={`${lead.nb_ventes}`} />
              )}
            </div>
          </div>
        )}

        {/* Change status */}
        <div
          style={{
            marginTop: 16,
            padding: 20,
            background: "white",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
          }}
        >
          <h2 style={{ fontSize: 11, color: primary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
            Changer le statut
          </h2>
          <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
            <select
              value={newStatus}
              onChange={(e) => setNewStatus(e.target.value)}
              style={{
                padding: "10px 14px",
                border: "1.5px solid #cbd5e1",
                borderRadius: 8,
                fontSize: 14,
                fontFamily: "inherit",
                outline: "none",
                minWidth: 180,
              }}
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
              style={{
                flex: 1,
                padding: "10px 14px",
                border: "1.5px solid #cbd5e1",
                borderRadius: 8,
                fontSize: 14,
                fontFamily: "inherit",
                outline: "none",
                minWidth: 200,
              }}
            />
            <button
              onClick={applyChange}
              disabled={saving || (newStatus === lead.status && !noteText.trim())}
              style={{
                background: primary,
                color: "white",
                border: "none",
                borderRadius: 8,
                padding: "10px 18px",
                fontSize: 14,
                fontWeight: 700,
                cursor: saving ? "not-allowed" : "pointer",
                fontFamily: "inherit",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
          </div>
        </div>

        {/* History */}
        <div
          style={{
            marginTop: 16,
            padding: 20,
            background: "white",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
          }}
        >
          <h2 style={{ fontSize: 11, color: primary, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>
            Historique
          </h2>
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
        </div>

        <div style={{ marginTop: 24, textAlign: "center", fontSize: 11, color: "#94a3b8" }}>
          Propulsé par <strong>DATAMERRY®</strong>
        </div>
      </div>
    </div>
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
