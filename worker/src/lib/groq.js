// Groq chat completions, reached through Cloudflare AI Gateway — the writing
// steps of an Auto Film (Idea, World, sheet prompts, Shot list, Cue sheet) are
// direct LLM calls here, chosen for speed (CONTEXT.md › Auto).
//
// Runs on StorySeam's OWN key (ADR 0003): `GROQ_API_KEY` is a Worker secret, no
// author ever supplies one. `GROQ_GATEWAY_URL` is the gateway's Groq base,
//   https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/groq
// so every call shows up in AI Gateway's logs/analytics/limits. Unset, we fall
// back to Groq's direct OpenAI-compatible base — fine for dev, but prod should
// always go through the gateway.
//
// The endpoint is OpenAI-compatible: POST <base>/chat/completions.

export const GROQ_DIRECT_BASE = "https://api.groq.com/openai/v1";

// One constant: Qwen 3.8 27B on Groq (a Groq *preview* model — evaluation
// grade, may change). Qwen3 reasons before it answers, so its reasoning is
// asked to be hidden (`reasoning_format`) and any <think> block that slips
// through is stripped before JSON is parsed.
export const GROQ_DEFAULT_MODEL = "qwen/qwen3.8-27b";

// Per-model output ceilings. A request above the ceiling is refused outright by
// Groq, so a caller asking for more is clamped rather than failed.
export const GROQ_MAX_COMPLETION = {
  "qwen/qwen3.8-27b": 16384,
};

const isReasoningModel = (model) => /qwen3|gpt-oss|deepseek-r1/i.test(model);

// Qwen3 can emit its thinking inline as <think>…</think> ahead of the answer.
export function stripThinking(text) {
  return String(text).replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

export class GroqError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "GroqError";
    this.status = status;
    this.body = body;
  }
}

export function groqBase(env) {
  return String(env?.GROQ_GATEWAY_URL || GROQ_DIRECT_BASE).trim().replace(/\/+$/, "");
}

// → the assistant's text. `json: true` asks for a JSON object
// (response_format json_object) — use groqJSON to also parse it.
export async function groqChat(
  env,
  { messages, model = GROQ_DEFAULT_MODEL, json = false, maxTokens, temperature, signal } = {},
) {
  const key = env?.GROQ_API_KEY;
  if (!key) throw new GroqError("GROQ_API_KEY is not set on the Worker — Auto's writing steps cannot run", { status: 503 });
  if (!Array.isArray(messages) || !messages.length) throw new GroqError("groqChat needs at least one message");

  const body = { model, messages };
  if (json) body.response_format = { type: "json_object" };
  if (maxTokens) body.max_completion_tokens = Math.min(maxTokens, GROQ_MAX_COMPLETION[model] ?? maxTokens);
  if (isReasoningModel(model) && /qwen/i.test(model)) body.reasoning_format = "hidden";
  if (temperature != null) body.temperature = temperature;

  const res = await fetch(`${groqBase(env)}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text.slice(0, 500);
    try { msg = JSON.parse(text)?.error?.message || msg; } catch { /* not JSON */ }
    throw new GroqError(`Groq ${res.status}: ${msg}`, { status: res.status, body: text });
  }
  let data;
  try { data = JSON.parse(text); } catch {
    throw new GroqError("Groq returned a non-JSON response", { status: res.status, body: text });
  }
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string") throw new GroqError("Groq returned no message content", { status: res.status, body: text });
  if (choice.finish_reason === "length") {
    throw new GroqError("Groq answer was cut off at the output limit (finish_reason=length)", { status: res.status, body: text });
  }
  return stripThinking(content);
}

// JSON-mode helper → the parsed object. Tolerates a ```json fence.
export async function groqJSON(env, opts = {}) {
  const text = await groqChat(env, { ...opts, json: true });
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new GroqError("Groq JSON-mode answer did not parse", { body: text });
  }
}
