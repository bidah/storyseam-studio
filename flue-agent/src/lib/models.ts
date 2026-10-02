// Per-turn chat-model selection.
//
// flue's HTTP prompt body is validated to `{ message, images }` and STRIPS any
// extra field (runtime `DirectAgentPayloadSchema`), and a tool/initializer gets
// no request context — so the picker's choice can't ride the prompt itself. The
// only per-conversation model lever is the agent definition's `model`, and its
// initializer re-runs on every harness init (i.e. every turn). So we persist the
// selection in this conversation's Durable Object storage: app.ts writes it
// (setModel, via DO RPC) just before admitting the prompt, and the initializer
// reads it back here as the turn's model. History stays UNIFIED — same instance
// id regardless of model.

// Default + allowed models are Cloudflare Workers AI specifiers (`cloudflare/@cf/…`):
// they run ON Cloudflare (no external provider key), are billed to the Worker
// account (with a free tier), and flue auto-routes them through Cloudflare AI
// Gateway. All of them support function calling (required for the agent's tools).
// GLM-5.3 and Qwen 3.8 are the Film writers' reasoning models, registered in the
// catalog by lib/output-cap.ts; the chat runs them at CHAT_THINKING_LEVEL.
// Keep these in lockstep with src/lib/agentModel.js + mobile-app/src/lib/agent-model.ts.
import { HIDE_EXTRA_MODELS } from "./film-plan.js";

export const DEFAULT_MODEL = "cloudflare/@cf/zai-org/glm-5.3";

// GLM-5.3 thinks at `max` and Qwen 3.8 at xhigh when no effort is sent, which
// made a single writers'-room turn think for minutes (lib/output-cap.ts). The
// chat is interactive, so those two answer at "low"; the rest keep flue's default.
const LOW_THINKING_MODELS = new Set<string>([
  "cloudflare/@cf/zai-org/glm-5.3",
  "cloudflare/@cf/qwen/qwen3.8-27b",
]);
export const chatThinkingLevel = (model: string): "low" | undefined =>
  LOW_THINKING_MODELS.has(model) ? "low" : undefined;

// The Deep Film's writers' room (agents/writers-room.ts) reads on the writer
// the author picked for the Film in the prompt box — the worker hands the
// workflow its flue specifier (worker/src/lib/writer.js agentWriterModel):
// Claude Fable through the Workers AI binding and AI Gateway's Unified Billing
// (lib/output-cap.ts routes `anthropic/…` to the authenticated gateway), GLM-5.3
// on Workers AI (the default writer), Qwen 3.8 or Kimi K2.6 on Workers AI, or — a Film
// from before the writer was explicit — the Worker's legacy AUTO_WRITER (Qwen on
// Cerebras, registered in app.ts). These are NOT chat-picker models, so they stay out of
// ALLOWED_MODELS. ROOM_MODEL is only the fallback for a room started before the
// worker sent a model — those passes were Claude.
export const ROOM_MODEL = "cloudflare/anthropic/claude-fable-5.1";
export const ROOM_MODELS = new Set<string>([
  ROOM_MODEL,
  "cloudflare/@cf/zai-org/glm-5.3",
  "cloudflare/@cf/qwen/qwen3.8-27b",
  "cloudflare/@cf/moonshotai/kimi-k2.6",
  "cerebras/qwen-3.8-27b",
]);
/** The model a room pass reads on: the Film's writer when it is one of ROOM_MODELS, else the fallback. */
export const roomModel = (model: unknown): string =>
  typeof model === "string" && ROOM_MODELS.has(model) ? model : ROOM_MODEL;

