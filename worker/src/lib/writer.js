// The model an Auto Film's writing steps (Idea, World, sheet prompts, Shot list,
// Cue sheet) are written by — one seam, so the provider is a setting.
//
// Three providers, picked by the `AUTO_WRITER` Worker var:
//   workers-ai (default) — Kimi K2.6 through the Worker's `AI` binding and the
//                          account's AI Gateway (`default`); no key to manage.
//   groq                 — `groq.js`; needs `GROQ_API_KEY` (+ `GROQ_GATEWAY_URL`).
//   cerebras             — Qwen 3.8 27B; needs `CEREBRAS_API_KEY`, and
//                          `CEREBRAS_GATEWAY_URL` to go through AI Gateway.

import { groqJSON, stripThinking } from "./groq.js";

export const WORKERS_AI_WRITER_MODEL = "@cf/moonshotai/kimi-k2.6";
// Workers AI clips an answer at a small default unless asked for more, and a
// whole Shot list comes back in one answer.
const WORKERS_AI_MAX_TOKENS = 32000;

export const CEREBRAS_WRITER_MODEL = "qwen-3.8-27b";
export const CEREBRAS_DIRECT_BASE = "https://api.cerebras.ai/v1";
const CEREBRAS_MAX_TOKENS = 32000;

export const WRITERS = ["workers-ai", "groq", "cerebras"];

export function writerProvider(env) {
  const want = String(env?.AUTO_WRITER || "workers-ai").trim().toLowerCase();
  return WRITERS.includes(want) ? want : "workers-ai";
}

// The Worker secret each provider needs, if any (the availability check reads it).
export function writerKey(env) {
  return { groq: "GROQ_API_KEY", cerebras: "CEREBRAS_API_KEY" }[writerProvider(env)] || null;
}

export class WriterError extends Error {
  constructor(message, { body } = {}) {
    super(message);
    this.name = "WriterError";
    this.body = body;
  }
}

// A model's answer → the JSON object inside it. Tolerates reasoning blocks,
// ```json fences and prose around the object.
export function parseJSONAnswer(text) {
  const cleaned = stripThinking(text).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through to the outermost object */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { /* reported below */ }
  }
  throw new WriterError("The writing model's answer did not parse as JSON", { body: String(text).slice(0, 2000) });
}

async function workersAIJSON(env, { messages, maxTokens, temperature } = {}) {
  if (!env?.AI?.run) throw new WriterError("The Worker has no AI binding — Auto's writing steps cannot run");
  const inputs = {
    messages: [
      ...messages,
      { role: "system", content: "Answer with ONE JSON object and nothing else — no prose, no code fence." },
    ],
    max_tokens: Math.min(maxTokens || WORKERS_AI_MAX_TOKENS, WORKERS_AI_MAX_TOKENS),
  };
  if (temperature != null) inputs.temperature = temperature;
  const gateway = { id: env.AI_GATEWAY_ID || "default" };
  const out = await env.AI.run(WORKERS_AI_WRITER_MODEL, inputs, { gateway });

  // Newer Workers AI models answer in the OpenAI shape; older ones as { response }.
  const choice = out?.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new WriterError("The writing model's answer was cut off at the output limit");
  }
  const content = choice?.message?.content ?? out?.response;
  if (content && typeof content === "object") return content;
  if (typeof content !== "string" || !content.trim()) {
    throw new WriterError("The writing model returned no answer", { body: JSON.stringify(out).slice(0, 2000) });
  }
  return parseJSONAnswer(content);
}

async function cerebrasJSON(env, { messages, maxTokens, temperature, signal } = {}) {
  const key = env?.CEREBRAS_API_KEY;
  if (!key) throw new WriterError("CEREBRAS_API_KEY is not set on the Worker — Auto's writing steps cannot run");
  const base = String(env?.CEREBRAS_GATEWAY_URL || CEREBRAS_DIRECT_BASE).trim().replace(/\/+$/, "");
  const body = {
    model: CEREBRAS_WRITER_MODEL,
    messages,
    response_format: { type: "json_object" },
    max_completion_tokens: Math.min(maxTokens || CEREBRAS_MAX_TOKENS, CEREBRAS_MAX_TOKENS),
  };
  if (temperature != null) body.temperature = temperature;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 500);
    try { msg = JSON.parse(text)?.error?.message || JSON.parse(text)?.message || msg; } catch { /* not JSON */ }
    throw new WriterError(`Cerebras ${res.status}: ${msg}`, { body: text });
  }
  let data;
  try { data = JSON.parse(text); } catch { throw new WriterError("Cerebras returned a non-JSON response", { body: text }); }
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === "length") throw new WriterError("The writing model's answer was cut off at the output limit");
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new WriterError("Cerebras returned no answer", { body: text.slice(0, 2000) });
  return parseJSONAnswer(content);
}

// What the Film job is handed as `model`: { json(opts) → object }.
export function writerModel(env) {
  const provider = writerProvider(env);
  if (provider === "groq") return { json: (opts) => groqJSON(env, opts) };
  if (provider === "cerebras") return { json: (opts) => cerebrasJSON(env, opts) };
  return { json: (opts) => workersAIJSON(env, opts) };
}
