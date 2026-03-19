"use client";

import { useState } from "react";

export type Intent = "acheteur" | "vendeur" | "investisseur" | "agent";

interface Props {
  commune: { code: string; nom: string };
  initialIntent?: Intent;
  onClose: () => void;
}

const BUDGETS_ACHETEUR = [
  "< 150 000 €",
  "150 000 – 250 000 €",
  "250 000 – 400 000 €",
  "400 000 – 600 000 €",
  "> 600 000 €",
];

const BUDGETS_VENDEUR = [
  "< 200 000 €",
  "200 000 – 350 000 €",
  "350 000 – 500 000 €",
  "500 000 – 800 000 €",
  "> 800 000 €",
];

const TIMELINES = [
  "Urgent (< 3 mois)",
  "3 à 6 mois",
  "6 à 12 mois",
  "Plus de 12 mois",
];

const SECTEURS_92 = [
  "Boulogne / Issy / Vanves",
  "Neuilly / Levallois / Courbevoie",
  "La Défense / Puteaux / Nanterre",
  "Rueil / Suresnes / Saint-Cloud",
  "Meudon / Clamart / Châtillon",
  "Colombes / Asnières / Gennevilliers",
  "Antony / Sceaux / Bourg-la-Reine",
  "Montrouge / Malakoff / Bagneux",
  "Autre / Pas encore décidé",
];

const SECTEURS_94 = [
  "Vincennes / Saint-Mandé",
  "Nogent / Le Perreux / Bry",
  "Créteil / Maisons-Alfort",
  "Saint-Maur / Joinville",
  "Charenton / Alfortville",
  "Vitry / Ivry / Villejuif",
  "Champigny / Chennevières",
  "Orly / Choisy / Thiais",
  "L'Haÿ / Cachan / Arcueil",
  "Autre / Pas encore décidé",
];

const SECTEURS_BY_DEPT: Record<string, { label: string; options: string[] }> = {
  "92": { label: "Dans quel coin des Hauts-de-Seine ?", options: SECTEURS_92 },
  "94": { label: "Dans quel coin du Val-de-Marne ?", options: SECTEURS_94 },
};

const INTENT_CONFIG = {
  acheteur: {
    label: "J'achète",
    icon: "🔑",
    color: "#00d4ff",
    description: "Vous cherchez à acquérir",
    ctaTitle: (nom: string) => `Vous cherchez à acheter à ${nom} ?`,
    ctaSub: "Recevez une sélection de biens correspondant à votre budget, directement dans votre boîte mail.",
    budgets: BUDGETS_ACHETEUR,
    budgetLabel: "Votre budget d'achat",
  },
  vendeur: {
    label: "Je vends",
    icon: "🏠",
    color: "#ff8844",
    description: "Vous avez un bien à vendre",
    ctaTitle: (nom: string) => `Vous vendez un bien à ${nom} ?`,
    ctaSub: "Obtenez une estimation gratuite et entrez en contact avec des agents spécialisés sur ce marché.",
    budgets: BUDGETS_VENDEUR,
    budgetLabel: "Valeur estimée du bien",
  },
  investisseur: {
    label: "J'investis",
    icon: "📈",
    color: "#a855f7",
    description: "Investissement locatif / revente",
    ctaTitle: (nom: string) => `Vous investissez à ${nom} ?`,
    ctaSub: "Recevez les micro-marchés à fort potentiel et les données de rentabilité locative.",
    budgets: BUDGETS_ACHETEUR,
    budgetLabel: "Budget d'investissement",
  },
  agent: {
    label: "Je suis agent",
    icon: "💼",
    color: "#00ff88",
    description: "Agent immobilier / promoteur",
    ctaTitle: (_: string) => "Accédez aux données DVF enrichies",
    ctaSub: "Recevez les rapports de marché par commune et les leads qualifiés de votre secteur.",
    budgets: [],
    budgetLabel: "",
  },
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 8,
  padding: "10px 14px",
  color: "#fff",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
  fontFamily: "Segoe UI, Arial, sans-serif",
};

