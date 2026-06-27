/**
 * Virtual Home Staging Phase D — polygones libres + multi-pass masked inpainting.
 *
 * URL : /outils/staging
 *
 * UX :
 *   1. Upload photo
 *   2. Choisis une zone (cuisine, salon...)
 *   3. Clique plusieurs points pour définir un polygone (3+ points)
 *   4. Bouton "Fermer la zone" → polygone finalisé
 *   5. Stager → 1 pass d'inpainting par zone avec masque polygonal
 */

"use client";

import { useState, useRef } from "react";

const PRIMARY = "#c8a25d";
const DARK = "#0f172a";

type ZoneType = "cuisine" | "repas" | "salon" | "lecture";

const ZONE_DEFS: Record<
  ZoneType,
  { label: string; color: string; stroke: string; icon: string; defaultPrompt: string }
> = {
  cuisine: {
    label: "Cuisine",
    color: "rgba(220, 38, 38, 0.45)",
    stroke: "#dc2626",
    icon: "🍳",
    defaultPrompt:
      "modern fully-equipped kitchen with white shaker cabinets, brushed brass hardware, oak wood countertops, marble backsplash, induction cooktop, integrated stainless steel oven, kitchen island, plants, scandinavian style",
  },
  repas: {
    label: "Salle à manger",
    color: "rgba(245, 158, 11, 0.45)",
    stroke: "#f59e0b",
    icon: "🍽️",
    defaultPrompt:
      "oak wood dining table with 6 cane back chairs, linear pendant light above, plants centerpiece, scandinavian style",
  },
  salon: {
    label: "Salon",
    color: "rgba(34, 197, 94, 0.45)",
    stroke: "#22c55e",
    icon: "🛋️",
    defaultPrompt:
      "cream sectional sofa, boucle armchair, marble coffee table, beige tufted rug, large potted Strelitzia plant, low oak sideboard, framed art, scandinavian style",
  },
  lecture: {
    label: "Lecture",
    color: "rgba(59, 130, 246, 0.45)",
    stroke: "#3b82f6",
    icon: "📚",
    defaultPrompt:
      "rattan armchair, arc floor lamp, small wooden side table with books, plant, cozy scandinavian reading nook",
  },
};

type Point = { x: number; y: number }; // en % (0-100)
type Zone = {
  type: ZoneType;
  points: Point[]; // au moins 3 points
};

