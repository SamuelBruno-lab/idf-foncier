"use client";

/**
 * Dashboard admin cabinet — kanban pipeline 5 étapes.
 *
 * URL : /cabinets/{slug}/admin
 *
 * Affiche un kanban avec 5 colonnes (Reçu, Contacté, RDV planifié, Mandat
 * signé, Vendu/Perdu). Chaque carte représente un lead capturé via la page
 * /estimer publique. Le cabinet peut faire avancer le lead colonne par
 * colonne via les boutons → / ←.
 *
 * Auth : cookie session dm_admin_session (set par /verify magic link).
 * Si pas de session valide, l'API renvoie 401 → on redirige vers /login.
 *
 * Branding cabinet (couleurs primary/secondary) pour cohérence avec
 * l'expérience publique.
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
  prix_total_median: number | null;
  prix_m2_median: number | null;
  status: string;
  created_at: string;
};

type Cabinet = {
  cabinet_name: string;
  primary_color: string;
};

type StatusDef = {
  key: string;
  label: string;
  color: string;
};

const STATUSES: StatusDef[] = [
  { key: "new", label: "Reçu", color: "#3b82f6" },
  { key: "contacted", label: "Contacté", color: "#f59e0b" },
  { key: "rdv_planifie", label: "RDV planifié", color: "#8b5cf6" },
  { key: "mandat_signe", label: "Mandat signé", color: "#10b981" },
  { key: "vendu", label: "Vendu", color: "#059669" },
];

// Statuts terminaux affichés à part (perdu / non vendu)
const ARCHIVE_STATUSES: StatusDef[] = [
  { key: "non_vendu", label: "Non vendu", color: "#64748b" },
  { key: "lost", label: "Perdu", color: "#94a3b8" },
];

const fmt = (n: number | null | undefined) =>
  n != null && Number.isFinite(n)
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)
    : "—";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });

export default function AdminDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [slug, setSlug] = useState("");
  const [cabinet, setCabinet] = useState<Cabinet | null>(null);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const router = useRouter();

  const loadLeads = useCallback(
    async (slugValue: string) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/cabinets/${slugValue}/admin/leads?limit=500`, {
          cache: "no-store",
        });
        if (res.status === 401) {
          router.push(`/cabinets/${slugValue}/admin/login?error=invalid_or_expired`);
          return;
        }
        const data = (await res.json()) as {
          leads: Lead[];
          counts_by_status: Record<string, number>;
        };
        setLeads(data.leads ?? []);
        setCounts(data.counts_by_status ?? {});
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

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
      await loadLeads(s);
    })();
  }, [params, loadLeads]);

  async function changeStatus(leadId: string, newStatus: string) {
    try {
      const res = await fetch(`/api/cabinets/${slug}/admin/leads/${leadId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_status: newStatus }),
        credentials: "include",
      });
      if (res.ok) {
        await loadLeads(slug);
        return;
      }
      if (res.status === 401) {
        router.push(`/cabinets/${slug}/admin/login?error=invalid_or_expired`);
        return;
      }
      // Erreur quelconque : feedback visible
      const errJson = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
      console.error("[changeStatus] échec:", res.status, errJson);
      alert(
        `Erreur ${res.status} : ${errJson.error ?? "inconnue"}${
          errJson.details ? "\n" + errJson.details : ""
        }`,
      );
    } catch (e) {
      console.error("[changeStatus] exception:", e);
      alert("Erreur réseau : " + (e instanceof Error ? e.message : "inconnue"));
    }
  }

  function exportCsv() {
    if (leads.length === 0) return;
    const headers = [
      "id",
      "status",
      "created_at",
      "visitor_name",
      "visitor_email",
      "visitor_phone",
      "type_bien",
      "address",
      "surface",
      "prix_total_median",
      "prix_m2_median",
      "intent",
    ];
    const rows = leads.map((l) =>
      headers
        .map((h) => {
          const v = (l as unknown as Record<string, unknown>)[h];
          if (v == null) return "";
          const s = String(v).replace(/"/g, '""');
          return /[,;"\n]/.test(s) ? `"${s}"` : s;
        })
        .join(","),
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}-leads-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!cabinet) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        Chargement…
      </div>
    );
  }

  const primary = cabinet.primary_color;
  const displayStatuses = showArchived ? [...STATUSES, ...ARCHIVE_STATUSES] : STATUSES;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 16 }}>
      {/* Header */}
      <div
        style={{
          maxWidth: 1600,
          margin: "0 auto 20px",
          padding: "16px 20px",
          background: "white",
          borderRadius: 12,
          border: "1px solid #e2e8f0",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, color: primary, letterSpacing: "0.02em" }}>
            {cabinet.cabinet_name.toUpperCase()}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>
            Dashboard cabinet · {leads.length} leads
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <a
            href={`/cabinets/${slug}/admin/registre`}
            style={{
              background: "transparent",
              color: primary,
              border: `1.5px solid ${primary}`,
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            📜 Registre des mandats
          </a>
          <a
            href={`/cabinets/${slug}/admin/parrainage`}
            style={{
              background: "transparent",
              color: primary,
              border: `1.5px solid ${primary}`,
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
              textDecoration: "none",
              display: "inline-block",
            }}
          >
            ♻ Parrainage
          </a>
          <button
            onClick={() => setShowArchived((s) => !s)}
            style={{
              background: showArchived ? primary : "transparent",
              color: showArchived ? "white" : primary,
              border: `1.5px solid ${primary}`,
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {showArchived ? "Masquer archivés" : "Afficher archivés"}
          </button>
          <button
            onClick={exportCsv}
            disabled={leads.length === 0}
            style={{
              background: "transparent",
              color: primary,
              border: `1.5px solid ${primary}`,
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: leads.length === 0 ? "not-allowed" : "pointer",
              opacity: leads.length === 0 ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            Exporter CSV
          </button>
          <button
            onClick={() => loadLeads(slug)}
            style={{
              background: primary,
              color: "white",
              border: "none",
              borderRadius: 8,
              padding: "8px 14px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ↻ Actualiser
          </button>
        </div>
      </div>

      {/* Kanban */}
      <div
        style={{
          maxWidth: 1600,
          margin: "0 auto",
          display: "flex",
          gap: 12,
          overflowX: "auto",
          paddingBottom: 16,
        }}
      >
        {displayStatuses.map((s) => {
          const colLeads = leads.filter((l) => l.status === s.key);
          return (
            <div
              key={s.key}
              style={{
                flex: "1 1 230px",
                minWidth: 230,
                maxWidth: 320,
                background: "#f1f5f9",
                borderRadius: 12,
                padding: 12,
                borderTop: `4px solid ${s.color}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                  {s.label}
                </div>
                <div
                  style={{
                    background: s.color + "20",
                    color: s.color,
                    padding: "2px 8px",
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {counts[s.key] ?? 0}
                </div>
              </div>

              {colLeads.length === 0 ? (
                <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 11, padding: "20px 0" }}>
                  Aucun lead
                </div>
              ) : (
                colLeads.map((l) => (
                  <LeadCard
                    key={l.id}
                    lead={l}
                    cabinetSlug={slug}
                    primary={primary}
                    onChangeStatus={(newStatus) => changeStatus(l.id, newStatus)}
                  />
                ))
              )}
            </div>
          );
        })}

        {leads.length === 0 && !loading && (
          <div style={{ flex: 1, textAlign: "center", padding: 40, color: "#64748b" }}>
            Aucun lead pour l&apos;instant. Les leads captés via votre page
            d&apos;estimation apparaîtront ici automatiquement.
          </div>
        )}
      </div>

      <div
        style={{
          maxWidth: 1600,
          margin: "20px auto 0",
          textAlign: "center",
          fontSize: 11,
          color: "#94a3b8",
        }}
      >
        Propulsé par <strong>DATAMERRY®</strong> · Mise à jour automatique à chaque nouveau lead
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LeadCard
// ─────────────────────────────────────────────────────────────────────────────

function LeadCard({
  lead,
  cabinetSlug,
  primary,
  onChangeStatus,
}: {
  lead: Lead;
  cabinetSlug: string;
  primary: string;
  onChangeStatus: (newStatus: string) => void;
}) {
  const allStatuses = [...STATUSES.map((s) => s.key), ...ARCHIVE_STATUSES.map((s) => s.key)];
  const idx = allStatuses.indexOf(lead.status);
  const prev = idx > 0 ? allStatuses[idx - 1] : null;
  const next = idx >= 0 && idx < STATUSES.length - 1 ? allStatuses[idx + 1] : null;

  return (
    <div
      style={{
        background: "white",
        borderRadius: 10,
        padding: 12,
        marginBottom: 8,
        border: "1px solid #e2e8f0",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
        {lead.visitor_name}
      </div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
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
      <div style={{ fontSize: 11, color: "#475569", marginTop: 6 }}>
        <strong>{lead.type_bien}</strong>
        {lead.surface ? ` · ${lead.surface} m²` : ""}
      </div>
      <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
        {lead.address}
      </div>
      {lead.prix_total_median != null && (
        <div
          style={{
            marginTop: 6,
            padding: "4px 8px",
            background: primary + "12",
            borderRadius: 6,
            fontSize: 11,
            color: primary,
            fontWeight: 700,
            display: "inline-block",
          }}
        >
          Estim. DATAMERRY : {fmt(lead.prix_total_median)} €
        </div>
      )}
      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 6 }}>
        Reçu le {fmtDate(lead.created_at)}
        {lead.intent ? ` · ${lead.intent}` : ""}
      </div>

      <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
        {prev && (
          <button
            onClick={() => onChangeStatus(prev)}
            title="Étape précédente"
            style={{
              flex: 1,
              background: "transparent",
              color: "#64748b",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              padding: "5px 8px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ←
          </button>
        )}
        <a
          href={`/cabinets/${cabinetSlug}/admin/lead/${lead.id}`}
          style={{
            flex: 1,
            background: "transparent",
            color: primary,
            border: `1px solid ${primary}`,
            borderRadius: 6,
            padding: "5px 8px",
            fontSize: 11,
            textAlign: "center",
            textDecoration: "none",
            fontFamily: "inherit",
          }}
        >
          Détail
        </a>
        {next && (
          <button
            onClick={() => onChangeStatus(next)}
            title="Étape suivante"
            style={{
              flex: 1,
              background: primary,
              color: "white",
              border: "none",
              borderRadius: 6,
              padding: "5px 8px",
              fontSize: 11,
              cursor: "pointer",
              fontFamily: "inherit",
              fontWeight: 600,
            }}
          >
            →
          </button>
        )}
      </div>
    </div>
  );
}
