/**
 * Page Virtual Home Staging — outil public DATAMERRY.
 *
 * URL : /outils/staging
 *
 * UX :
 *   1. L'utilisateur upload une photo de pièce vide (JPG/PNG, max 20 MB)
 *   2. Il choisit le type de pièce et le style de décoration
 *   3. Bouton "Stager" → POST /api/staging
 *   4. ~15-30 sec d'attente
 *   5. Affichage avant/après avec slider, lien de téléchargement
 */

"use client";

import { useState, useRef } from "react";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

const ROOMS = [
  { key: "salon", label: "Salon", icon: "🛋️" },
  { key: "chambre", label: "Chambre", icon: "🛏️" },
  { key: "cuisine", label: "Cuisine", icon: "🍳" },
  { key: "sdb", label: "Salle de bain", icon: "🛁" },
  { key: "bureau", label: "Bureau", icon: "💻" },
];

const STYLES = [
  { key: "moderne", label: "Moderne", desc: "Lignes épurées, neutres" },
  { key: "scandinave", label: "Scandinave", desc: "Bois clair, hygge" },
  { key: "luxe", label: "Luxe", desc: "Marbre, or, velours" },
  { key: "industriel", label: "Industriel", desc: "Brique, métal, Edison" },
];

export default function StagingPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [roomType, setRoomType] = useState("salon");
  const [style, setStyle] = useState("moderne");
  const [customPrompt, setCustomPrompt] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    original_url: string;
    result_url: string;
    job_id: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sliderPos, setSliderPos] = useState(50);

  function handleFile(f: File | null) {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) {
      setError("Photo trop lourde (max 20 Mo). Compresse-la avant.");
      return;
    }
    setError(null);
    setResult(null);
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
  }

  async function handleSubmit() {
    if (!file) {
      setError("Choisis d'abord une photo de pièce vide.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append("image", file);
    form.append("room_type", roomType);
    form.append("style", style);
    if (customPrompt.trim()) form.append("custom_prompt", customPrompt.trim());

    try {
      const res = await fetch("/api/staging", { method: "POST", body: form });
      const data = (await res.json()) as
        | { ok: true; original_url: string; result_url: string; job_id: string }
        | { ok: false; error: string; detail?: string };
      if (!data.ok) {
        setError(`Échec du staging : ${data.detail ?? data.error}`);
      } else {
        setResult({
          original_url: data.original_url,
          result_url: data.result_url,
          job_id: data.job_id,
        });
      }
    } catch (err) {
      setError("Erreur réseau : " + (err instanceof Error ? err.message : "inconnue"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ background: "#fafafa", minHeight: "100vh", color: DARK }}>
      {/* ─── Header ─────────────────────────────────────────────────── */}
      <header
        style={{
          background: DARK,
          padding: "20px 24px",
          borderBottom: `1px solid ${PRIMARY}40`,
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ color: PRIMARY, fontSize: 11, letterSpacing: "0.1em", fontWeight: 700 }}>
            DATAMERRY · OUTILS PRO
          </div>
          <h1
            style={{
              color: "white",
              fontFamily: "Georgia, serif",
              fontSize: 26,
              fontWeight: 700,
              margin: "4px 0 0",
            }}
          >
            Virtual Home Staging IA
          </h1>
          <p style={{ color: "#cbd5e1", fontSize: 13, margin: "4px 0 0" }}>
            Transforme une photo de pièce vide en intérieur meublé professionnel en quelques secondes.
          </p>
        </div>
      </header>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "30px 24px" }}>
        {/* ─── 1. Upload ──────────────────────────────────────────────── */}
        <section
          style={{
            background: "white",
            borderRadius: 8,
            padding: 24,
            marginBottom: 20,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <h2 style={{ margin: "0 0 12px", fontSize: 16, fontFamily: "Georgia, serif" }}>
            1. Photo de pièce vide
          </h2>

          <input
            type="file"
            ref={fileRef}
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            style={{ display: "none" }}
          />

          {preview ? (
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
              <img
                src={preview}
                alt="Preview"
                style={{
                  maxWidth: 300,
                  maxHeight: 220,
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                }}
              />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, color: "#64748b", marginBottom: 12 }}>
                  ✓ Image chargée ({Math.round((file?.size ?? 0) / 1024)} ko)
                </p>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  style={secondaryBtn}
                >
                  Changer la photo
                </button>
              </div>
            </div>
          ) : (
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFile(e.dataTransfer.files?.[0] ?? null);
              }}
              style={{
                border: `2px dashed ${PRIMARY}`,
                borderRadius: 8,
                padding: 40,
                textAlign: "center",
                cursor: "pointer",
                background: "#fafafa",
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 8 }}>📸</div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                Clique ou glisse-dépose une photo
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                JPG, PNG ou WEBP · max 20 Mo
              </div>
            </div>
          )}
        </section>

        {/* ─── 2. Type de pièce ─────────────────────────────────────── */}
        <section
          style={{
            background: "white",
            borderRadius: 8,
            padding: 24,
            marginBottom: 20,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <h2 style={{ margin: "0 0 12px", fontSize: 16, fontFamily: "Georgia, serif" }}>
            2. Type de pièce
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 10,
            }}
          >
            {ROOMS.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setRoomType(r.key)}
                style={{
                  padding: "14px 10px",
                  background: roomType === r.key ? PRIMARY : "white",
                  color: roomType === r.key ? DARK : "#475569",
                  border: roomType === r.key ? `2px solid ${PRIMARY}` : "1px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 4 }}>{r.icon}</div>
                {r.label}
              </button>
            ))}
          </div>
        </section>

        {/* ─── 3. Style ───────────────────────────────────────────────── */}
        <section
          style={{
            background: "white",
            borderRadius: 8,
            padding: 24,
            marginBottom: 20,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <h2 style={{ margin: "0 0 12px", fontSize: 16, fontFamily: "Georgia, serif" }}>
            3. Style de décoration
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 10,
            }}
          >
            {STYLES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStyle(s.key)}
                style={{
                  padding: 14,
                  background: style === s.key ? PRIMARY : "white",
                  color: style === s.key ? DARK : "#475569",
                  border: style === s.key ? `2px solid ${PRIMARY}` : "1px solid #e2e8f0",
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 11, opacity: 0.8 }}>{s.desc}</div>
              </button>
            ))}
          </div>

          <div style={{ marginTop: 16 }}>
            <label style={{ fontSize: 12, color: "#64748b", fontWeight: 600 }}>
              Précisions facultatives (optionnel — en anglais idéalement)
            </label>
            <input
              type="text"
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              placeholder="ex: with fireplace, large windows, parisian haussmannian"
              style={{
                width: "100%",
                padding: 10,
                marginTop: 6,
                border: "1px solid #cbd5e1",
                borderRadius: 4,
                fontSize: 13,
                boxSizing: "border-box",
              }}
            />
          </div>
        </section>

        {/* ─── 4. Action ──────────────────────────────────────────────── */}
        <div style={{ textAlign: "center", marginBottom: 30 }}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !file}
            style={{
              background: loading || !file ? "#cbd5e1" : DARK,
              color: "white",
              border: "none",
              padding: "14px 40px",
              borderRadius: 6,
              fontSize: 15,
              fontWeight: 700,
              cursor: loading || !file ? "not-allowed" : "pointer",
              minWidth: 280,
            }}
          >
            {loading ? "Génération en cours… (~20-40 sec)" : "✨ Stager mon bien"}
          </button>
          {error && (
            <div
              style={{
                marginTop: 12,
                padding: 10,
                background: "#fef2f2",
                color: "#991b1b",
                borderRadius: 4,
                fontSize: 13,
              }}
            >
              ⚠️ {error}
            </div>
          )}
        </div>

        {/* ─── 5. Résultat avec slider avant/après ──────────────────── */}
        {result && (
          <section
            style={{
              background: "white",
              borderRadius: 8,
              padding: 24,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <h2 style={{ margin: "0 0 12px", fontFamily: "Georgia, serif", fontSize: 18 }}>
              ✓ Voici votre bien stagé
            </h2>
            <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 16px" }}>
              Glisse le curseur pour comparer avant / après.
            </p>

            <div
              style={{
                position: "relative",
                width: "100%",
                maxWidth: 900,
                margin: "0 auto",
                overflow: "hidden",
                borderRadius: 6,
                aspectRatio: "16/9",
                background: "#000",
              }}
            >
              <img
                src={result.result_url}
                alt="Après staging"
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
                }}
              >
                <img
                  src={result.original_url}
                  alt="Avant staging"
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "contain",
                  }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={sliderPos}
                onChange={(e) => setSliderPos(Number(e.target.value))}
                style={{
                  position: "absolute",
                  bottom: 16,
                  left: "10%",
                  width: "80%",
                  zIndex: 5,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 12,
                  left: 12,
                  background: "rgba(0,0,0,0.7)",
                  color: "white",
                  padding: "4px 10px",
                  borderRadius: 3,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                AVANT
              </div>
              <div
                style={{
                  position: "absolute",
                  top: 12,
                  right: 12,
                  background: PRIMARY,
                  color: DARK,
                  padding: "4px 10px",
                  borderRadius: 3,
                  fontSize: 11,
                  fontWeight: 700,
                }}
              >
                APRÈS
              </div>
            </div>

            <div style={{ textAlign: "center", marginTop: 20 }}>
              <a
                href={result.result_url}
                download={`staging-${result.job_id}.png`}
                target="_blank"
                rel="noopener"
                style={{
                  display: "inline-block",
                  background: PRIMARY,
                  color: DARK,
                  textDecoration: "none",
                  padding: "12px 24px",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                ⬇ Télécharger l'image stagée
              </a>
            </div>
          </section>
        )}

        {/* ─── Mentions ───────────────────────────────────────────────── */}
        <div
          style={{
            marginTop: 40,
            fontSize: 11,
            color: "#94a3b8",
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          Propulsé par DATAMERRY® × Replicate · Modèle IA <code>adirik/interior-design</code>
          <br />
          Les images générées sont fictives et destinées à un usage illustratif (mise en valeur du potentiel d'un bien).
          <br />
          Aucune image originale n'est partagée avec des tiers à des fins commerciales.
        </div>
      </div>
    </main>
  );
}

const secondaryBtn: React.CSSProperties = {
  background: "transparent",
  color: "#64748b",
  border: "1px solid #cbd5e1",
  padding: "8px 14px",
  borderRadius: 4,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};
