"use client";

/**
 * Page Estimer brandée cabinet (white-label).
 *
 * URL : /cabinets/{slug}/estimer
 *
 * Le visiteur saisit son adresse + surface, voit l'estimation, et est dirigé
 * vers le CTA de contact du cabinet pour entrer en relation. Lead acquisition
 * complète sans que le cabinet ait à intégrer du code sur son site.
 */

import { useEffect, useState } from "react";

type Cabinet = {
  cabinet_name: string;
  primary_color: string;
  cta_contact_url: string;
  cta_contact_label: string;
};

type EstimateResult = {
  available: boolean;
  address?: string;
  prix_m2_median?: number;
  prix_total_median?: number;
  prix_m2_p10?: number;
  prix_m2_p90?: number;
  nb_ventes?: number;
} | null;

async function fetchCabinet(slug: string): Promise<Cabinet | null> {
  try {
    const res = await fetch(`/api/cabinets/${slug}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as Cabinet;
  } catch {
    return null;
  }
}

async function fetchEstimate(
  slug: string,
  address: string,
  surface: number,
  type_local: string,
): Promise<EstimateResult> {
  try {
    const params = new URLSearchParams({
      address,
      surface: String(surface),
      type_local,
    });
    const res = await fetch(`/api/cabinets/${slug}/estimate?${params}`, {
      cache: "no-store",
    });
    if (!res.ok) return { available: false };
    return (await res.json()) as EstimateResult;
  } catch {
    return { available: false };
  }
}

function fmt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n);
}

export default function EstimerPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [slug, setSlug] = useState<string>("");
  const [cabinet, setCabinet] = useState<Cabinet | null>(null);
  const [address, setAddress] = useState("");
  const [surface, setSurface] = useState<string>("62");
  const [type, setType] = useState("Appartement");
  const [result, setResult] = useState<EstimateResult>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"form" | "loading" | "result">("form");

  useEffect(() => {
    (async () => {
      const { slug: s } = await params;
      setSlug(s);
      const cab = await fetchCabinet(s);
      setCabinet(cab);
    })();
  }, [params]);

  const primary = cabinet?.primary_color ?? "#1f3a8a";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!address.trim() || address.trim().length < 5) return;
    setLoading(true);
    setStep("loading");
    const r = await fetchEstimate(
      slug,
      address.trim(),
      Number(surface) || 62,
      type,
    );
    setResult(r);
    setStep("result");
    setLoading(false);
  }

  if (!cabinet) {
    return (
      <div style={{ padding: 40, textAlign: "center", color: "#64748b" }}>
        Chargement…
      </div>
    );
  }

  const cabinetName = cabinet.cabinet_name;
  const ctaUrl = cabinet.cta_contact_url;
  const ctaLabel = cabinet.cta_contact_label;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <section
        style={{
          background: `linear-gradient(135deg, ${primary}10 0%, ${primary}25 100%)`,
          borderRadius: 16,
          padding: "40px 24px",
          textAlign: "center",
          border: `1px solid ${primary}40`,
        }}
      >
        <h1 style={{ fontSize: 30, color: primary, marginBottom: 8 }}>
          Combien vaut votre bien ?
        </h1>
        <p style={{ color: "#475569", fontSize: 15, maxWidth: 600, margin: "0 auto" }}>
          Estimation gratuite et instantanée — {cabinetName} vous propose un premier
          avis basé sur les ventes notariées DVF et les données officielles.
        </p>
      </section>

      <div
        style={{
          background: "white",
          borderRadius: 16,
          border: "1px solid #e2e8f0",
          padding: 32,
          maxWidth: 640,
          margin: "0 auto",
          width: "100%",
        }}
      >
        {step === "form" && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 20, textAlign: "center", marginBottom: 4 }}>
              Renseignez votre bien
            </h2>
            <p style={{ textAlign: "center", color: "#64748b", fontSize: 13, marginBottom: 12 }}>
              Résultat en 3 secondes · 100% gratuit · Sans inscription
            </p>

            <div>
              <label style={labelStyle}>Adresse complète</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="ex: 10 rue de la Paix 75002 Paris"
                style={inputStyle(primary)}
                required
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <label style={labelStyle}>Surface (m²)</label>
                <input
                  type="number"
                  min={8}
                  max={500}
                  value={surface}
                  onChange={(e) => setSurface(e.target.value)}
                  style={inputStyle(primary)}
                  required
                />
              </div>
              <div>
                <label style={labelStyle}>Type</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  style={inputStyle(primary)}
                >
                  <option>Appartement</option>
                  <option>Maison</option>
                </select>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !address.trim()}
              style={{
                background: primary,
                color: "white",
                border: "none",
                borderRadius: 10,
                padding: "14px 24px",
                fontSize: 15,
                fontWeight: 700,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading || !address.trim() ? 0.6 : 1,
                marginTop: 8,
                fontFamily: "inherit",
              }}
            >
              {loading ? "Analyse en cours…" : "Estimer mon bien"}
            </button>
          </form>
        )}

        {step === "loading" && (
          <div style={{ padding: 40, textAlign: "center" }}>
            <div
              style={{
                width: 48,
                height: 48,
                border: `3px solid ${primary}30`,
                borderTopColor: primary,
                borderRadius: "50%",
                margin: "0 auto 16px",
                animation: "spin 1s linear infinite",
              }}
            />
            <p style={{ color: "#475569" }}>Analyse de votre bien en cours…</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {step === "result" && result && (
          <div>
            <h2 style={{ fontSize: 18, marginBottom: 4 }}>{result.address ?? address}</h2>
            <p style={{ color: "#64748b", fontSize: 13, marginBottom: 20 }}>
              {surface} m² · {type}
            </p>

            {result.available && result.prix_m2_median ? (
              <>
                <div
                  style={{
                    background: `linear-gradient(135deg, ${primary}10, ${primary}25)`,
                    borderRadius: 12,
                    padding: 28,
                    textAlign: "center",
                    border: `1px solid ${primary}40`,
                    marginBottom: 16,
                  }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: primary,
                      fontWeight: 700,
                      marginBottom: 8,
                    }}
                  >
                    Estimation marché
                  </div>
                  <div style={{ fontSize: 38, fontWeight: 800, color: primary }}>
                    {fmt(result.prix_total_median)} €
                  </div>
                  <div style={{ fontSize: 13, color: "#475569", marginTop: 6 }}>
                    {fmt(result.prix_m2_median)} €/m²
                    {result.nb_ventes ? ` · ${result.nb_ventes} ventes DVF dans la zone` : ""}
                  </div>
                  {result.prix_m2_p10 && result.prix_m2_p90 && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-around",
                        marginTop: 16,
                        paddingTop: 12,
                        borderTop: "1px solid rgba(0,0,0,0.05)",
                      }}
                    >
                      <SmallStat
                        label="Plancher"
                        value={`${fmt(Math.round(result.prix_m2_p10 * Number(surface || 62)))} €`}
                      />
                      <SmallStat
                        label="Médiane"
                        value={`${fmt(result.prix_total_median)} €`}
                      />
                      <SmallStat
                        label="Plafond"
                        value={`${fmt(Math.round(result.prix_m2_p90 * Number(surface || 62)))} €`}
                      />
                    </div>
                  )}
                </div>

                <div
                  style={{
                    background: primary,
                    color: "white",
                    padding: 24,
                    borderRadius: 12,
                    textAlign: "center",
                  }}
                >
                  <h3 style={{ fontSize: 18, marginBottom: 6 }}>
                    📞 Affinez votre estimation avec {cabinetName}
                  </h3>
                  <p style={{ fontSize: 13, opacity: 0.9, marginBottom: 16 }}>
                    Une estimation précise prend en compte l'état, l'étage, l'expo, la vue. Nos agents viennent gratuitement chez vous pour un avis d'expert humain.
                  </p>
                  <a
                    href={ctaUrl}
                    style={{
                      display: "inline-block",
                      background: "white",
                      color: primary,
                      padding: "12px 24px",
                      borderRadius: 10,
                      fontWeight: 700,
                      fontSize: 14,
                      textDecoration: "none",
                    }}
                  >
                    {ctaLabel}
                  </a>
                </div>
              </>
            ) : (
              <div
                style={{
                  background: "#fef2f2",
                  color: "#991b1b",
                  padding: 20,
                  borderRadius: 10,
                  textAlign: "center",
                  marginBottom: 16,
                }}
              >
                Nous n'avons pas pu estimer ce bien automatiquement. Contactez directement {cabinetName} pour une analyse personnalisée.
                <br />
                <a
                  href={ctaUrl}
                  style={{
                    display: "inline-block",
                    background: primary,
                    color: "white",
                    padding: "10px 20px",
                    borderRadius: 8,
                    fontWeight: 700,
                    fontSize: 13,
                    textDecoration: "none",
                    marginTop: 16,
                  }}
                >
                  {ctaLabel}
                </a>
              </div>
            )}

            <a
              onClick={(e) => {
                e.preventDefault();
                setStep("form");
                setResult(null);
              }}
              href="#"
              style={{
                display: "block",
                textAlign: "center",
                marginTop: 16,
                color: "#64748b",
                fontSize: 12,
                textDecoration: "underline",
                cursor: "pointer",
              }}
            >
              ← Nouvelle estimation
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#64748b",
  marginBottom: 6,
};

function inputStyle(primary: string): React.CSSProperties {
  return {
    width: "100%",
    padding: "12px 14px",
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    background: "white",
    color: "#0f172a",
  };
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: "uppercase", color: "#64748b", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>{value}</div>
    </div>
  );
}
