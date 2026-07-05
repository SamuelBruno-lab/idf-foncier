"use client";

import { useCallback, useEffect, useState } from "react";
import FoncierResultsList, {
  type ParcelListItem,
} from "@/components/foncier/FoncierResultsList";
import ParcelDetailsPanel from "@/components/foncier/ParcelDetailsPanel";
import type { ParcelDetail } from "@/lib/foncier-types";

/**
 * Client de la page sous-densite fonciere. Filtres propres a cette page
 * (insee, persona/destination, DPE passoire, seuil residuel) -- pas de
 * reutilisation de FoncierFilters.tsx (champs trop differents : ce
 * composant partage n'est pas modifie, pour ne rien casser de son usage
 * existant ailleurs dans l'app).
 *
 * V1 : liste de resultats (FoncierResultsList), pas de carte a tuiles MVT --
 * un usage cabinet (quelques centaines de parcelles par recherche filtree)
 * n'a pas besoin du rendu tuile pense pour la carte nationale publique.
 */

const PERSONAS = [
  { value: "", label: "Toutes destinations" },
  { value: "logement", label: "Logement" },
  { value: "commerce", label: "Commerce" },
  { value: "hotellerie", label: "Hotellerie" },
  { value: "bureau", label: "Bureau" },
  { value: "logistique", label: "Logistique" },
  { value: "industrie", label: "Industrie" },
  { value: "sante", label: "Sante" },
];

const DPE_OPTIONS = [
  { value: "", label: "Indifferent" },
  { value: "any", label: "Passoire (maison ou copro)" },
  { value: "copro", label: "Passoire copropriete" },
  { value: "maison", label: "Passoire maison individuelle" },
];

type SousDensiteItem = ParcelListItem & {
  ces_source?: "reel" | "generique" | null;
  dpe_passoire_any?: boolean;
  dpe_passoire_copro?: boolean;
  dpe_passoire_maison?: boolean;
  plu_reel_a_verifier?: boolean | null;
};

export default function FoncierSousDensiteClient({ slug }: { slug: string }) {
  const [insee, setInsee] = useState("");
  const [persona, setPersona] = useState("");
  const [dpeFilter, setDpeFilter] = useState("");
  const [minResidual, setMinResidual] = useState(0);
  const [items, setItems] = useState<SousDensiteItem[]>([]);
  const [selectedParcelId, setSelectedParcelId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<ParcelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Charge le detail complet (Phase 2c : ancrage du simulateur de
  // prefaisabilite) via la route publique deja existante, reutilisee telle
  // quelle -- pas de nouvelle route pour le detail de base.
  useEffect(() => {
    if (!selectedParcelId) {
      setSelectedDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetch(`/api/foncier/parcelle/${selectedParcelId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled) setSelectedDetail(data);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      })
      .catch(() => {
        if (!cancelled) setSelectedDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedParcelId]);

  const search = useCallback(async () => {
    if (!/^\d{5}$/.test(insee)) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ insee, min_residual: String(minResidual) });
      if (persona) params.set("persona", persona);
      if (dpeFilter) params.set("dpe", dpeFilter);

      const res = await fetch(`/api/cabinets/${slug}/foncier/sous-densite?${params}`);
      if (res.status === 403) {
        setError("Abonnement requis pour acceder a ces donnees.");
        setItems([]);
        return;
      }
      if (res.status === 401) {
        window.location.href = `/cabinets/${slug}/admin/login`;
        return;
      }
      const data = (await res.json()) as { items?: SousDensiteItem[]; error?: string };
      if (!res.ok) {
        setError(data.error ?? `Erreur ${res.status}`);
        setItems([]);
        return;
      }
      setItems(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [slug, insee, persona, dpeFilter, minResidual]);

  useEffect(() => {
    if (/^\d{5}$/.test(insee)) search();
  }, [search, insee]);

  return (
    <section style={{ padding: "24px", display: "flex", gap: 24, maxWidth: 1600, margin: "0 auto" }}>
      <aside style={{ width: 260, flexShrink: 0 }}>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#475569" }}>
            Code INSEE
          </label>
          <input
            type="text"
            value={insee}
            onChange={(e) => setInsee(e.target.value.trim())}
            placeholder="94081"
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }}
          />
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#475569" }}>
            Destination
          </label>
          <select
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }}
          >
            {PERSONAS.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#475569" }}>
            DPE
          </label>
          <select
            value={dpeFilter}
            onChange={(e) => setDpeFilter(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }}
          >
            {DPE_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "block", fontSize: 12, fontWeight: 600, marginBottom: 4, color: "#475569" }}>
            Potentiel residuel min (m²)
          </label>
          <input
            type="number"
            min={0}
            value={minResidual}
            onChange={(e) => setMinResidual(Number(e.target.value) || 0)}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13 }}
          />
        </div>

        {error && (
          <div style={{ fontSize: 12, color: "#991b1b", background: "#fee2e2", padding: "8px 10px", borderRadius: 8 }}>
            {error}
          </div>
        )}
      </aside>

      <div style={{ flex: 1, background: "white", border: "1px solid #e2e8f0", borderRadius: 8, minWidth: 280 }}>
        <FoncierResultsList
          items={items}
          loading={loading}
          selectedParcelId={selectedParcelId}
          onSelectParcel={setSelectedParcelId}
        />
      </div>

      {selectedParcelId && (
        <div
          style={{
            flex: 1,
            background: "white",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            minWidth: 320,
            maxWidth: 420,
          }}
        >
          <ParcelDetailsPanel
            item={selectedDetail}
            loading={detailLoading}
            showSimulateur
          />
        </div>
      )}
    </section>
  );
}
