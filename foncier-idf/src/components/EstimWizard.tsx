"use client";

/**
 * EstimWizard — chatbot d'estimation guidé pour les pages cabinet white-label.
 *
 * UX type Typeform / chatbot : pose les questions une par une avec des
 * choix à cocher quand c'est possible (vendeur/acheteur, type de bien, DPE, etc.).
 * Bien plus engageant qu'un form classique, surtout sur mobile.
 *
 * À la fin, appelle l'endpoint /api/cabinets/{slug}/estimate avec toutes les
 * réponses collectées (les paramètres utilisés pour le calcul + ceux stockés
 * en log pour analytics futures).
 */

import { useEffect, useRef, useState } from "react";

// ──────────────────────────────────────────────────────────────────────────────
// Modèle de question
// ──────────────────────────────────────────────────────────────────────────────

export type QuestionType =
  | "address"      // input adresse avec autocomplete (à venir)
  | "text"
  | "number"
  | "single-choice" // une seule réponse parmi N
  | "multi-choice"; // plusieurs réponses parmi N

export type Choice = { value: string; label: string; emoji?: string };

export type Question = {
  id: string;
  label: string;          // affiché comme une bulle de chat
  type: QuestionType;
  placeholder?: string;
  options?: Choice[];
  min?: number;
  max?: number;
  unit?: string;          // ex: 'm²', '€', 'ans'
  required?: boolean;
  skipIf?: (answers: Record<string, unknown>) => boolean;
};

export type Answers = Record<string, string | number | string[]>;

// ──────────────────────────────────────────────────────────────────────────────
// Définition des questions (ordre logique conversationnel)
// ──────────────────────────────────────────────────────────────────────────────

