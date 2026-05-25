/**
 * POST /api/chatbot/converse
 *
 * Body :
 *   {
 *     "messages": [
 *       { "role": "user", "content": "Combien vaut le 10 rue de rivoli 75001 ?" }
 *     ]
 *   }
 *
 * Réponse : Server-Sent Events (text/event-stream)
 *   data: {"type":"provider","name":"groq"}
 *   data: {"type":"tool_call_start","name":"estimate_property","arguments":"{\"address\":\"10 rue de rivoli\"}"}
 *   data: {"type":"tool_call_result","name":"estimate_property","result":{...}}
 *   data: {"type":"token","content":"Bonjour, "}
 *   data: {"type":"token","content":"l'estimation est "}
 *   ...
 *   data: {"type":"done"}
 *
 * Côté client : consommer via fetch() + ReadableStream (pas EventSource car POST).
 *
 * Auth : standard withApiKey (dmk_live_… ou wdmk_live_… avec domaine autorisé).
 */

import { NextRequest, NextResponse } from "next/server";

import { withApiKey, type ApiKeyRecord } from "@/lib/auth/apiKey";
import { converse, type ChatMessage, type StreamEvent } from "@/lib/chatbot/converse";

// Max user content length per message (anti-abuse + cost cap)
const MAX_MESSAGE_LEN = 2000;
const MAX_HISTORY = 20;

async function handleChatbotConverse(
  req: NextRequest,
  _ctx: { key: ApiKeyRecord },
): Promise<NextResponse> {
  // Parse + validate body
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", hint: "Body must be JSON: { messages: [...] }" },
      { status: 400 },
    );
  }

  const messages = (body as { messages?: unknown }).messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: "missing_messages", hint: "Provide at least one user message" },
      { status: 400 },
    );
  }

  // Sanitize history (max 20 messages, max 2000 chars each)
  const history: ChatMessage[] = [];
  for (const m of messages.slice(-MAX_HISTORY)) {
    const obj = m as { role?: string; content?: string };
    if (!obj.role || typeof obj.content !== "string") continue;
    if (!["user", "assistant"].includes(obj.role)) continue;
    history.push({
      role: obj.role as "user" | "assistant",
      content: obj.content.slice(0, MAX_MESSAGE_LEN),
    });
  }

  if (history.length === 0) {
    return NextResponse.json(
      { error: "no_valid_messages" },
      { status: 400 },
    );
  }

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: StreamEvent) => {
        const line = `data: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(encoder.encode(line));
        } catch {
          // controller might be closed if client disconnected
        }
      };

      try {
        await converse(history, emit);
      } catch (err) {
        emit({ type: "error", message: String(err) });
        emit({ type: "done" });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new NextResponse(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // pour les proxys (nginx, etc.)
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export const POST = withApiKey(handleChatbotConverse, {
  endpoint: "/api/chatbot/converse",
});

/**
 * CORS preflight pour l'usage chatbot embed cross-origin.
 */
export async function OPTIONS(req: NextRequest): Promise<NextResponse> {
  const origin = req.headers.get("origin") ?? "*";
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "X-API-Key, Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}