// The only model specifiers a client may select. Anything else is ignored and
// the conversation falls back to DEFAULT_MODEL, so a client can never push an
// arbitrary model string to the provider.
export const ALLOWED_MODELS = new Set<string>([
  // Cloudflare Workers AI — no external key, auto CF AI Gateway.
  "cloudflare/@cf/zai-org/glm-5.3",
  "cloudflare/@cf/qwen/qwen3.8-27b",
  "cloudflare/@cf/moonshotai/kimi-k2.6",
  "cloudflare/@cf/openai/gpt-oss-120b",
  "cloudflare/@cf/zai-org/glm-4.7-flash",
  // Anthropic Claude is REMOVED, and the reason matters more than the removal.
  //
  // The comment here used to say "selecting one without the key errors on that
  // turn". It doesn't. `anthropic/claude-opus-4.6` isn't in the pi-ai catalog at
  // all, so it fails during model RESOLUTION with "Unknown model specifier" —
  // before any key check — and flue classifies that deterministic failure as a
  // retryable interruption (`deferred_to_scheduled_wake`). The submission then
  // retries forever: the conversation is wedged on "Thinking…" permanently, with
  // no way out from the client, burning a Durable Object alarm each round.
  //
  // An allowlist entry is a loaded gun when the specifier is wrong, because
  // `writeSelectedModel` persists it into the conversation's DO. The only reason
  // removing them here UNWEDGES the conversations that already stored one is
  // that `readSelectedModel` re-validates on the way out and falls back to
  // DEFAULT_MODEL — keep that property if you touch this file.
  //
  // To re-add: set ANTHROPIC_API_KEY on this worker, verify each specifier
  // actually resolves (a turn that completes, not just a name that looks right),
  // and add it back to all three registries — here, src/lib/agentModel.js, and
  // mobile-app/src/lib/agent-model.ts.
  //
  // Cerebras — built-in pi-ai catalog provider (openai-completions). Needs
  // CEREBRAS_API_KEY on this worker (+ CEREBRAS_GATEWAY_URL to route via CF AI
  // Gateway — see app.ts). Opt-in on the client (Settings › Chat provider);
  // selecting one without the key errors on that turn. All three do tool calls.
  "cerebras/gemma-4-31b",
  "cerebras/zai-glm-4.7",
  "cerebras/gpt-oss-120b",
  // OpenRouter — pi-ai catalog provider (openai-completions), registered in
  // app.ts and routed via CF AI Gateway when OPENROUTER_GATEWAY_URL is set.
  // Needs OPENROUTER_API_KEY on this worker; opt-in on the client (Settings ›
  // Chat provider = OpenRouter). The `-0813` snapshot is pinned in app.ts (the
  // catalog ships the rolling `deepseek/deepseek-v4-pro`), so this specifier
  // always resolves. Selecting it without the key errors on that turn — it does
  // NOT wedge, because it resolves. Does tool calls.
  "openrouter/deepseek/deepseek-v4-pro-0813",
]);

// film-plan.ts HIDE_EXTRA_MODELS: while on, the ONLY selectable model is the
// default (GLM-5.3). A conversation that stored another one reads back as the
// default (readSelectedModel re-validates), and a client still sending a hidden
// one is ignored — the allowlist above stays whole for when the switch flips.
export function isAllowedModel(model: unknown): model is string {
  if (HIDE_EXTRA_MODELS) return model === DEFAULT_MODEL;
  return typeof model === "string" && ALLOWED_MODELS.has(model);
}

// Minimal SQL surface shared by the DO's `ctx.storage.sql` (Cloudflare) and the
// flue `getCloudflareContext().storage.sql` handle — both expose `exec(...)`.
interface SqlLike {
  exec(
    query: string,
    ...bindings: unknown[]
  ): { toArray(): Array<Record<string, unknown>> };
}

const TABLE = "app_settings";
const MODEL_KEY = "model";
const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;

// Persist the selected model for this conversation (whitelisted; falls back to
// the default for anything unknown).
export function writeSelectedModel(sql: SqlLike, model: unknown): void {
  const value = isAllowedModel(model) ? model : DEFAULT_MODEL;
  sql.exec(DDL);
  sql.exec(
    `INSERT INTO ${TABLE} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    MODEL_KEY,
    value,
  );
}

// Read the selected model back, defaulting when unset or invalid.
export function readSelectedModel(sql: SqlLike): string {
  sql.exec(DDL);
  const stored = sql
    .exec(`SELECT value FROM ${TABLE} WHERE key = ?`, MODEL_KEY)
    .toArray()[0]?.value;
  return isAllowedModel(stored) ? stored : DEFAULT_MODEL;
}
