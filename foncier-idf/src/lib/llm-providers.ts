/**
 * Abstraction LLM avec fallback Groq → Cerebras → dégradation.
 *
 * Anthropic interdit dans le hot path (coût). Les deux providers ci-dessous
 * sont OpenAI-compatible, donc le wire format est identique.
 *
 * - Groq Llama 3.1 8B  → primaire, latence ~150ms, $0.05/M in
 * - Cerebras Llama 3.1 → fallback, infra indépendante, ~même tarif
 * - Dégradation       → on renvoie l'input non-réordonné si tout échoue
 */

import type { BanResult } from "./ban";

export type RerankResult = {
  results: BanResult[];
  provider: "groq" | "cerebras" | "degraded";
};

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
    model: "llama-3.1-8b-instant",
    apiKey: process.env.GROQ_API_KEY,
  },
  {
    name: "cerebras",
    url: "https://api.cerebras.ai/v1/chat/completions",
    model: "llama3.1-8b",
    apiKey: process.env.CEREBRAS_API_KEY,
  },
];

const SYSTEM_PROMPT = `Tu es un expert en adresses françaises. L'utilisateur cherche une adresse précise. Tu reçois une liste de candidats indexés (0-based) issus de la BAN. Renvoie UNIQUEMENT un JSON {"order": [index1, index2, ...]} où chaque index est la position du candidat dans la liste, classés du plus pertinent au moins pertinent. Aucune explication, aucun texte hors JSON.`;

function buildUserPrompt(query: string, candidates: BanResult[]): string {
  const lines = candidates.map(
    (c, i) => `${i}: ${c.label} (score BAN: ${c.score.toFixed(2)})`,
  );
  return `Requête: "${query}"\nCandidats:\n${lines.join("\n")}`;
}

async function callProvider(
  p: Provider,
  query: string,
  candidates: BanResult[],
): Promise<number[]> {
  if (!p.apiKey) throw new Error(`${p.name}: API key manquante`);

  const resp = await fetch(p.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${p.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: p.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(query, candidates) },
      ],
    }),
    signal: AbortSignal.timeout(4000),
  });

  if (!resp.ok) {
    throw new Error(`${p.name} HTTP ${resp.status}: ${await resp.text().catch(() => "")}`);
  }

  const data = (await resp.json()) as {
    choices: { message: { content: string } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error(`${p.name}: réponse vide`);

  const parsed = JSON.parse(content) as { order?: unknown };
  if (!Array.isArray(parsed.order)) {
    throw new Error(`${p.name}: champ "order" absent ou invalide`);
  }

  const order = parsed.order
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0 && n < candidates.length);

  if (order.length === 0) {
    throw new Error(`${p.name}: aucun index valide`);
  }
  return order;
}

export async function rerankCandidates(
  query: string,
  candidates: BanResult[],
): Promise<RerankResult> {
  if (candidates.length === 0) {
    return { results: [], provider: "degraded" };
  }

  for (const p of PROVIDERS) {
    if (!p.apiKey) continue;
    try {
      const order = await callProvider(p, query, candidates);
      // Reconstruct ordered list, then append any missing candidate at the end.
      const seen = new Set<number>();
      const ordered: BanResult[] = [];
      for (const idx of order) {
        if (!seen.has(idx)) {
          ordered.push(candidates[idx]);
          seen.add(idx);
        }
      }
      for (let i = 0; i < candidates.length; i++) {
        if (!seen.has(i)) ordered.push(candidates[i]);
      }
      return { results: ordered, provider: p.name };
    } catch (err) {
      console.warn(`[llm-rerank] ${p.name} échoué :`, err);
    }
  }

  return { results: candidates, provider: "degraded" };
}
