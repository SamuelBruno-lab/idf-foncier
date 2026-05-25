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
    options: [
      { value: "Appartement", label: "Appartement", emoji: "🏢" },
      { value: "Maison", label: "Maison", emoji: "🏡" },
      { value: "Terrain", label: "Terrain", emoji: "🌳" },
      { value: "Commerce", label: "Commerce", emoji: "🏪" },
      { value: "Tertiaire", label: "Bureaux / Entrepôt", emoji: "🏬" },
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
    label: "Quelle est la surface (en m²) ?",
    type: "number",
    placeholder: "62",
    unit: "m²",
    min: 8,
    max: 50000, // élargi pour terrains
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
    // Un terrain nu n'a pas d'année de construction
    skipIf: (a) => String(a.type_bien) === "Terrain",
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
    // Pas de DPE pour un terrain (et DPE tertiaire trop rare pour l'usage grand public)
    skipIf: (a) => String(a.type_bien) === "Terrain",
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
    skipIf: (a) => String(a.type_bien) === "Terrain",
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
    skipIf: (a) => String(a.type_bien) === "Terrain",
  },
  // ─────────────── Usage : 3 variantes selon le type de bien ───────────────
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
    // Uniquement pour les biens résidentiels
    skipIf: (a) => !["Appartement", "Maison"].includes(String(a.type_bien)),
  },
  {
    id: "usage_pro",
    label: "Quel type d'activité dans le local ?",
    type: "single-choice",
    options: [
      { value: "vente-detail", label: "Vente / commerce de détail", emoji: "🛍️" },
      { value: "restauration", label: "Restauration / bar", emoji: "🍽️" },
      { value: "bureau", label: "Bureau / profession libérale", emoji: "💼" },
      { value: "medical", label: "Médical / paramédical", emoji: "🩺" },
      { value: "atelier-stockage", label: "Atelier / stockage / logistique", emoji: "📦" },
      { value: "autre", label: "Autre activité", emoji: "—" },
    ],
    skipIf: (a) => !["Commerce", "Tertiaire"].includes(String(a.type_bien)),
  },
  {
    id: "usage_terrain",
    label: "Quel projet envisagez-vous pour ce terrain ?",
    type: "single-choice",
    options: [
      { value: "maison-individuelle", label: "Construction maison individuelle", emoji: "🏡" },
      { value: "collectif", label: "Construction collectif / immeuble", emoji: "🏢" },
      { value: "amenagement", label: "Aménagement / lotissement", emoji: "🌳" },
      { value: "agricole", label: "Usage agricole / naturel", emoji: "🌾" },
      { value: "inconnu", label: "Je ne sais pas encore", emoji: "❔" },
    ],
    skipIf: (a) => String(a.type_bien) !== "Terrain",
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
        return;
      }
      setResult((await res.json()) as Result);
    } catch {
      setResult({ available: false });
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setAnswers({});
    setHistory([]);
    setCurrentStepIdx(0);
    setCurrentInput("");
    setCurrentMulti([]);
    setResult(null);
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

        {/* Résultat final */}
        {isFinished && result && !loading && (
          <ResultCard
            result={result}
            answers={answers}
            primaryColor={primaryColor}
            cabinetName={cabinetName}
            ctaUrl={ctaUrl}
            ctaLabel={ctaLabel}
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
  onReset,
}: {
  result: Result;
  answers: Answers;
  primaryColor: string;
  cabinetName: string;
  ctaUrl: string;
  ctaLabel: string;
  onReset: () => void;
}) {
  const fmt = (n?: number | null) =>
    n != null && Number.isFinite(n)
      ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)
      : "—";

  if (!result.available || !result.prix_m2_median) {
    return (
      <ChatBubble role="bot" primaryColor={primaryColor}>
        Je n'ai pas pu estimer ce bien automatiquement.
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
        Voici l'estimation pour <strong>{result.address}</strong> :
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
          <div style={{ display: "flex", justifyContent: "space-around", marginTop: 16, paddingTop: 12, borderTop: "1px solid rgba(0,0,0,0.05)" }}>
            <SmallStat
              label="Plancher"
              value={`${fmt(Math.round(result.prix_m2_p10 * Number(answers.surface)))} €`}
            />
            <SmallStat
              label="Médiane"
              value={`${fmt(result.prix_total_median)} €`}
            />
            <SmallStat
              label="Plafond"
              value={`${fmt(Math.round(result.prix_m2_p90 * Number(answers.surface)))} €`}
            />
          </div>
        ) : null}
      </div>

      <ChatBubble role="bot" primaryColor={primaryColor}>
        Cette estimation est <strong>indicative</strong>. Pour affiner avec l'état
        réel du bien (visite, photos, comparables actuels), <strong>{cabinetName}</strong> vient gratuitement chez vous.
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
          {ctaLabel} →
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
  );
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
