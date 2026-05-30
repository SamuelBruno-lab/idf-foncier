"use client";

/**
 * Registre des mandats — Vue dense de tous les mandats signés du cabinet
 * avec leur status d'ancrage blockchain.
 *
 * URL : /cabinets/{slug}/admin/registre
 *
 * Conforme à l'obligation Hoguet de tenue du registre carte T : chaque
 * mandat a son numéro séquentiel (AAAANNNN), sa date de signature, son
 * type, sa durée, sa commission. La colonne "Blockchain" indique le status
 * d'ancrage Merkle Root → Solana (Y2).
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Mandate = {
  id: string;
  cabinet_slug: string;
  cabinet_name: string;
  mandat_numero_registre: string | null;
  mandat_type: "vente" | "recherche" | "location" | null;
  mandat_modalite: "simple" | "exclusif" | "semi_exclusif" | null;
  mandat_signe_at: string | null;
  mandat_duree_mois: number | null;
  mandat_date_fin: string | null;
  mandat_commission_pct: number | null;
  mandat_prix_net_vendeur: number | null;
  mandat_prix_max: number | null;
  visitor_name: string;
  address: string;
  type_bien: string;
  surface: number | null;
  estimation_datamerry: number | null;
  status: string;
  vente_prix_final: number | null;
  vente_date: string | null;
  anchor_status: string | null;
  mandate_hash_sha256: string | null;
  solana_tx_sig: string | null;
  anchored_at: string | null;
};

type Counters = {
  total: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
};

const TYPE_LABELS: Record<string, string> = {
  vente: "Vente",
  recherche: "Recherche",
  location: "Location",
};

const MODALITE_LABELS: Record<string, string> = {
  simple: "Simple",
  exclusif: "Exclusif",
  semi_exclusif: "Semi-excl.",
};

const STATUS_LABELS: Record<string, string> = {
  mandat_signe: "Mandat signé",
  vendu: "Vendu",
  non_vendu: "Non vendu",
};

const STATUS_COLORS: Record<string, string> = {
  mandat_signe: "#10b981",
  vendu: "#059669",
  non_vendu: "#94a3b8",
};

const ANCHOR_LABELS: Record<string, string> = {
  not_anchored: "Non ancré",
  pending: "En file",
  batched: "Batché",
  anchored: "On-chain",
  failed: "Échec",
  opted_out: "Exclu",
};

const ANCHOR_COLORS: Record<string, string> = {
  not_anchored: "#94a3b8",
  pending: "#f59e0b",
  batched: "#8b5cf6",
  anchored: "#10b981",
  failed: "#ef4444",
  opted_out: "#cbd5e1",
};

const fmt = (n: number | null | undefined) =>
  n != null && Number.isFinite(n)
    ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)
    : "—";

const fmtDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" })
    : "—";

export default function RegistrePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [slug, setSlug] = useState("");
  const [mandates, setMandates] = useState<Mandate[]>([]);
  const [counters, setCounters] = useState<Counters | null>(null);
  const [cabinet, setCabinet] = useState<{ cabinet_name: string; primary_color: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const load = useCallback(
    async (s: string, sFilter: string, tFilter: string) => {
      setLoading(true);
      const params = new URLSearchParams({ status: sFilter, type: tFilter });
      const [regRes, cabRes] = await Promise.all([
        fetch(`/api/cabinets/${s}/admin/registre?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/cabinets/${s}`, { cache: "no-store" }),
      ]);
      if (regRes.status === 401) {
        router.push(`/cabinets/${s}/admin/login?error=invalid_or_expired`);
        return;
      }
      if (regRes.ok) {
        const data = (await regRes.json()) as { mandates: Mandate[]; counters: Counters };
        setMandates(data.mandates);
        setCounters(data.counters);
      }
      if (cabRes.ok) setCabinet(await cabRes.json());
      setLoading(false);
    },
    [router],
  );

  useEffect(() => {
    (async () => {
      const { slug: s } = await params;
      setSlug(s);
      await load(s, statusFilter, typeFilter);
    })();
  }, [params, load, statusFilter, typeFilter]);

  if (!cabinet) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        Chargement…
      </div>
    );
  }

  const primary = cabinet.primary_color;

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 16 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto" }}>
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
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>
              Registre des mandats
            </div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
              {cabinet.cabinet_name} · Carte T · Loi Hoguet n° 70-9
            </div>
          </div>
          {counters && (
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <Stat label="Total" value={`${counters.total}`} highlight={primary} />
              <Stat label="Vente" value={`${counters.by_type.vente ?? 0}`} />
              <Stat label="Recherche" value={`${counters.by_type.recherche ?? 0}`} />
              <Stat label="On-chain" value={`${counters.by_status.anchored ?? 0}`} highlight="#10b981" />
            </div>
          )}
        </div>

        {/* Filtres */}
        <div
          style={{
            marginTop: 16,
            padding: 14,
            background: "white",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <FilterLabel>Type :</FilterLabel>
          <FilterChip
            active={typeFilter === "all"}
            color={primary}
            onClick={() => setTypeFilter("all")}
          >
            Tous
          </FilterChip>
          {(["vente", "recherche", "location"] as const).map((t) => (
            <FilterChip
              key={t}
              active={typeFilter === t}
              color={primary}
              onClick={() => setTypeFilter(t)}
            >
              {TYPE_LABELS[t]} ({counters?.by_type[t] ?? 0})
            </FilterChip>
          ))}
          <div style={{ width: 1, height: 24, background: "#e2e8f0", margin: "0 4px" }} />
          <FilterLabel>Blockchain :</FilterLabel>
          <FilterChip
            active={statusFilter === "all"}
            color={primary}
            onClick={() => setStatusFilter("all")}
          >
            Tous
          </FilterChip>
          {(["not_anchored", "pending", "anchored", "failed"] as const).map((s) => (
            <FilterChip
              key={s}
              active={statusFilter === s}
              color={ANCHOR_COLORS[s]}
              onClick={() => setStatusFilter(s)}
            >
              {ANCHOR_LABELS[s]} ({counters?.by_status[s] ?? 0})
            </FilterChip>
          ))}
        </div>

        {/* Tableau */}
        <div
          style={{
            marginTop: 16,
            background: "white",
            borderRadius: 12,
            border: "1px solid #e2e8f0",
            overflow: "hidden",
          }}
        >
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>Chargement…</div>
          ) : mandates.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "#94a3b8" }}>
              Aucun mandat ne correspond aux filtres.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    <Th>N° registre</Th>
                    <Th>Type</Th>
                    <Th>Signé le</Th>
                    <Th>Fin</Th>
                    <Th>Bien</Th>
                    <Th>Client</Th>
                    <Th right>Prix</Th>
                    <Th right>Com %</Th>
                    <Th center>Statut</Th>
                    <Th center>Blockchain</Th>
                    <Th>Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {mandates.map((m) => {
                    const anchorKey = m.anchor_status ?? "not_anchored";
                    const prix = m.vente_prix_final ?? m.mandat_prix_net_vendeur ?? m.mandat_prix_max;
                    return (
                      <tr
                        key={m.id}
                        style={{ borderBottom: "1px solid #f1f5f9" }}
                      >
                        <Td>
                          <code style={{ fontSize: 11, fontFamily: "monospace", fontWeight: 700 }}>
                            {m.mandat_numero_registre ?? "—"}
                          </code>
                        </Td>
                        <Td>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>
                            {m.mandat_type ? TYPE_LABELS[m.mandat_type] : "—"}
                          </div>
                          {m.mandat_modalite && (
                            <div style={{ fontSize: 10, color: "#94a3b8" }}>
                              {MODALITE_LABELS[m.mandat_modalite]}
                            </div>
                          )}
                        </Td>
                        <Td>{fmtDate(m.mandat_signe_at)}</Td>
                        <Td>{fmtDate(m.mandat_date_fin)}</Td>
                        <Td>
                          <div style={{ fontSize: 12 }}>{m.address}</div>
                          <div style={{ fontSize: 10, color: "#94a3b8" }}>
                            {m.type_bien}
                            {m.surface ? ` · ${m.surface} m²` : ""}
                          </div>
                        </Td>
                        <Td>{m.visitor_name}</Td>
                        <Td right>
                          {prix != null ? `${fmt(prix)} €` : "—"}
                          {m.vente_prix_final != null && (
                            <div style={{ fontSize: 10, color: "#15803d", fontWeight: 600 }}>
                              vendu
                            </div>
                          )}
                        </Td>
                        <Td right>{m.mandat_commission_pct != null ? `${m.mandat_commission_pct} %` : "—"}</Td>
                        <Td center>
                          <Badge color={STATUS_COLORS[m.status] ?? "#94a3b8"}>
                            {STATUS_LABELS[m.status] ?? m.status}
                          </Badge>
                        </Td>
                        <Td center>
                          <Badge color={ANCHOR_COLORS[anchorKey]}>
                            {ANCHOR_LABELS[anchorKey]}
                          </Badge>
                          {m.solana_tx_sig && (
                            <div style={{ marginTop: 2 }}>
                              <a
                                href={`https://explorer.solana.com/tx/${m.solana_tx_sig}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: primary, fontSize: 9, textDecoration: "none", fontFamily: "monospace" }}
                              >
                                {m.solana_tx_sig.slice(0, 8)}…
                              </a>
                            </div>
                          )}
                        </Td>
                        <Td>
                          <a
                            href={`/cabinets/${slug}/admin/lead/${m.id}`}
                            style={{
                              color: primary,
                              textDecoration: "none",
                              fontSize: 12,
                              fontWeight: 700,
                            }}
                          >
                            Détail →
                          </a>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ marginTop: 14, fontSize: 11, color: "#94a3b8", textAlign: "center", lineHeight: 1.5 }}>
          Registre tenu selon la <strong>loi Hoguet n° 70-9</strong> et son <strong>décret 72-678</strong>.
          {" "}Ancrage blockchain conforme <strong>CNIL délibération 2018-303</strong> : seules les
          empreintes cryptographiques SHA256 sont publiées on-chain — aucune donnée personnelle.
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// UI primitives
// ══════════════════════════════════════════════════════════════════════════

function Th({
  children,
  center,
  right,
}: {
  children: React.ReactNode;
  center?: boolean;
  right?: boolean;
}) {
  return (
    <th
      style={{
        padding: "10px 12px",
        textAlign: right ? "right" : center ? "center" : "left",
        fontSize: 10,
        color: "#64748b",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  center,
  right,
}: {
  children: React.ReactNode;
  center?: boolean;
  right?: boolean;
}) {
  return (
    <td
      style={{
        padding: "10px 12px",
        textAlign: right ? "right" : center ? "center" : "left",
        verticalAlign: "top",
        fontSize: 12,
        color: "#0f172a",
      }}
    >
      {children}
    </td>
  );
}

function Badge({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 9px",
        background: color + "22",
        color,
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 11, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>
      {children}
    </span>
  );
}

function FilterChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 12px",
        background: active ? color : "white",
        color: active ? "white" : color,
        border: `1.5px solid ${color}`,
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: string }) {
  return (
    <div style={{ minWidth: 70 }}>
      <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 800,
          color: highlight ?? "#0f172a",
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}
