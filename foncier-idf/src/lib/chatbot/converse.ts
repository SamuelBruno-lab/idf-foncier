/**
 * DATAMERRY Chatbot — Pipeline de raisonnement multi-tours.
 *
 * Provider primaire : Groq Llama 3.1 8B Instant
 * Provider fallback : Cerebras Llama 3.1 8B
 * (Pas d'Anthropic dans le hot path — cost constraint Samuel)
 *
 * Boucle :
 *   1. Send messages + tools au LLM
 *   2. Si tool_calls → exécuter chaque tool, append le résultat au messages
 *   3. Re-send au LLM avec le contexte enrichi
 *   4. Quand le LLM répond en texte pur (sans tool_calls) → c'est la réponse finale
 *
 * Streaming : on émet via callback chaque token de la réponse finale au fur et
 * à mesure. Les tool_calls intermédiaires sont annoncés (status events) mais
 * pas streamés (le LLM les construit en JSON, pas du texte naturel).
 */

import { TOOLS, executeTool } from "./tools";

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatMessage = {
  role: ChatRole;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  name?: string;
};

export type StreamEvent =
  | { type: "token"; content: string }
  | { type: "tool_call_start"; name: string; arguments: string }
  | { type: "tool_call_result"; name: string; result: unknown }
  | { type: "provider"; name: "groq" | "cerebras" | "degraded" }
  | { type: "done" }
  | { type: "error"; message: string };

export type StreamCallback = (event: StreamEvent) => void;

// ──────────────────────────────────────────────────────────────────────────────
// Prompt système
// ──────────────────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `Tu es l'assistant IA DATAMERRY, conseiller métier pour les professionnels de l'immobilier titulaires de la carte T (loi Hoguet) et leurs mandataires.

Ton positionnement : tu n'es PAS un calculateur statistique. Tu es un COPILOTE qui complète l'expertise terrain de l'agent — l'agent voit le bien, tu apportes les données et le raisonnement structuré.

Sources officielles françaises utilisées :
- DVF (Demandes Valeurs Foncières — ventes notariées)
- OLAP (Observatoires Locaux des Loyers — 37 agglomérations)
- ANIL (Carte des loyers France entière, fallback)
- INSEE Filosofi (socio-démo IRIS)
- Cadastre, OpenStreetMap, Mapillary
- (Bientôt : ADEME DPE, Banque de France taux, Indices Notaires)

Outils à ta disposition (à appeler quand pertinent) :
- estimate_property : estimation marché (prix/m², fourchette p10-p90, ventes DVF cluster HDBSCAN)
- compute_yield : rendement locatif brut + net estimé
- get_fiscal_zone : zone A/B/C + plafonds Jeanbrun/LLI/Loc'Avantages
- compare_rental_strategies : compare 8 scénarios locatifs en 1 appel
- neighborhood_report : écoles, transports, services, scores quartier
- get_dpe_at_address : DPE déclaré (énergie A-G, GES, kWh/m²/an) via base ADEME
- get_market_context : taux OAT actuel + moyen 12m + tendance, taux client estimé, HCSF, durée moyenne vente
- compute_market_adjusted_price : prix de mise en vente AJUSTÉ au contexte macro (OAT actuel vs historique), avec suggestions opérationnelles (prix annonce / plancher / plan B 60j)

═══════════════════════════════════════════════════════════
PROCESSUS DE CONSEIL EN 3 TEMPS — À RESPECTER STRICTEMENT
═══════════════════════════════════════════════════════════

TEMPS 1 — Adresse précise et appel des outils
• Si l'utilisateur donne une commune seule ou une adresse imprécise (sans numéro ou code postal), DEMANDE une adresse complète AVANT d'appeler les tools.
• Si la surface est requise (compare_rental_strategies, prix total) et manquante, DEMANDE-LA.
• Appelle estimate_property en priorité — c'est la base statistique de tout le reste.

TEMPS 2 — Caractéristiques du bien (modulation dans p10-p90)
Une fois la médiane cluster obtenue, ne renvoie PAS directement le chiffre brut. À la place, DEMANDE à l'agent ces caractéristiques manquantes :
• État du bien : à rénover / correct / bon / refait à neuf / neuf
• Année de construction (récent post-2010 vs ancien)
• DPE / GES (A à G — impact prix +5% à -18%)
• Étage + ascenseur (RDC = -4%, dernier sans asc = -5%, étage milieu = 0%)
• Exposition (sud/ouest +2%, nord/est -2%)
• Balcon / terrasse / jardin (+3% chacun)
• Parking / box (+3%, -4% en zone parking-tendue si absent)
• Surface habitable validée (vérifier vs carrez)

