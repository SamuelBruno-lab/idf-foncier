"use client";

import { useState, useTransition } from "react";

interface MatchingConfig {
  cabinet_slug: string;
  radius_mandataire_km: number;
  radius_apporteur_km: number;
  radius_vendeur_km: number;
  radius_acheteur_km: number;
  radius_paris_km: number;
  radius_metro_km: number;
  radius_default_km: number;
  min_matches: number;
  max_matches: number;
  adaptive_mode: boolean;
  adaptive_target_matches: number;
  adaptive_max_radius_km: number;
  show_no_match_message: string;
}

const DM_DARK = "#064e3b";
const DM_GREEN = "#10b981";
const GOLD = "#c8a25d";
const MUTED = "#64748b";
const BORDER = "#e2e8f0";
const BG = "#f8fafc";

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (n: number) => void;
  hint?: string;
  color?: string;
}

function Slider({ label, value, min, max, step = 1, onChange, hint, color }: SliderProps) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 4,
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: color ?? DM_DARK,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value} km
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          width: "100%",
          accentColor: color ?? DM_GREEN,
          cursor: "pointer",
        }}
      />
      {hint && (
        <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{hint}</div>
      )}
    </label>
  );
}

export function MatchingConfigForm({
  initial,
  cabinetSlug,
}: {
  initial: MatchingConfig;
  cabinetSlug: string;
}) {
  const [config, setConfig] = useState(initial);
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<"idle" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState<string>("");

  const handleChange = <K extends keyof MatchingConfig>(
    key: K,
    value: MatchingConfig[K],
  ) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
    setStatus("idle");
  };

  const handleSave = () => {
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/cabinets/${cabinetSlug}/matching/config`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(config),
          },
        );
        const data = (await res.json()) as { error?: string; message?: string };
        if (!res.ok) {
          setStatus("err");
          setErrMsg(data.message ?? data.error ?? "Erreur");
          return;
        }
        setStatus("ok");
      } catch (err) {
        setStatus("err");
        setErrMsg(err instanceof Error ? err.message : "Erreur");
      }
    });
  };

  const handleReset = () => {
    setConfig({
      ...config,
      radius_mandataire_km: 30,
      radius_apporteur_km: 100,
      radius_vendeur_km: 50,
      radius_acheteur_km: 25,
      radius_paris_km: 5,
      radius_metro_km: 15,
      radius_default_km: 50,
      adaptive_mode: true,
      adaptive_target_matches: 5,
      adaptive_max_radius_km: 500,
    });
    setStatus("idle");
  };

  return (
    <div
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "20px",
      }}
    >
      <h1
        style={{
          fontSize: 24,
          fontWeight: 800,
          color: DM_DARK,
          marginBottom: 4,
        }}
      >
        ⚙️ Paramètres de matching — {cabinetSlug}
      </h1>
      <p style={{ color: MUTED, fontSize: 13, marginBottom: 24 }}>
        Configure les rayons géographiques utilisés pour proposer des
        membres Collabimo à chaque lead capturé. Le <strong>mode
        adaptatif</strong> élargit automatiquement le rayon tant que le
        nombre cible de matches n'est pas atteint.
      </p>

      {/* === Section 1 : Rayon par type de membre === */}
      <section
        style={{
          background: BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: DM_DARK,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 14,
          }}
        >
          📐 Rayon par type de membre
        </h2>
        <Slider
          label="Mandataires immobiliers"
          value={config.radius_mandataire_km}
          min={1}
          max={300}
          onChange={(v) => handleChange("radius_mandataire_km", v)}
          hint="Ex : 30 km autour du bien — privilégie un mandataire local"
          color={GOLD}
        />
        <Slider
          label="Apporteurs d'affaires"
          value={config.radius_apporteur_km}
          min={1}
          max={500}
          onChange={(v) => handleChange("radius_apporteur_km", v)}
          hint="Ex : 100 km — peut être étendu, l'apport ne nécessite pas de présence physique"
        />
        <Slider
          label="Vendeurs Collabimo"
          value={config.radius_vendeur_km}
          min={1}
          max={300}
          onChange={(v) => handleChange("radius_vendeur_km", v)}
          hint="Vendeurs déjà inscrits dans la zone — pour matching croisé"
        />
        <Slider
          label="Acheteurs Collabimo"
          value={config.radius_acheteur_km}
          min={1}
          max={300}
          onChange={(v) => handleChange("radius_acheteur_km", v)}
          hint="Acheteurs intéressés par un bien dans la zone"
        />
      </section>

      {/* === Section 2 : Rayon par densité de zone === */}
      <section
        style={{
          background: BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: DM_DARK,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 14,
          }}
        >
          📍 Plafond par densité de zone
        </h2>
        <p style={{ fontSize: 11, color: MUTED, marginBottom: 14 }}>
          Le rayon final = MIN entre le rayon par type et le plafond par zone.
          En zone dense (Paris), pas besoin de chercher loin.
        </p>
        <Slider
          label="Paris intra-muros"
          value={config.radius_paris_km}
          min={1}
          max={50}
          onChange={(v) => handleChange("radius_paris_km", v)}
          hint="Densité élevée — petit rayon suffit"
        />
        <Slider
          label="Grandes métropoles (Lyon, Marseille, Toulouse...)"
          value={config.radius_metro_km}
          min={1}
          max={100}
          onChange={(v) => handleChange("radius_metro_km", v)}
        />
        <Slider
          label="Autres zones (province, rural)"
          value={config.radius_default_km}
          min={1}
          max={500}
          onChange={(v) => handleChange("radius_default_km", v)}
          hint="Rayon plus large pour compenser la faible densité"
        />
      </section>

      {/* === Section 3 : Mode adaptatif === */}
      <section
        style={{
          background: "#ede9fe",
          border: `1px solid #9945ff`,
          borderRadius: 12,
          padding: 18,
          marginBottom: 16,
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: "#5b21b6",
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 14,
          }}
        >
          🤖 Mode adaptatif (recommandé)
        </h2>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 14px",
            background: "#fff",
            borderRadius: 8,
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          <input
            type="checkbox"
            checked={config.adaptive_mode}
            onChange={(e) => handleChange("adaptive_mode", e.target.checked)}
            style={{ width: 18, height: 18, cursor: "pointer" }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Activer le mode adaptatif
            </div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
              Si pas assez de matches trouvés au rayon initial, élargir
              progressivement jusqu'à atteindre le nombre cible
            </div>
          </div>
        </label>

        <Slider
          label="Nombre cible de matches"
          value={config.adaptive_target_matches}
          min={1}
          max={20}
          onChange={(v) => handleChange("adaptive_target_matches", v)}
          hint="Élargir le rayon tant qu'on n'a pas ce nombre de membres"
          color="#9945ff"
        />
        <Slider
          label="Rayon max absolu (sécurité)"
          value={config.adaptive_max_radius_km}
          min={50}
          max={2000}
          step={50}
          onChange={(v) => handleChange("adaptive_max_radius_km", v)}
          hint="Ne dépasse jamais ce rayon, même en mode adaptatif"
          color="#9945ff"
        />
      </section>

      {/* === Section 4 : Limites === */}
      <section
        style={{
          background: BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 12,
          padding: 18,
          marginBottom: 22,
        }}
      >
        <h2
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: DM_DARK,
            textTransform: "uppercase",
            letterSpacing: 1,
            marginBottom: 14,
          }}
        >
          📊 Limites d'affichage
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 16,
          }}
        >
          <div>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Min matches affichés
            </label>
            <input
              type="number"
              value={config.min_matches}
              onChange={(e) =>
                handleChange("min_matches", Number(e.target.value))
              }
              min={1}
              max={10}
              style={{
                width: "100%",
                padding: 8,
                marginTop: 4,
                border: `1px solid ${BORDER}`,
                borderRadius: 6,
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600 }}>
              Max matches affichés
            </label>
            <input
              type="number"
              value={config.max_matches}
              onChange={(e) =>
                handleChange("max_matches", Number(e.target.value))
              }
              min={1}
              max={50}
              style={{
                width: "100%",
                padding: 8,
                marginTop: 4,
                border: `1px solid ${BORDER}`,
                borderRadius: 6,
              }}
            />
          </div>
        </div>
      </section>

      {/* === Actions === */}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          onClick={handleSave}
          disabled={isPending}
          style={{
            padding: "12px 24px",
            background: DM_GREEN,
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 700,
            cursor: isPending ? "wait" : "pointer",
            opacity: isPending ? 0.6 : 1,
          }}
        >
          {isPending ? "Enregistrement…" : "💾 Enregistrer"}
        </button>
        <button
          onClick={handleReset}
          disabled={isPending}
          style={{
            padding: "12px 18px",
            background: "transparent",
            color: MUTED,
            border: `1px solid ${BORDER}`,
            borderRadius: 8,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ↻ Valeurs par défaut
        </button>
        {status === "ok" && (
          <span
            style={{
              color: DM_GREEN,
              fontSize: 13,
              fontWeight: 600,
              marginLeft: 8,
            }}
          >
            ✅ Sauvegardé
          </span>
        )}
        {status === "err" && (
          <span
            style={{
              color: "#dc2626",
              fontSize: 13,
              fontWeight: 600,
              marginLeft: 8,
            }}
          >
            ❌ {errMsg}
          </span>
        )}
      </div>
    </div>
  );
}
