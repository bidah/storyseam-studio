// The model an Auto Film's writing steps (Idea, World, sheet prompts, Shot list,
// Cue sheet) are written by — one seam, so the provider is a setting.
//
// Three providers, picked by the `AUTO_WRITER` Worker var:
//   workers-ai (default) — Kimi K2.6 through the Worker's `AI` binding and the
//                          account's AI Gateway (`default`); no key to manage.
//   groq                 — `groq.js`; needs `GROQ_API_KEY` (+ `GROQ_GATEWAY_URL`).
//   cerebras             — Qwen 3.8 27B; needs `CEREBRAS_API_KEY`, and
//                          `CEREBRAS_GATEWAY_URL` to go through AI Gateway.
//
// That is the LEGACY `default` writer: a Film started before the writer was
// explicit stored none and keeps running on it. Every new Film names its writer
// (film-plan.ts FILM_WRITERS, `job.writer`): `qwen` — Qwen 3.8 27B on Workers AI
// (the default; plain Cloudflare, no Cerebras), `kimi` — Kimi K2.6 on Workers
// AI, or `claude` — Claude Fable 5.1 through the
// `AI` binding and AI Gateway's Unified Billing — Cloudflare holds the Anthropic
// credential and bills the account's gateway credits, so there is no key to set.
// Unified Billing needs an AUTHENTICATED gateway, which `default` is not; the
// Look stage's `auto-look` is, so Claude goes through that one.

import { groqJSON, stripThinking } from "./groq.js";

export const WORKERS_AI_WRITER_MODEL = "@cf/moonshotai/kimi-k2.6";
export const WORKERS_AI_QWEN_MODEL = "@cf/qwen/qwen3.8-27b";
// Workers AI clips an answer at a small default unless asked for more, and a
// whole Shot list comes back in one answer.
const WORKERS_AI_MAX_TOKENS = 32000;

export const CEREBRAS_WRITER_MODEL = "qwen-3.8-27b";
export const CEREBRAS_DIRECT_BASE = "https://api.cerebras.ai/v1";
const CEREBRAS_MAX_TOKENS = 32000;

export const CLAUDE_WRITER_MODEL = "anthropic/claude-fable-5.1";
export const CLAUDE_GATEWAY = "auto-look";
const CLAUDE_MAX_TOKENS = 32000;

export const WRITERS = ["workers-ai", "groq", "cerebras"];