const QUESTIONS: Question[] = [
  {
    id: "intent",
    label: "Bonjour ! Pour commencer, êtes-vous vendeur ou acheteur ?",
    type: "single-choice",
    required: true,
    options: [
      { value: "vendeur", label: "Je vends", emoji: "🏷️" },
      { value: "acheteur", label: "J'achète", emoji: "🔑" },
      { value: "curieux", label: "Je me renseigne", emoji: "👀" },
    ],
  },
  {
    id: "type_bien",
    label: "De quel type de bien s'agit-il ?",
    type: "single-choice",
    required: true,
    // NB — On limite volontairement aux types résidentiels :
    //  - Terrain : se valorise en charge foncière (bilan promoteur) ≠ €/m² DVF.
    //              De plus le volume IDF est très faible.
    //  - Commerce / Tertiaire : se valorisent par capitalisation des loyers,
    //              valeur du droit au bail et notation emplacement (n°1/2/3).
    //              Pas du €/m² DVF non plus.
    // Ces types seront réintroduits avec une méthodologie adaptée (cf. roadmap).
    options: [
      { value: "Appartement", label: "Appartement", emoji: "🏢" },
      { value: "Maison", label: "Maison", emoji: "🏡" },
    ],
  },
  {
    id: "address",
    label: "Quelle adresse souhaitez-vous estimer ?",
    type: "address",
    placeholder: "ex: 10 rue de la Paix 75002 Paris",
    required: true,
  },
  {
    id: "surface",
    label: "Quelle est la surface habitable (en m²) ?",
    type: "number",
    placeholder: "62",
    unit: "m²",
    min: 8,
    max: 5000,
    required: true,
  },
  {
    id: "pieces",
    label: "Combien de pièces (T1, T2, T3...) ?",
    type: "single-choice",
    options: [
      { value: "1", label: "T1 / studio" },
      { value: "2", label: "T2" },
      { value: "3", label: "T3" },
      { value: "4", label: "T4" },
      { value: "5", label: "T5+" },
    ],
    skipIf: (a) => !["Appartement", "Maison"].includes(String(a.type_bien)),
  },
  {
    id: "etage",
    label: "À quel étage se situe-t-il ?",
    type: "single-choice",
    options: [
      { value: "rdc", label: "Rez-de-chaussée", emoji: "🚪" },
      { value: "1-3", label: "1er à 3e", emoji: "🪟" },
      { value: "4-7", label: "4e à 7e (avec asc.)", emoji: "🏙️" },
      { value: "8+", label: "8e ou plus (avec asc.)", emoji: "🌆" },
      { value: "dernier-sans-asc", label: "Dernier sans ascenseur", emoji: "🪜" },
    ],
    skipIf: (a) => a.type_bien !== "Appartement",
  },
  {
    id: "annee_construction",
    label: "Année de construction approximative ?",
    type: "single-choice",
    options: [
      { value: "post-2020", label: "Récent (2020+)", emoji: "✨" },
      { value: "2000-2020", label: "Récent (2000-2020)" },
      { value: "1980-2000", label: "Récent moderne (1980-2000)" },
      { value: "1950-1980", label: "Construction moderne (1950-1980)" },
      { value: "1900-1950", label: "Ancien (1900-1950)" },
      { value: "pre-1900", label: "Haussmannien / pierre (avant 1900)", emoji: "🏛️" },
      { value: "inconnu", label: "Je ne sais pas" },
    ],
  },
  {
    id: "dpe",
    label: "Connaissez-vous le DPE (classe énergétique) ?",
    type: "single-choice",
    options: [
      { value: "A", label: "A — Très performant", emoji: "🟢" },
      { value: "B", label: "B", emoji: "🟢" },
      { value: "C", label: "C", emoji: "🟡" },
      { value: "D", label: "D", emoji: "🟡" },
      { value: "E", label: "E", emoji: "🟠" },
      { value: "F", label: "F — Passoire", emoji: "🔴" },
      { value: "G", label: "G — Passoire", emoji: "🔴" },
      { value: "inconnu", label: "Je ne sais pas" },
    ],
  },
  {
    id: "etat",
    label: "Dans quel état général est le bien ?",
    type: "single-choice",
    options: [
      { value: "renove-neuf", label: "Refait à neuf / Très bon état", emoji: "✨" },
      { value: "bon", label: "Bon état", emoji: "👍" },
      { value: "correct", label: "Correct, quelques travaux", emoji: "🛠️" },
      { value: "renover", label: "À rénover", emoji: "🪚" },
    ],
  },
  {
    id: "exterieurs",
    label: "Y a-t-il des extérieurs ?",
    type: "multi-choice",
    options: [
      { value: "balcon", label: "Balcon", emoji: "🪴" },
      { value: "terrasse", label: "Terrasse", emoji: "☀️" },
      { value: "jardin", label: "Jardin privatif", emoji: "🌳" },
      { value: "parking", label: "Parking / box", emoji: "🅿️" },
      { value: "cave", label: "Cave", emoji: "🍷" },
      { value: "aucun", label: "Aucun", emoji: "—" },
    ],
  },
  {
    id: "usage",
    label: "Le bien est destiné à être :",
    type: "single-choice",
    options: [
      { value: "residence-principale", label: "Résidence principale", emoji: "🏠" },
      { value: "investissement-locatif", label: "Investissement locatif", emoji: "💰" },
      { value: "residence-secondaire", label: "Résidence secondaire", emoji: "🏖️" },
      { value: "vente-occupe", label: "Vente occupée (locataire en place)", emoji: "🔒" },
    ],
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// Composant
// ──────────────────────────────────────────────────────────────────────────────

export type EstimWizardProps = {
  slug: string;
  primaryColor: string;
  cabinetName: string;
  ctaUrl: string;
  ctaLabel: string;
};

type Result = {
  available: boolean;
  address?: string;
  prix_m2_median?: number;
  prix_total_median?: number;
  prix_m2_p10?: number;
  prix_m2_p90?: number;
  nb_ventes?: number;
};

type LeadStatus =
  | "wizard"          // wizard in progress
  | "estimating"      // estimating in progress
  | "result"          // estimation shown, awaiting lead form
  | "lead-form"       // lead form open
  | "lead-sending"    // POST /lead in flight
  | "lead-sent"       // lead captured, email confirmation showed
  | "lead-error";     // form error (network/db)

export default function EstimWizard({
  slug,
  primaryColor,
  cabinetName,
  ctaUrl,
  ctaLabel,
}: EstimWizardProps) {
  const [answers, setAnswers] = useState<Answers>({});
  const [history, setHistory] = useState<Array<{ q: Question; answer: string }>>([]);
  const [currentInput, setCurrentInput] = useState("");
  const [currentMulti, setCurrentMulti] = useState<string[]>([]);
  const [currentStepIdx, setCurrentStepIdx] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [leadStatus, setLeadStatus] = useState<LeadStatus>("wizard");
  const [leadError, setLeadError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Détermine la prochaine question pertinente (en sautant les skipIf)
  function getNextQuestionIdx(fromIdx: number, current: Answers): number {
    for (let i = fromIdx; i < QUESTIONS.length; i++) {
      const q = QUESTIONS[i];
      if (q.skipIf && q.skipIf(current)) continue;
      return i;
    }
    return QUESTIONS.length;
  }

  const currentQuestion = QUESTIONS[currentStepIdx];
  const isFinished = currentStepIdx >= QUESTIONS.length;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [history, isFinished, loading, result]);

  // Submit answer
  function submitAnswer(value: string | string[]) {
    if (!currentQuestion) return;
    const displayValue = Array.isArray(value) ? value.join(", ") : value;

    // Format pour affichage
    let humanReadable = displayValue;
    if (currentQuestion.options) {
      const arr = Array.isArray(value) ? value : [value];
      humanReadable = arr
        .map((v) => {
          const opt = currentQuestion.options?.find((o) => o.value === v);
          return opt ? `${opt.emoji ? opt.emoji + " " : ""}${opt.label}` : v;
        })
        .join(", ");
    } else if (currentQuestion.unit) {
      humanReadable = `${value} ${currentQuestion.unit}`;
    }

    setHistory((prev) => [...prev, { q: currentQuestion, answer: humanReadable }]);
    const newAnswers = { ...answers, [currentQuestion.id]: value };
    setAnswers(newAnswers);
    setCurrentInput("");
    setCurrentMulti([]);

    const next = getNextQuestionIdx(currentStepIdx + 1, newAnswers);
    setCurrentStepIdx(next);

    // Si c'est la dernière question, fetch immédiatement
    if (next >= QUESTIONS.length) {
      void fetchEstimate(newAnswers);
    }
  }

  async function fetchEstimate(allAnswers: Answers) {
    setLoading(true);
    setLeadStatus("estimating");
    try {
      const params = new URLSearchParams({
        address: String(allAnswers.address ?? ""),
        surface: String(allAnswers.surface ?? "62"),
        type_local: String(allAnswers.type_bien ?? "Appartement"),
      });
      // Annexe : toutes les autres réponses pour analytics
      for (const [k, v] of Object.entries(allAnswers)) {
        if (["address", "surface", "type_bien"].includes(k)) continue;
        params.set(`x_${k}`, Array.isArray(v) ? v.join(",") : String(v));
      }
      const res = await fetch(`/api/cabinets/${slug}/estimate?${params.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setResult({ available: false });
        setLeadStatus("result");
        return;
      }
      setResult((await res.json()) as Result);
      setLeadStatus("result");
    } catch {
      setResult({ available: false });
      setLeadStatus("result");
    } finally {
      setLoading(false);
    }
  }

  async function submitLead(form: {
    visitor_name: string;
    visitor_email: string;
    visitor_phone: string;
    consentement: boolean;
  }) {
    if (!result) return;
    setLeadStatus("lead-sending");
    setLeadError(null);
    try {
      const res = await fetch(`/api/cabinets/${slug}/lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          wizard_answers: answers,
          estimation: {
            address: result.address,
            prix_m2_median: result.prix_m2_median,
            prix_m2_p10: result.prix_m2_p10,
            prix_m2_p90: result.prix_m2_p90,
            prix_total_median: result.prix_total_median,
            nb_ventes: result.nb_ventes,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setLeadError(err.error ?? "send_failed");
        setLeadStatus("lead-error");
        return;
      }
      setLeadStatus("lead-sent");
    } catch {
      setLeadError("network_error");
      setLeadStatus("lead-error");
    }
  }

  function reset() {
    setAnswers({});
    setHistory([]);
    setCurrentStepIdx(0);
    setCurrentInput("");
    setCurrentMulti([]);
    setResult(null);
    setLeadStatus("wizard");
    setLeadError(null);
  }

  const fmt = (n: number | undefined | null) =>
    n != null && Number.isFinite(n)
      ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)
      : "—";

  return (
    <div
      style={{
        maxWidth: 680,
        margin: "0 auto",
        background: "white",
        borderRadius: 16,
        border: "1px solid #e2e8f0",
        boxShadow: "0 4px 24px rgba(0,0,0,0.04)",
        overflow: "hidden",
      }}
    >
      {/* Header chat */}
      <header
        style={{
          background: `linear-gradient(135deg, ${primaryColor} 0%, ${shade(primaryColor, -15)} 100%)`,
          color: "white",
          padding: "16px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#4ade80",
            }}
          />
          <span style={{ fontWeight: 700, fontSize: 15 }}>
            Assistant {cabinetName}
          </span>
        </div>
        <span style={{ fontSize: 10, opacity: 0.85, textTransform: "uppercase" }}>
          Estimation propulsée par DATAMERRY
        </span>
      </header>

      {/* Body : historique + question courante / résultat */}
      <div style={{ background: "#f8fafc", padding: 20, minHeight: 400 }}>
        {/* Welcome message */}
        <ChatBubble role="bot" primaryColor={primaryColor}>
          Bonjour 👋 Je vais vous aider à estimer votre bien en quelques questions
          rapides. Tous vos retours restent confidentiels.
        </ChatBubble>

        {/* Historique des Q/A */}
        {history.map((h, i) => (
          <div key={i}>
            <ChatBubble role="bot" primaryColor={primaryColor}>
              {h.q.label}
            </ChatBubble>
            <ChatBubble role="user" primaryColor={primaryColor}>
              {h.answer}
            </ChatBubble>
          </div>
        ))}

        {/* Question en cours */}
        {!isFinished && currentQuestion && (
          <div>
            <ChatBubble role="bot" primaryColor={primaryColor}>
              {currentQuestion.label}
            </ChatBubble>
            <div style={{ marginTop: 12, marginBottom: 16 }}>
              {currentQuestion.type === "single-choice" && currentQuestion.options ? (
                <ChoiceGrid
                  options={currentQuestion.options}
                  primaryColor={primaryColor}
                  onSelect={(v) => submitAnswer(v)}
                />
              ) : currentQuestion.type === "multi-choice" && currentQuestion.options ? (
                <MultiChoiceGrid
                  options={currentQuestion.options}
                  selected={currentMulti}
                  primaryColor={primaryColor}
                  onToggle={(v) =>
                    setCurrentMulti((prev) =>
                      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
                    )
                  }
                  onValidate={() => submitAnswer(currentMulti)}
                />
              ) : (
                <FreeInput
                  question={currentQuestion}
                  value={currentInput}
                  primaryColor={primaryColor}
                  onChange={setCurrentInput}
                  onSubmit={() => {
                    if (currentInput.trim()) submitAnswer(currentInput.trim());
                  }}
                />
              )}
            </div>
          </div>
        )}

        {/* État chargement */}
        {isFinished && loading && (
          <ChatBubble role="bot" primaryColor={primaryColor}>
            <span
              style={{
                display: "inline-block",
                width: 16,
                height: 16,
                border: `2px solid ${primaryColor}40`,
                borderTopColor: primaryColor,
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
                marginRight: 8,
                verticalAlign: "middle",
              }}
            />
            Analyse en cours…
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </ChatBubble>
        )}

        {/* Résultat final + capture lead */}
        {isFinished && result && !loading && (
          <ResultCard
            result={result}
            answers={answers}
            primaryColor={primaryColor}
            cabinetName={cabinetName}
            ctaUrl={ctaUrl}
            ctaLabel={ctaLabel}
            leadStatus={leadStatus}
            leadError={leadError}
            onSubmitLead={submitLead}
            onReset={reset}
          />
        )}

        <div ref={bottomRef} />
      </div>

      {/* Progress bar */}
      {!isFinished && (
        <div
          style={{
            height: 4,
            background: "#e2e8f0",
            position: "relative",
          }}
        >
          <div
            style={{
              width: `${(currentStepIdx / QUESTIONS.length) * 100}%`,
              height: "100%",
              background: primaryColor,
              transition: "width .3s",
            }}
          />
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Sous-composants
// ──────────────────────────────────────────────────────────────────────────────

function ChatBubble({
  role,
  primaryColor,
  children,
}: {
  role: "bot" | "user";
  primaryColor: string;
  children: React.ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: 8,
        gap: 8,
      }}
    >
      {!isUser && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: `linear-gradient(135deg, ${primaryColor}, ${shade(primaryColor, -15)})`,
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 12,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          AI
        </div>
      )}
      <div
        style={{
          maxWidth: "75%",
          padding: "10px 14px",
          borderRadius: 12,
          fontSize: 14,
          lineHeight: 1.45,
          background: isUser ? primaryColor : "white",
          color: isUser ? "white" : "#0f172a",
          border: isUser ? `1px solid ${primaryColor}` : "1px solid #e2e8f0",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ChoiceGrid({
  options,
  primaryColor,
  onSelect,
}: {
  options: Choice[];
  primaryColor: string;
  onSelect: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, paddingLeft: 36 }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          style={{
            background: "white",
            color: primaryColor,
            border: `1.5px solid ${primaryColor}`,
            borderRadius: 10,
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "inherit",
            transition: "all .15s",
          }}
          onMouseOver={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = primaryColor;
            (e.currentTarget as HTMLButtonElement).style.color = "white";
          }}
          onMouseOut={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "white";
            (e.currentTarget as HTMLButtonElement).style.color = primaryColor;
          }}
        >
          {opt.emoji ? <span style={{ marginRight: 6 }}>{opt.emoji}</span> : null}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function MultiChoiceGrid({
  options,
  selected,
  primaryColor,
  onToggle,
  onValidate,
}: {
  options: Choice[];
  selected: string[];
  primaryColor: string;
  onToggle: (v: string) => void;
  onValidate: () => void;
}) {
  return (
    <div style={{ paddingLeft: 36 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.map((opt) => {
          const isSel = selected.includes(opt.value);
          return (
            <button
              key={opt.value}
              onClick={() => onToggle(opt.value)}
              style={{
                background: isSel ? primaryColor : "white",
                color: isSel ? "white" : primaryColor,
                border: `1.5px solid ${primaryColor}`,
                borderRadius: 10,
                padding: "10px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {isSel ? "✓ " : opt.emoji ? `${opt.emoji} ` : ""}
              {opt.label}
            </button>
          );
        })}
      </div>
      <button
        onClick={onValidate}
        disabled={selected.length === 0}
        style={{
          marginTop: 12,
          background: primaryColor,
          color: "white",
          border: "none",
          borderRadius: 10,
          padding: "10px 22px",
          fontSize: 13,
          fontWeight: 700,
          cursor: selected.length === 0 ? "not-allowed" : "pointer",
          opacity: selected.length === 0 ? 0.5 : 1,
          fontFamily: "inherit",
        }}
      >
        Valider →
      </button>
    </div>
  );
}

function FreeInput({
  question,
  value,
  primaryColor,
  onChange,
  onSubmit,
}: {
  question: Question;
  value: string;
  primaryColor: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      style={{ display: "flex", gap: 8, paddingLeft: 36 }}
    >
      <input
        type={question.type === "number" ? "number" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={question.placeholder ?? ""}
        min={question.min}
        max={question.max}
        autoFocus
        style={{
          flex: 1,
          padding: "12px 14px",
          border: `1.5px solid #cbd5e1`,
          borderRadius: 10,
          fontSize: 14,
          outline: "none",
          fontFamily: "inherit",
        }}
        onFocus={(e) => {
          (e.target as HTMLInputElement).style.borderColor = primaryColor;
        }}
        onBlur={(e) => {
          (e.target as HTMLInputElement).style.borderColor = "#cbd5e1";
        }}
      />
      <button
        type="submit"
        disabled={!value.trim()}
        style={{
          background: primaryColor,
          color: "white",
          border: "none",
          borderRadius: 10,
          padding: "12px 22px",
          fontSize: 13,
          fontWeight: 700,
          cursor: !value.trim() ? "not-allowed" : "pointer",
          opacity: !value.trim() ? 0.5 : 1,
          fontFamily: "inherit",
        }}
      >
        Suivant →
      </button>
    </form>
  );
}

function ResultCard({
  result,
  answers,
  primaryColor,
  cabinetName,
  ctaUrl,
  ctaLabel,
  leadStatus,
  leadError,
  onSubmitLead,
  onReset,
}: {
  result: Result;
  answers: Answers;
  primaryColor: string;
  cabinetName: string;
  ctaUrl: string;
  ctaLabel: string;
  leadStatus: LeadStatus;
  leadError: string | null;
  onSubmitLead: (form: {
    visitor_name: string;
    visitor_email: string;
    visitor_phone: string;
    consentement: boolean;
  }) => void;
  onReset: () => void;
}) {
  const fmt = (n?: number | null) =>
    n != null && Number.isFinite(n)
      ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)
      : "—";

  // Cas 1 — Pas d'estimation disponible : on propose direct le contact cabinet
  if (!result.available || !result.prix_m2_median) {
    return (
      <ChatBubble role="bot" primaryColor={primaryColor}>
        Je n&apos;ai pas pu estimer ce bien automatiquement.
        <br />
        Contactez directement <strong>{cabinetName}</strong> pour une analyse
        personnalisée :
        <div style={{ marginTop: 12 }}>
          <a
            href={ctaUrl}
            style={{
              display: "inline-block",
              background: primaryColor,
              color: "white",
              padding: "10px 18px",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 13,
              textDecoration: "none",
            }}
          >
            {ctaLabel}
          </a>
        </div>
      </ChatBubble>
    );
  }

  return (
    <>
      <ChatBubble role="bot" primaryColor={primaryColor}>
        Voici l&apos;estimation pour <strong>{result.address}</strong> :
      </ChatBubble>
      <div
        style={{
          background: `linear-gradient(135deg, ${primaryColor}10 0%, ${primaryColor}25 100%)`,
          padding: 24,
          borderRadius: 12,
          textAlign: "center",
          margin: "12px 0 12px 36px",
          border: `1px solid ${primaryColor}40`,
        }}
      >
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            color: primaryColor,
            fontWeight: 700,
            marginBottom: 6,
            letterSpacing: "0.05em",
          }}
        >
          Estimation marché
        </div>
        <div style={{ fontSize: 34, fontWeight: 800, color: primaryColor }}>
          {fmt(result.prix_total_median)} €
        </div>
        <div style={{ fontSize: 13, color: "#475569", marginTop: 6 }}>
          {fmt(result.prix_m2_median)} €/m²
          {result.nb_ventes ? ` · ${result.nb_ventes} ventes DVF` : ""}
        </div>
        {result.prix_m2_p10 && result.prix_m2_p90 && answers.surface ? (
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
              value={`${fmt(Math.round(result.prix_m2_p10 * Number(answers.surface)))} €`}
            />
            <SmallStat label="Médiane" value={`${fmt(result.prix_total_median)} €`} />
            <SmallStat
              label="Plafond"
              value={`${fmt(Math.round(result.prix_m2_p90 * Number(answers.surface)))} €`}
            />
          </div>
        ) : null}
      </div>

      {/* ───────────── État : lead-sent (succès, message confirmation) ───────────── */}
      {leadStatus === "lead-sent" ? (
        <>
          <ChatBubble role="bot" primaryColor={primaryColor}>
            ✅ <strong>Votre rapport détaillé vient d&apos;être envoyé par email.</strong>
            <br />
            <span style={{ fontSize: 13 }}>
              {cabinetName} a également reçu votre estimation et vous recontactera{" "}
              <strong>sous 24h ouvrées</strong> pour affiner gratuitement avec une visite
              physique (état réel, étage exact, exposition, prestations).
            </span>
          </ChatBubble>
          <div style={{ paddingLeft: 36, marginTop: 12, marginBottom: 12 }}>
            <a
              href={ctaUrl}
              style={{
                display: "inline-block",
                background: primaryColor,
                color: "white",
                padding: "12px 22px",
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 14,
                textDecoration: "none",
              }}
            >
              Découvrir {cabinetName} →
            </a>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onReset();
              }}
              style={{
                marginLeft: 12,
                color: "#64748b",
                fontSize: 12,
                textDecoration: "underline",
              }}
            >
              Nouvelle estimation
            </a>
          </div>
        </>
      ) : (
        /* ───────────── État : result / lead-form / lead-sending / lead-error ───────────── */
        <>
          <ChatBubble role="bot" primaryColor={primaryColor}>
            Cette estimation est <strong>indicative</strong>. Pour recevoir le{" "}
            <strong>rapport détaillé par email</strong> et être recontacté(e) gratuitement
            par un expert <strong>{cabinetName}</strong> sous 24h ouvrées, complétez vos
            coordonnées :
          </ChatBubble>
          <LeadCaptureForm
            primaryColor={primaryColor}
            cabinetName={cabinetName}
            disabled={leadStatus === "lead-sending"}
            sending={leadStatus === "lead-sending"}
            errorCode={leadStatus === "lead-error" ? leadError : null}
            onSubmit={onSubmitLead}
            onReset={onReset}
          />
        </>
      )}
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Formulaire capture lead
// ──────────────────────────────────────────────────────────────────────────────

function LeadCaptureForm({
  primaryColor,
  cabinetName,
  disabled,
  sending,
  errorCode,
  onSubmit,
  onReset,
}: {
  primaryColor: string;
  cabinetName: string;
  disabled: boolean;
  sending: boolean;
  errorCode: string | null;
  onSubmit: (form: {
    visitor_name: string;
    visitor_email: string;
    visitor_phone: string;
    consentement: boolean;
  }) => void;
  onReset: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [touched, setTouched] = useState(false);

  const nameValid = name.trim().length >= 2;
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = nameValid && emailValid && consent && !disabled;

  const errorMessage =
    errorCode === "invalid_email"
      ? "Email invalide."
      : errorCode === "name_required"
        ? "Nom requis."
        : errorCode === "consent_required"
          ? "Consentement RGPD requis."
          : errorCode === "cabinet_not_found"
            ? "Cabinet non trouvé."
            : errorCode
              ? "Impossible d'envoyer pour le moment. Réessayez."
              : null;

  return (
    <div
      style={{
        marginLeft: 36,
        marginTop: 12,
        marginBottom: 16,
        background: "white",
        border: `1px solid ${primaryColor}30`,
        borderRadius: 12,
        padding: 16,
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!canSubmit) return;
          onSubmit({
            visitor_name: name.trim(),
            visitor_email: email.trim(),
            visitor_phone: phone.trim(),
            consentement: consent,
          });
        }}
        style={{ display: "flex", flexDirection: "column", gap: 10 }}
      >
        <FormField
          label="Nom complet"
          required
          error={touched && !nameValid ? "Min. 2 caractères" : null}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jean Dupont"
            autoComplete="name"
            disabled={disabled}
            style={inputBoxStyle(primaryColor)}
          />
        </FormField>

        <FormField
          label="Email"
          required
          error={touched && !emailValid ? "Email invalide" : null}
        >
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="jean.dupont@email.com"
            autoComplete="email"
            disabled={disabled}
            style={inputBoxStyle(primaryColor)}
          />
        </FormField>

        <FormField label="Téléphone (optionnel)">
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="06 12 34 56 78"
            autoComplete="tel"
            disabled={disabled}
            style={inputBoxStyle(primaryColor)}
          />
        </FormField>

        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            fontSize: 12,
            color: "#475569",
            cursor: "pointer",
            marginTop: 4,
            lineHeight: 1.45,
          }}
        >
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={disabled}
            style={{ marginTop: 2, accentColor: primaryColor }}
          />
          <span>
            J&apos;accepte que <strong>{cabinetName}</strong> et DATAMERRY traitent mes
            coordonnées pour me recontacter au sujet de mon estimation. Données conservées
            36 mois max, droits d&apos;accès/suppression sur simple demande.{" "}
            {touched && !consent && (
              <span style={{ color: "#dc2626", fontWeight: 600 }}>(requis)</span>
            )}
          </span>
        </label>

        {errorMessage && (
          <div
            style={{
              background: "#fef2f2",
              color: "#991b1b",
              padding: 10,
              borderRadius: 8,
              fontSize: 12,
              border: "1px solid #fecaca",
            }}
          >
            {errorMessage}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          style={{
            background: canSubmit ? primaryColor : "#cbd5e1",
            color: "white",
            border: "none",
            borderRadius: 10,
            padding: "12px 22px",
            fontSize: 14,
            fontWeight: 700,
            cursor: canSubmit ? "pointer" : "not-allowed",
            marginTop: 6,
            fontFamily: "inherit",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
          }}
        >
          {sending ? (
            <>
              <span
                style={{
                  display: "inline-block",
                  width: 14,
                  height: 14,
                  border: "2px solid rgba(255,255,255,0.4)",
                  borderTopColor: "white",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />
              Envoi en cours…
            </>
          ) : (
            <>Recevoir mon rapport →</>
          )}
        </button>
      </form>

      <div style={{ textAlign: "center", marginTop: 12 }}>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onReset();
          }}
          style={{
            color: "#94a3b8",
            fontSize: 11,
            textDecoration: "underline",
          }}
        >
          Recommencer une estimation
        </a>
      </div>
    </div>
  );
}

function FormField({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        style={{
          display: "block",
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          color: "#64748b",
          marginBottom: 5,
        }}
      >
        {label}
        {required && <span style={{ color: "#dc2626" }}> *</span>}
      </label>
      {children}
      {error && (
        <div style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{error}</div>
      )}
    </div>
  );
}

function inputBoxStyle(primary: string): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    background: "white",
    color: "#0f172a",
    boxSizing: "border-box",
    // focus géré via JS si on veut animation, sinon natif suffit
    accentColor: primary,
  };
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          color: "#64748b",
          letterSpacing: "0.05em",
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
        {value}
      </div>
    </div>
  );
}

// Petite fonction utilitaire pour assombrir une couleur hex
function shade(hex: string, percent: number): string {
  const f = parseInt(hex.slice(1), 16);
  const t = percent < 0 ? 0 : 255;
  const p = percent < 0 ? percent * -1 : percent;
  const R = f >> 16;
  const G = (f >> 8) & 0x00ff;
  const B = f & 0x0000ff;
  return (
    "#" +
    (
      0x1000000 +
      (Math.round((t - R) * (p / 100)) + R) * 0x10000 +
      (Math.round((t - G) * (p / 100)) + G) * 0x100 +
      (Math.round((t - B) * (p / 100)) + B)
    )
      .toString(16)
      .slice(1)
  );
}