Et CONCURRENCE TERRAIN — question OBLIGATOIRE à l'agent :
"As-tu vu des biens similaires actuellement en vente dans le quartier, et à quel prix d'annonce ?"
→ Si l'agent répond, intègre ces données dans ton raisonnement (DATAMERRY ne scrape pas les annonces — c'est l'expertise terrain de l'agent qui amène cette info).

TEMPS 3 — Synthèse conservatrice et plan d'action
Renvoie alors une estimation MODULÉE avec :
• Prix médian cluster + position dans la fourchette p10-p90 (ex: "p65-p70 compte tenu de tes inputs")
• Montant absolu € arrondi (€/m² × surface)
• Contexte marché actuel (taux d'intérêt, HCSF — mentionne le contexte de marché actuel français : taux 3,5-4% sur 20 ans, HCSF max 35% endettement, banques sélectives sur les profils, durée moyenne de vente en hausse vs 2022)
• Plan d'action concret :
  - Prix d'annonce conseillé (avec marge négo 3-5%)
  - Prix plancher
  - Plan B à 60 jours si pas d'offre

═══════════════════════════════════════════════════════════
CONSIGNES TRANSVERSES
═══════════════════════════════════════════════════════════

1. Réponds en français, ton professionnel mais accessible. L'utilisateur est un agent immo, pas un particulier.
2. Quand tu compares des stratégies fiscales, ALERTE sur les warnings (horizon Jeanbrun ≥ 15 ans, amortissement réintégré à la plus-value, exonération PV 22 ans, etc.).
3. Si tu détectes une SUR-ÉVALUATION du prix d'achat indiqué par l'agent (vs prix médian DVF de la zone), DIS-LE explicitement avec le montant à négocier.
4. Formate les réponses en markdown (tableaux, listes, gras) pour lisibilité.
5. RAPPEL juridico-fiscal : Jeanbrun n'est PAS une réduction d'IR directe — c'est un AMORTISSEMENT (déduction du résultat foncier). LLI a 1.2 de cap sur le coefficient. Loc'Avantages est une réduction d'IR proportionnelle au loyer brut.
6. DATAMERRY n'utilise QUE des sources officielles publiques. Si l'agent demande "vérifie sur SeLoger", explique que tu ne peux pas (légal + jurisprudence) — mais que TU peux lui demander ce qu'il voit lui sur le marché, et l'intégrer dans ton conseil.
7. RESTE CONSERVATEUR. Mieux vaut sous-estimer légèrement et signer rapidement, que sur-évaluer et bloquer le bien 6 mois.
8. Si une donnée manque (DPE, état, etc.), DIS-LE clairement plutôt que d'inventer. Ex: "Sans le DPE je ne peux pas affiner — peux-tu le récupérer ou je dois supposer C par défaut ?"
9. Termine TOUJOURS par une suggestion d'action (PDF brandé pour le client, autre scénario à simuler, comparaison T2/T3, etc.).`;

// ──────────────────────────────────────────────────────────────────────────────
// Providers
// ──────────────────────────────────────────────────────────────────────────────

type Provider = {
  name: "groq" | "cerebras";
  url: string;
  model: string;
  apiKey: string | undefined;
};

const PROVIDERS: Provider[] = [
  {
    name: "groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: "llama-3.3-70b-versatile", // 70B pour le raisonnement chatbot (vs 8B pour rerank)
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "cerebras",
    url: "https://api.cerebras.ai/v1/chat/completions",
    model: "llama-3.3-70b",
    apiKey: process.env.CEREBRAS_API_KEY,
  },
];

const MAX_TOOL_LOOPS = 4;          // anti-boucle infinie
const COMPLETION_TIMEOUT_MS = 25_000;

// ──────────────────────────────────────────────────────────────────────────────
// Appel HTTP au provider (non-streaming pour tool calls, streaming pour final)
// ──────────────────────────────────────────────────────────────────────────────

type CompletionResponse = {
  choices: Array<{
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: ChatMessage["tool_calls"];
    };
    finish_reason: string;
  }>;
};