export function writerProvider(env) {
  const want = String(env?.AUTO_WRITER || "workers-ai").trim().toLowerCase();
  return WRITERS.includes(want) ? want : "workers-ai";
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

async function workersAIJSON(env, { messages, maxTokens, temperature } = {}, model = WORKERS_AI_WRITER_MODEL) {
  if (!env?.AI?.run) throw new WriterError("The Worker has no AI binding — Auto's writing steps cannot run");
  const inputs = {
    messages: [
      ...messages,
      { role: "system", content: "Answer with ONE JSON object and nothing else — no prose, no code fence." },
    ],
    max_tokens: Math.min(maxTokens || WORKERS_AI_MAX_TOKENS, WORKERS_AI_MAX_TOKENS),
  };
  if (temperature != null) inputs.temperature = temperature;
  if (model === WORKERS_AI_QWEN_MODEL) {
    // Qwen 3.8 reasons at `xhigh` by default, and the reasoning spends the same
    // completion budget (see cerebrasJSON). Off, with the JSON mode on, it
    // answers the object straight (verified 2026-09-28).
    inputs.chat_template_kwargs = { enable_thinking: false };
    inputs.response_format = { type: "json_object" };
  }
  const gateway = { id: env.AI_GATEWAY_ID || "default" };
  const out = await env.AI.run(model, inputs, { gateway });

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
    // Qwen 3.8 reasons before it answers, and the reasoning spends the SAME
    // completion budget: on a sheets request it burned 5.4k of 8k tokens
    // thinking and the JSON was cut off. The writing steps don't need it, and
    // without it they are faster.
    disable_reasoning: true,
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

async function claudeJSON(env, { messages, maxTokens, temperature } = {}) {
  if (!env?.AI?.run) throw new WriterError("The Worker has no AI binding — Claude cannot write this Film");
  // The Messages API takes the system prompt beside the turns, not among them.
  const system = [
    ...messages.filter((m) => m.role === "system").map((m) => m.content),
    "Answer with ONE JSON object and nothing else — no prose, no code fence.",
  ].join("\n\n");
  const inputs = {
    system,
    messages: messages.filter((m) => m.role !== "system"),
    max_tokens: Math.min(maxTokens || CLAUDE_MAX_TOKENS, CLAUDE_MAX_TOKENS),
  };
  // No `temperature`: Fable 5.1 refuses the parameter outright — any value comes
  // back from the binding as "7003: User Input Error" (verified 2026-09-27), which
  // stopped every Claude-written Film at its World.
  const out = await env.AI.run(env.CLAUDE_WRITER_MODEL || CLAUDE_WRITER_MODEL, inputs, {
    gateway: { id: env.CLAUDE_GATEWAY_ID || env.LOOK_GATEWAY_ID || CLAUDE_GATEWAY },
  });
  if (out?.stop_reason === "max_tokens") {
    throw new WriterError("The writing model's answer was cut off at the output limit");
  }
  const content = Array.isArray(out?.content)
    ? out.content.filter((b) => b?.type === "text").map((b) => b.text).join("")
    : out?.choices?.[0]?.message?.content ?? out?.response;
  if (typeof content !== "string" || !content.trim()) {
    throw new WriterError("Claude returned no answer", { body: JSON.stringify(out).slice(0, 2000) });
  }
  return parseJSONAnswer(content);
}

// The same writer as a flue MODEL SPECIFIER, for the steps that run as flue
// agents (a Deep Film's writers' room passes, flue-agent/src/agents/writers-room.ts):
// the Film's pick, never another. Groq has no flue provider, so a Groq default
// reads the room on Kimi. Keep in lockstep with ROOM_MODELS in
// flue-agent/src/lib/models.ts, which refuses any other specifier.
export const AGENT_WRITER_MODELS = {
  claude: "cloudflare/anthropic/claude-fable-5.1",
  qwen: `cloudflare/${WORKERS_AI_QWEN_MODEL}`,
  kimi: `cloudflare/${WORKERS_AI_WRITER_MODEL}`,
  "workers-ai": `cloudflare/${WORKERS_AI_WRITER_MODEL}`,
  cerebras: `cerebras/${CEREBRAS_WRITER_MODEL}`,
};
// The Film writers a job names outright; anything else is the legacy AUTO_WRITER.
const EXPLICIT_WRITERS = ["claude", "qwen", "kimi"];
export function agentWriterModel(env, writer = null) {
  if (EXPLICIT_WRITERS.includes(writer)) return AGENT_WRITER_MODELS[writer];
  return AGENT_WRITER_MODELS[writerProvider(env)] || AGENT_WRITER_MODELS["workers-ai"];
}

// What the Film job is handed as `model`: { json(opts) → object }. `writer` is
// the Film's pick (`job.writer`); absent or `default` is the Worker's AUTO_WRITER.
export function writerModel(env, writer = null) {
  if (writer === "claude") return { json: (opts) => claudeJSON(env, opts) };
  if (writer === "qwen") return { json: (opts) => workersAIJSON(env, opts, WORKERS_AI_QWEN_MODEL) };
  if (writer === "kimi") return { json: (opts) => workersAIJSON(env, opts, WORKERS_AI_WRITER_MODEL) };
  const provider = writerProvider(env);
  if (provider === "groq") return { json: (opts) => groqJSON(env, opts) };
  if (provider === "cerebras") return { json: (opts) => cerebrasJSON(env, opts) };
  return { json: (opts) => workersAIJSON(env, opts) };
}
