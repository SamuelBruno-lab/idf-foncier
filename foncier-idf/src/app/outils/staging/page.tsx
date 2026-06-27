/**
 * Page Virtual Home Staging Phase C — multi-photos + plan 2D.
 *
 * URL : /outils/staging
 *
 * UX :
 *   1. Photo 1 (obligatoire) + Photo 2 angle (optionnel) + Plan 2D (optionnel)
 *   2. Choix pièce + style
 *   3. Bouton "Stager" → POST /api/staging
 *   4. ~30-60 sec si 2 photos
 *   5. Slider avant/après pour chaque photo
 */

"use client";

import { useState, useRef } from "react";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

const ROOMS = [
  { key: "salon", label: "Salon", icon: "🛋️" },
  { key: "sejour_cuisine", label: "Séjour-Cuisine", icon: "🍽️" },
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

type FilePreview = { file: File; preview: string };

export default function StagingPage() {
  const fileRef1 = useRef<HTMLInputElement>(null);
  const fileRef2 = useRef<HTMLInputElement>(null);
  const fileRefPlan = useRef<HTMLInputElement>(null);

  const [photo1, setPhoto1] = useState<FilePreview | null>(null);
  const [photo2, setPhoto2] = useState<FilePreview | null>(null);
  const [plan, setPlan] = useState<FilePreview | null>(null);

  const [roomType, setRoomType] = useState("salon");
  const [style, setStyle] = useState("moderne");
  const [customPrompt, setCustomPrompt] = useState("");

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    original_url: string;
    result_url: string;
    original_url_2: string | null;
    result_url_2: string | null;
    job_id: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [slider1, setSlider1] = useState(50);
  const [slider2, setSlider2] = useState(50);

  function loadFile(
    f: File | null,
    setter: (fp: FilePreview | null) => void,
    isPlan = false,
  ) {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) {
      setError("Fichier trop lourd (max 20 Mo).");
      return;
    }
    setError(null);
    setResult(null);
    if (isPlan && f.type === "application/pdf") {
      // PDF : pas de preview navigateur, juste nom + icône
      setter({ file: f, preview: "" });
    } else {
      const reader = new FileReader();
      reader.onload = () => setter({ file: f, preview: reader.result as string });
      reader.readAsDataURL(f);
    }
  }

  async function handleSubmit() {
    if (!photo1) {
      setError("La photo principale est obligatoire.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append("image", photo1.file);
    if (photo2) form.append("image_2", photo2.file);
    if (plan) form.append("plan", plan.file);
    form.append("room_type", roomType);
    form.append("style", style);
    if (customPrompt.trim()) form.append("custom_prompt", customPrompt.trim());

    try {
      const res = await fetch("/api/staging", { method: "POST", body: form });
      const data = (await res.json()) as
        | {
            ok: true;
            original_url: string;
            result_url: string;
            original_url_2: string | null;
            result_url_2: string | null;
            job_id: string;
          }
        | { ok: false; error: string; detail?: string };
      if (!data.ok) {
        setError(`Échec : ${data.detail ?? data.error}`);
      } else {
        setResult({
          original_url: data.original_url,
          result_url: data.result_url,
          original_url_2: data.original_url_2,
          result_url_2: data.result_url_2,
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
      <header
        style={{
          background: DARK,
          padding: "20px 24px",
          borderBottom: `1px solid ${PRIMARY}40`,
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
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
            Virtual Home Staging IA — Phase C
          </h1>
          <p style={{ color: "#cbd5e1", fontSize: 13, margin: "4px 0 0" }}>
            2 angles + plan 2D pour un staging cohérent et géométriquement précis.
          </p>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "30px 24px" }}>
        {/* ─── 1. Uploads (3 zones) ──────────────────────────────────── */}
        <section
          style={{
            background: "white",
            borderRadius: 8,
            padding: 24,
            marginBottom: 20,
            boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
          }}
        >
          <h2 style={{ margin: "0 0 16px", fontSize: 16, fontFamily: "Georgia, serif" }}>
            1. Photos du bien
          </h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
              gap: 12,
            }}
          >
            <UploadZone
              label="Photo principale"
              required
              accept="image/jpeg,image/png,image/webp"
              fileRef={fileRef1}
              preview={photo1?.preview}
              fileName={photo1?.file.name}
              onPick={(f) => loadFile(f, setPhoto1)}
            />
            <UploadZone
              label="Autre angle (optionnel)"
              accept="image/jpeg,image/png,image/webp"
              fileRef={fileRef2}
              preview={photo2?.preview}
              fileName={photo2?.file.name}
              onPick={(f) => loadFile(f, setPhoto2)}
              hint="Cohérence stylistique garantie"
            />
            <UploadZone
              label="Plan 2D (optionnel)"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              fileRef={fileRefPlan}
              preview={plan?.preview}
              fileName={plan?.file.name}
              onPick={(f) => loadFile(f, setPlan, true)}
              hint="PNG, JPG ou PDF — guide géométrique"
              isPlan
            />
          </div>
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

        {/* ─── 3. Style ─────────────────────────────────────────────── */}
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

        {/* ─── 4. Action ────────────────────────────────────────────── */}
        <div style={{ textAlign: "center", marginBottom: 30 }}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !photo1}
            style={{
              background: loading || !photo1 ? "#cbd5e1" : DARK,
              color: "white",
              border: "none",
              padding: "14px 40px",
              borderRadius: 6,
              fontSize: 15,
              fontWeight: 700,
              cursor: loading || !photo1 ? "not-allowed" : "pointer",
              minWidth: 280,
            }}
          >
            {loading
              ? `Génération en cours… (${photo2 ? "~60 sec" : "~30 sec"})`
              : "✨ Stager mon bien"}
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

        {/* ─── 5. Résultats ────────────────────────────────────────── */}
        {result && (
          <section
            style={{
              background: "white",
              borderRadius: 8,
              padding: 24,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <h2 style={{ margin: "0 0 16px", fontFamily: "Georgia, serif", fontSize: 18 }}>
              ✓ Voici votre bien stagé
            </h2>

            <BeforeAfterSlider
              before={result.original_url}
              after={result.result_url}
              pos={slider1}
              onChange={setSlider1}
              label="Vue 1"
            />

            {result.original_url_2 && result.result_url_2 && (
              <div style={{ marginTop: 24 }}>
                <BeforeAfterSlider
                  before={result.original_url_2}
                  after={result.result_url_2}
                  pos={slider2}
                  onChange={setSlider2}
                  label="Vue 2 (cohérence stylistique garantie)"
                />
              </div>
            )}

            <div style={{ textAlign: "center", marginTop: 24, display: "flex", justifyContent: "center", gap: 12 }}>
              <a
                href={result.result_url}
                download={`staging-1-${result.job_id}.png`}
                target="_blank"
                rel="noopener"
                style={{
                  background: PRIMARY,
                  color: DARK,
                  textDecoration: "none",
                  padding: "12px 24px",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                ⬇ Télécharger vue 1
              </a>
              {result.result_url_2 && (
                <a
                  href={result.result_url_2}
                  download={`staging-2-${result.job_id}.png`}
                  target="_blank"
                  rel="noopener"
                  style={{
                    background: PRIMARY,
                    color: DARK,
                    textDecoration: "none",
                    padding: "12px 24px",
                    borderRadius: 6,
                    fontSize: 14,
                    fontWeight: 700,
                  }}
                >
                  ⬇ Télécharger vue 2
                </a>
              )}
            </div>
          </section>
        )}

        <div
          style={{
            marginTop: 40,
            fontSize: 11,
            color: "#94a3b8",
            textAlign: "center",
            lineHeight: 1.6,
          }}
        >
          Propulsé par DATAMERRY® × Replicate · Modèle multi-ControlNet
          <br />
          Le plan 2D guide la géométrie (ControlNet Canny). Seed fixe garantit la cohérence stylistique entre les vues.
        </div>
      </div>
    </main>
  );
}

// ──────────────────────────────────────────────────────────────
// Composants
// ──────────────────────────────────────────────────────────────

function UploadZone({
  label,
  required,
  accept,
  fileRef,
  preview,
  fileName,
  onPick,
  hint,
  isPlan,
}: {
  label: string;
  required?: boolean;
  accept: string;
  fileRef: React.RefObject<HTMLInputElement | null>;
  preview?: string;
  fileName?: string;
  onPick: (f: File | null) => void;
  hint?: string;
  isPlan?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, color: DARK }}>
        {label} {required && <span style={{ color: "#dc2626" }}>*</span>}
      </div>
      <input
        type="file"
        ref={fileRef}
        accept={accept}
        onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        style={{ display: "none" }}
      />
      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onPick(e.dataTransfer.files?.[0] ?? null);
        }}
        style={{
          border: `2px dashed ${preview || fileName ? "#10b981" : "#cbd5e1"}`,
          borderRadius: 6,
          padding: 16,
          textAlign: "center",
          cursor: "pointer",
          background: "#fafafa",
          minHeight: 140,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          gap: 6,
        }}
      >
        {preview ? (
          <img
            src={preview}
            alt={label}
            style={{ maxHeight: 100, maxWidth: "100%", borderRadius: 4 }}
          />
        ) : fileName && isPlan ? (
          <>
            <div style={{ fontSize: 30 }}>📄</div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{fileName}</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 28 }}>{isPlan ? "📐" : "📸"}</div>
            <div style={{ fontSize: 13, color: "#64748b" }}>Cliquer / glisser</div>
          </>
        )}
        {hint && (
          <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{hint}</div>
        )}
      </div>
    </div>
  );
}

function BeforeAfterSlider({
  before,
  after,
  pos,
  onChange,
  label,
}: {
  before: string;
  after: string;
  pos: number;
  onChange: (v: number) => void;
  label: string;
}) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8, color: DARK }}>
        {label} — Glisse le curseur pour comparer
      </div>
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 1000,
          margin: "0 auto",
          overflow: "hidden",
          borderRadius: 6,
          aspectRatio: "16/9",
          background: "#000",
        }}
      >
        <img
          src={after}
          alt="Après"
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
            clipPath: `inset(0 ${100 - pos}% 0 0)`,
          }}
        >
          <img
            src={before}
            alt="Avant"
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
          value={pos}
          onChange={(e) => onChange(Number(e.target.value))}
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
    </div>
  );
}