export default function AnalyseLeadModal({ commune, initialIntent, onClose }: Props) {
  const [step, setStep] = useState<"intent" | "form">(initialIntent ? "form" : "intent");
  const [intent, setIntent] = useState<Intent | null>(initialIntent ?? null);
  const [budget, setBudget] = useState("");
  const [timeline, setTimeline] = useState("");
  const [secteur, setSecteur] = useState("");
  const [form, setForm] = useState({ nom: "", prenom: "", societe: "", email: "", telephone: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const config = intent ? INTENT_CONFIG[intent] : null;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.prenom || !form.nom) return;
    setStatus("loading");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.email,
          nom: `${form.prenom} ${form.nom}`.trim(),
          prenom: form.prenom,
          nom_famille: form.nom,
          societe: form.societe,
          telephone: form.telephone,
          consentement: true,
          intent,
          commune_code: commune.code,
          commune_nom: commune.nom,
          budget,
          timeline,
          secteur: secteur || undefined,
          source: `analyse_${commune.code}_${intent}`,
        }),
      });
      if (!res.ok) throw new Error("Erreur serveur");
      setStatus("success");
    } catch {
      setStatus("error");
      setErrorMsg("Une erreur est survenue. Veuillez réessayer.");
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.8)",
        padding: 16,
        backdropFilter: "blur(6px)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "linear-gradient(145deg, #0a0a1e, #10102a)",
          border: `1px solid ${config ? config.color + "44" : "rgba(255,255,255,0.1)"}`,
          borderRadius: 20,
          padding: "32px 36px",
          maxWidth: 500,
          width: "100%",
          maxHeight: "95vh",
          overflowY: "auto",
          position: "relative",
          boxShadow: "0 32px 80px rgba(0,0,0,0.9)",
          fontFamily: "Segoe UI, Arial, sans-serif",
        }}
      >
        <button
          onClick={onClose}
          style={{
            position: "absolute", top: 14, right: 16,
            background: "none", border: "none",
            color: "rgba(255,255,255,0.3)", fontSize: 22, cursor: "pointer",
          }}
        >×</button>

        {status === "success" ? (
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2 style={{ color: "#fff", margin: "0 0 12px", fontSize: 22 }}>
              {intent === "vendeur" ? "Demande envoyée !" : "Parfait, on vous contacte !"}
            </h2>
            <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 14, lineHeight: 1.7 }}>
              {intent === "agent"
                ? "Vous recevrez les données de marché et leads qualifiés pour votre secteur sous 24h."
                : `Un expert du marché de ${commune.nom} vous contactera très prochainement.`}
            </p>
            <button
              onClick={onClose}
              style={{
                marginTop: 24, padding: "11px 30px", borderRadius: 9, border: "none",
                background: config ? config.color : "#00d4ff",
                color: "#000", fontWeight: 700, fontSize: 14, cursor: "pointer",
              }}
            >
              Retour à l&apos;analyse →
            </button>
          </div>
        ) : step === "intent" ? (
          <>
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
                {commune.nom}
              </div>
              <h2 style={{ margin: 0, color: "#fff", fontSize: 20, lineHeight: 1.3 }}>
                Vous êtes sur ce marché — on peut vous aider
              </h2>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {(Object.entries(INTENT_CONFIG) as [Intent, typeof INTENT_CONFIG.acheteur][]).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => { setIntent(key); setStep("form"); }}
                  style={{
                    padding: "16px 14px",
                    borderRadius: 12,
                    border: `1px solid ${cfg.color}33`,
                    background: "rgba(255,255,255,0.03)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = `${cfg.color}18`;
                    (e.currentTarget as HTMLButtonElement).style.borderColor = `${cfg.color}88`;
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.03)";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = `${cfg.color}33`;
                  }}
                >
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{cfg.icon}</div>
                  <div style={{ color: cfg.color, fontWeight: 700, fontSize: 14 }}>{cfg.label}</div>
                  <div style={{ color: "rgba(255,255,255,0.35)", fontSize: 11, marginTop: 3 }}>{cfg.description}</div>
                </button>
              ))}
            </div>
          </>
        ) : config && (
          <>
            <button
              onClick={() => setStep("intent")}
              style={{
                background: "none", border: "none", color: "rgba(255,255,255,0.35)",
                fontSize: 12, cursor: "pointer", marginBottom: 16, padding: 0,
              }}
            >
              ← Changer
            </button>
            <div
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                background: `${config.color}18`, border: `1px solid ${config.color}44`,
                borderRadius: 99, padding: "4px 12px", marginBottom: 16,
                fontSize: 11, color: config.color, letterSpacing: 1, textTransform: "uppercase",
              }}
            >
              {config.icon} {config.label}
            </div>
            <h2 style={{ margin: "0 0 8px", color: "#fff", fontSize: 19, lineHeight: 1.3 }}>
              {config.ctaTitle(commune.nom)}
            </h2>
            <p style={{ margin: "0 0 22px", color: "rgba(255,255,255,0.45)", fontSize: 13, lineHeight: 1.6 }}>
              {config.ctaSub}
            </p>

            <form onSubmit={handleSubmit}>
              {/* Budget (sauf agent) */}
              {config.budgets.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: 0.5 }}>
                    {config.budgetLabel}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {config.budgets.map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setBudget(b)}
                        style={{
                          padding: "6px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
                          border: `1px solid ${budget === b ? config.color : "rgba(255,255,255,0.15)"}`,
                          background: budget === b ? `${config.color}22` : "rgba(255,255,255,0.04)",
                          color: budget === b ? config.color : "rgba(255,255,255,0.6)",
                          fontWeight: budget === b ? 700 : 400,
                        }}
                      >{b}</button>
                    ))}
                  </div>
                </div>
              )}

              {/* Secteur par département (acheteur / investisseur) */}
              {(() => {
                const deptCode = commune.code.slice(0, 2);
                const secteurConfig = SECTEURS_BY_DEPT[deptCode];
                if (!secteurConfig || (intent !== "acheteur" && intent !== "investisseur")) return null;
                return (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: 0.5 }}>
                      {secteurConfig.label}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {secteurConfig.options.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSecteur(s)}
                          style={{
                            padding: "6px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
                            border: `1px solid ${secteur === s ? config.color : "rgba(255,255,255,0.15)"}`,
                            background: secteur === s ? `${config.color}22` : "rgba(255,255,255,0.04)",
                            color: secteur === s ? config.color : "rgba(255,255,255,0.6)",
                            fontWeight: secteur === s ? 700 : 400,
                          }}
                        >{s}</button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Timeline */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 8, letterSpacing: 0.5 }}>
                  Horizon
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {TIMELINES.map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTimeline(t)}
                      style={{
                        padding: "6px 12px", borderRadius: 99, fontSize: 12, cursor: "pointer",
                        border: `1px solid ${timeline === t ? config.color : "rgba(255,255,255,0.15)"}`,
                        background: timeline === t ? `${config.color}22` : "rgba(255,255,255,0.04)",
                        color: timeline === t ? config.color : "rgba(255,255,255,0.6)",
                        fontWeight: timeline === t ? 700 : 400,
                      }}
                    >{t}</button>
                  ))}
                </div>
              </div>

              {/* Prénom + Nom */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <label>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 5, letterSpacing: 0.5, display: "block" }}>Prénom *</span>
                  <input type="text" required value={form.prenom} onChange={set("prenom")} placeholder="Thomas" style={inputStyle} />
                </label>
                <label>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 5, letterSpacing: 0.5, display: "block" }}>Nom *</span>
                  <input type="text" required value={form.nom} onChange={set("nom")} placeholder="Dupont" style={inputStyle} />
                </label>
              </div>
              {/* Société (optionnel) */}
              <label style={{ display: "block", marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 5, letterSpacing: 0.5, display: "block" }}>Société</span>
                <input type="text" value={form.societe} onChange={set("societe")} placeholder="Agence, promoteur, cabinet..." style={inputStyle} />
              </label>
              {/* Email + Téléphone */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <label>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 5, letterSpacing: 0.5, display: "block" }}>Email *</span>
                  <input type="email" required value={form.email} onChange={set("email")} placeholder="vous@exemple.fr" style={inputStyle} />
                </label>
                <label>
                  <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginBottom: 5, letterSpacing: 0.5, display: "block" }}>Téléphone</span>
                  <input type="tel" value={form.telephone} onChange={set("telephone")} placeholder="+33 6 ..." style={inputStyle} />
                </label>
              </div>

              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginBottom: 14, lineHeight: 1.5 }}>
                En soumettant ce formulaire, vous acceptez d&apos;être contacté(e) par un expert du marché de {commune.nom}. Données protégées · Désabonnement à tout moment.
              </div>

              {errorMsg && <div style={{ color: "#ff6060", fontSize: 12, marginBottom: 12 }}>{errorMsg}</div>}

              <button
                type="submit"
                disabled={status === "loading"}
                style={{
                  width: "100%", padding: "13px", borderRadius: 9, border: "none",
                  background: status === "loading" ? `${config.color}66` : config.color,
                  color: "#000", fontWeight: 800, fontSize: 15,
                  cursor: status === "loading" ? "not-allowed" : "pointer",
                  boxShadow: `0 0 24px ${config.color}55`,
                }}
              >
                {status === "loading" ? "Envoi..." :
                  intent === "agent" ? "Accéder aux données →" :
                  intent === "vendeur" ? "Obtenir une estimation gratuite →" :
                  "Être mis en relation →"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
