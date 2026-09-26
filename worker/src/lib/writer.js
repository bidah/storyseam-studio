// The model an Auto Film's writing steps (Idea, World, sheet prompts, Shot list,
// Cue sheet) are written by — one seam, so the provider is a setting.
//
// Default: Kimi K2.6 on Workers AI, through the Worker's `AI` binding and the
// account's AI Gateway (`default`) — no key to manage, and the same model the
// studio's chat defaults to. Groq (`groq.js`) is kept wired for when speed
// matters more: set `AUTO_WRITER=groq` (a Worker var) and `GROQ_API_KEY`.

import { groqJSON, stripThinking } from "./groq.js";

export const WORKERS_AI_WRITER_MODEL = "@cf/moonshotai/kimi-k2.6";
// Workers AI clips an answer at a small default unless asked for more, and a
// whole Shot list comes back in one answer.
const WORKERS_AI_MAX_TOKENS = 32000;

export function writerProvider(env) {
  return String(env?.AUTO_WRITER || "workers-ai").trim().toLowerCase() === "groq" ? "groq" : "workers-ai";
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

// What the Film job is handed as `model`: { json(opts) → object }.
export function writerModel(env) {
  return writerProvider(env) === "groq"
    ? { json: (opts) => groqJSON(env, opts) }
    : { json: (opts) => workersAIJSON(env, opts) };
}