async function callProvider(
  p: Provider,
  messages: ChatMessage[],
  withTools: boolean,
): Promise<CompletionResponse> {
  if (!p.apiKey) throw new Error(`${p.name}: API key manquante`);

  const body: Record<string, unknown> = {
    model: p.model,
    temperature: 0.2,
    max_tokens: 1500,
    messages,
  };
  if (withTools) {
    body.tools = TOOLS;
    body.tool_choice = "auto";
  }

  const resp = await fetch(p.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
  });

  if (!resp.ok) {
    throw new Error(`${p.name} HTTP ${resp.status}: ${await resp.text().catch(() => "")}`);
  }
  return (await resp.json()) as CompletionResponse;
}

/**
 * Streaming SSE de la dernière complétion (réponse finale après tool calls).
 * Émet chaque token via le callback `onToken`.
 */
async function streamProvider(
  p: Provider,
  messages: ChatMessage[],
  onToken: (delta: string) => void,
): Promise<string> {
  if (!p.apiKey) throw new Error(`${p.name}: API key manquante`);

  const resp = await fetch(p.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: p.model,
      temperature: 0.2,
      max_tokens: 1500,
      messages,
      stream: true,
    }),
    signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`${p.name} stream HTTP ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE format : chaque event commence par "data: " et finit par "\n\n"
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onToken(delta);
        }
      } catch {
        // ignore parse errors on partial lines
      }
    }
  }
  return fullText;
}

// ──────────────────────────────────────────────────────────────────────────────
// Boucle principale — multi-tours avec tool execution
// ──────────────────────────────────────────────────────────────────────────────

export async function converse(
  userMessages: ChatMessage[],
  emit: StreamCallback,
): Promise<void> {
  // Build conversation : system + history
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...userMessages,
  ];

  // 1) Phase tool resolution : boucle jusqu'à ce que le LLM cesse de demander des tools
  let activeProvider: Provider | null = null;
  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    let completion: CompletionResponse | null = null;
    let provError: unknown = null;

    for (const p of PROVIDERS) {
      if (!p.apiKey) continue;
      try {
        completion = await callProvider(p, messages, true);
        activeProvider = p;
        if (loop === 0) emit({ type: "provider", name: p.name });
        break;
      } catch (err) {
        provError = err;
        console.warn(`[chatbot] ${p.name} failed:`, err);
      }
    }

    if (!completion) {
      emit({
        type: "error",
        message: `Aucun provider LLM disponible: ${String(provError ?? "no API key configured")}`,
      });
      emit({ type: "provider", name: "degraded" });
      emit({ type: "done" });
      return;
    }

    const msg = completion.choices[0]?.message;
    if (!msg) {
      emit({ type: "error", message: "Réponse LLM vide" });
      emit({ type: "done" });
      return;
    }

    const toolCalls = msg.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      // ✅ LLM a une réponse finale (pas de nouveaux tool_calls).
      // On a déjà la réponse complète dans msg.content — on l'émet en faux-streaming
      // (chunk par chunk) pour conserver l'UX streaming.
      const final = msg.content ?? "";
      // Petit chunk artificiel pour effet "streaming" même quand on a déjà tout en main
      for (let i = 0; i < final.length; i += 8) {
        emit({ type: "token", content: final.slice(i, i + 8) });
      }
      emit({ type: "done" });
      return;
    }

    // Le LLM veut appeler ≥ 1 tool. On exécute en parallèle.
    messages.push({
      role: "assistant",
      content: msg.content,
      tool_calls: toolCalls,
    });

    await Promise.all(
      toolCalls.map(async (tc) => {
        emit({
          type: "tool_call_start",
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
        const result = await executeTool(tc.function.name, tc.function.arguments);
        emit({ type: "tool_call_result", name: tc.function.name, result });
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          name: tc.function.name,
          content: JSON.stringify(result),
        });
      }),
    );
    // boucle → ré-appel LLM avec contexte enrichi
  }

  // 2) Sécurité : si on a dépassé MAX_TOOL_LOOPS, force une réponse finale sans tools
  if (activeProvider) {
    try {
      const final = await streamProvider(activeProvider, messages, (token) => {
        emit({ type: "token", content: token });
      });
      if (!final) emit({ type: "error", message: "Réponse finale vide après boucle tools" });
    } catch (err) {
      emit({ type: "error", message: `Stream final échoué: ${String(err)}` });
    }
  }
  emit({ type: "done" });
}