export default function StagingPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null);

  const [zones, setZones] = useState<Zone[]>([]);
  const [currentTool, setCurrentTool] = useState<ZoneType | null>(null);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);

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
      setError("Fichier trop lourd (max 20 Mo).");
      return;
    }
    setError(null);
    setResult(null);
    setZones([]);
    setCurrentPoints([]);
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
  }

  function onImageLoad() {
    const img = imgRef.current;
    if (!img) return;
    setImgDims({ w: img.naturalWidth, h: img.naturalHeight });
  }

  function getRelativePoint(e: React.MouseEvent): Point | null {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  }

  function onClick(e: React.MouseEvent) {
    if (!currentTool) return;
    const p = getRelativePoint(e);
    if (!p) return;
    setCurrentPoints((prev) => [...prev, p]);
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!currentTool) return;
    const p = getRelativePoint(e);
    setHoverPoint(p);
  }

  function closePolygon() {
    if (!currentTool || currentPoints.length < 3) return;
    setZones((prev) => [
      ...prev,
      { type: currentTool, points: currentPoints },
    ]);
    setCurrentPoints([]);
    setHoverPoint(null);
  }

  function cancelPolygon() {
    setCurrentPoints([]);
    setHoverPoint(null);
  }

  function undoLastPoint() {
    setCurrentPoints((prev) => prev.slice(0, -1));
  }

  function removeZone(i: number) {
    setZones((prev) => prev.filter((_, idx) => idx !== i));
  }

  // Génère un mask PNG (noir avec polygone blanc) en dataURL
  function generateMask(zone: Zone): string {
    if (!imgDims) return "";
    const canvas = document.createElement("canvas");
    canvas.width = imgDims.w;
    canvas.height = imgDims.h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    // Fond noir = préservé
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, imgDims.w, imgDims.h);
    // Polygone blanc = zone à inpainter
    ctx.fillStyle = "white";
    ctx.beginPath();
    zone.points.forEach((p, i) => {
      const px = (p.x / 100) * imgDims.w;
      const py = (p.y / 100) * imgDims.h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.fill();
    return canvas.toDataURL("image/png");
  }

  function pointsToSvgPath(points: Point[]): string {
    if (points.length === 0) return "";
    return (
      points
        .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
        .join(" ") + " Z"
    );
  }

  async function handleSubmit() {
    if (!file) {
      setError("Upload une photo d'abord.");
      return;
    }
    if (zones.length === 0) {
      setError("Dessine au moins une zone fermée.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    const form = new FormData();
    form.append("image", file);
    form.append(
      "zones_json",
      JSON.stringify(
        zones.map((z) => ({
          type: z.type,
          prompt: ZONE_DEFS[z.type].defaultPrompt,
          mask: generateMask(z),
        })),
      ),
    );

    try {
      const res = await fetch("/api/staging", { method: "POST", body: form });
      const data = (await res.json()) as
        | { ok: true; original_url: string; result_url: string; job_id: string; errors?: string[] }
        | { ok: false; error: string; detail?: string };
      if (!data.ok) {
        setError(`Échec : ${data.detail ?? data.error}`);
      } else {
        setResult({
          original_url: data.original_url,
          result_url: data.result_url,
          job_id: data.job_id,
        });
        if (data.errors && data.errors.length > 0) {
          setError(`Partiel : ${data.errors.join(" · ")}`);
        }
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
            Virtual Home Staging IA — Phase D
          </h1>
          <p style={{ color: "#cbd5e1", fontSize: 13, margin: "4px 0 0" }}>
            Trace les contours de chaque zone (polygone libre) · contrôle pixel-précis
          </p>
        </div>
      </header>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "30px 24px" }}>
        {/* Upload */}
        {!preview && (
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
              1. Upload la photo
            </h2>
            <input
              type="file"
              ref={fileRef}
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
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
                padding: 60,
                textAlign: "center",
                cursor: "pointer",
                background: "#fafafa",
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 8 }}>📸</div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Clique ou glisse-dépose</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>JPG, PNG ou WEBP · max 20 Mo</div>
            </div>
          </section>
        )}

        {preview && !result && (
          <>
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
                2. Sélectionne une zone, clique pour placer des points, ferme le polygone
              </h2>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {(Object.keys(ZONE_DEFS) as ZoneType[]).map((key) => {
                  const def = ZONE_DEFS[key];
                  const active = currentTool === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        if (currentPoints.length > 0) cancelPolygon();
                        setCurrentTool(active ? null : key);
                      }}
                      style={{
                        padding: "10px 16px",
                        background: active ? def.stroke : "white",
                        color: active ? "white" : "#475569",
                        border: `2px solid ${def.stroke}`,
                        borderRadius: 6,
                        fontSize: 13,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      {def.icon} {def.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                    setZones([]);
                    setCurrentPoints([]);
                    setCurrentTool(null);
                    if (fileRef.current) fileRef.current.value = "";
                  }}
                  style={{
                    padding: "10px 16px",
                    background: "transparent",
                    color: "#64748b",
                    border: "1px solid #cbd5e1",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    marginLeft: "auto",
                  }}
                >
                  ↺ Changer photo
                </button>
              </div>

              {currentTool && (
                <div
                  style={{
                    background: "#fef3c7",
                    border: "1px solid #fbbf24",
                    padding: "10px 12px",
                    borderRadius: 4,
                    fontSize: 12,
                    color: "#78350f",
                    marginBottom: 12,
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <span>
                    ✏️ Outil <strong>{ZONE_DEFS[currentTool].label}</strong> · {currentPoints.length} point{currentPoints.length > 1 ? "s" : ""} placé{currentPoints.length > 1 ? "s" : ""}
                    {currentPoints.length < 3
                      ? ` — clique encore ${3 - currentPoints.length} point${3 - currentPoints.length > 1 ? "s" : ""}`
                      : " — prêt à fermer"}
                  </span>
                  {currentPoints.length >= 3 && (
                    <button
                      type="button"
                      onClick={closePolygon}
                      style={{
                        background: "#10b981",
                        color: "white",
                        border: "none",
                        padding: "5px 12px",
                        borderRadius: 3,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      ✓ Fermer la zone
                    </button>
                  )}
                  {currentPoints.length > 0 && (
                    <>
                      <button
                        type="button"
                        onClick={undoLastPoint}
                        style={{
                          background: "transparent",
                          color: "#78350f",
                          border: "1px solid #78350f",
                          padding: "5px 10px",
                          borderRadius: 3,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        ← Annuler dernier point
                      </button>
                      <button
                        type="button"
                        onClick={cancelPolygon}
                        style={{
                          background: "transparent",
                          color: "#dc2626",
                          border: "1px solid #dc2626",
                          padding: "5px 10px",
                          borderRadius: 3,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        ✕ Effacer
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Photo + SVG overlay */}
              <div
                ref={containerRef}
                onClick={onClick}
                onMouseMove={onMouseMove}
                style={{
                  position: "relative",
                  width: "100%",
                  userSelect: "none",
                  cursor: currentTool ? "crosshair" : "default",
                }}
              >
                <img
                  ref={imgRef}
                  src={preview}
                  alt="À staging"
                  onLoad={onImageLoad}
                  draggable={false}
                  style={{ width: "100%", display: "block", borderRadius: 4 }}
                />

                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    pointerEvents: "none",
                  }}
                >
                  {/* Zones validées */}
                  {zones.map((z, i) => (
                    <g key={i}>
                      <path
                        d={pointsToSvgPath(z.points)}
                        fill={ZONE_DEFS[z.type].color}
                        stroke={ZONE_DEFS[z.type].stroke}
                        strokeWidth={0.3}
                      />
                    </g>
                  ))}
                  {/* Polygone en cours */}
                  {currentTool && currentPoints.length > 0 && (
                    <g>
                      {/* Lignes entre points + ligne vers hover */}
                      <polyline
                        points={currentPoints.map((p) => `${p.x},${p.y}`).join(" ")}
                        fill="none"
                        stroke={ZONE_DEFS[currentTool].stroke}
                        strokeWidth={0.3}
                        strokeDasharray="0.5,0.3"
                      />
                      {hoverPoint && (
                        <line
                          x1={currentPoints[currentPoints.length - 1].x}
                          y1={currentPoints[currentPoints.length - 1].y}
                          x2={hoverPoint.x}
                          y2={hoverPoint.y}
                          stroke={ZONE_DEFS[currentTool].stroke}
                          strokeWidth={0.2}
                          strokeDasharray="0.4,0.4"
                          opacity={0.6}
                        />
                      )}
                      {/* Polygone fermé prévisualisation si ≥ 3 points */}
                      {currentPoints.length >= 3 && (
                        <path
                          d={pointsToSvgPath(currentPoints)}
                          fill={ZONE_DEFS[currentTool].color}
                          opacity={0.5}
                        />
                      )}
                      {/* Points cliqués */}
                      {currentPoints.map((p, i) => (
                        <circle
                          key={i}
                          cx={p.x}
                          cy={p.y}
                          r={0.6}
                          fill="white"
                          stroke={ZONE_DEFS[currentTool].stroke}
                          strokeWidth={0.2}
                        />
                      ))}
                    </g>
                  )}
                </svg>
              </div>

              {zones.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#64748b", marginBottom: 6 }}>
                    Zones définies ({zones.length}) — clique pour supprimer
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {zones.map((z, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => removeZone(i)}
                        style={{
                          padding: "4px 10px",
                          background: ZONE_DEFS[z.type].color,
                          color: DARK,
                          border: `1px solid ${ZONE_DEFS[z.type].stroke}`,
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        {ZONE_DEFS[z.type].icon} {ZONE_DEFS[z.type].label} ({z.points.length} pts) ✕
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <div style={{ textAlign: "center", marginBottom: 30 }}>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={loading || zones.length === 0}
                style={{
                  background: loading || zones.length === 0 ? "#cbd5e1" : DARK,
                  color: "white",
                  border: "none",
                  padding: "14px 40px",
                  borderRadius: 6,
                  fontSize: 15,
                  fontWeight: 700,
                  cursor: loading || zones.length === 0 ? "not-allowed" : "pointer",
                  minWidth: 280,
                }}
              >
                {loading
                  ? `Génération en cours… (~${zones.length * 25} sec)`
                  : `✨ Stager mon bien (${zones.length} zone${zones.length > 1 ? "s" : ""})`}
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
          </>
        )}

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
            <div
              style={{
                position: "relative",
                width: "100%",
                maxWidth: 1000,
                margin: "0 auto",
                overflow: "hidden",
                borderRadius: 6,
                background: "#000",
                lineHeight: 0,
              }}
            >
              <img
                src={result.result_url}
                alt="Après"
                style={{ width: "100%", height: "auto", display: "block" }}
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
                  alt="Avant"
                  style={{ width: "100%", height: "auto", display: "block" }}
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
            <div style={{ textAlign: "center", marginTop: 20, display: "flex", justifyContent: "center", gap: 12 }}>
              <a
                href={result.result_url}
                download={`staging-${result.job_id}.png`}
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
                ⬇ Télécharger
              </a>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setSliderPos(50);
                }}
                style={{
                  background: "transparent",
                  color: "#64748b",
                  border: "1px solid #cbd5e1",
                  padding: "12px 24px",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Refaire
              </button>
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
          Propulsé par DATAMERRY® × Replicate · Modèle SDXL Inpainting masqué
          <br />
          Phase D — Polygones libres. Inpainting strictement contraint à l'intérieur des zones dessinées.
        </div>
      </div>
    </main>
  );
}
