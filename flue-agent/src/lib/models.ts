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
// Gateway. All three support function calling (required for the agent's tools).
// Keep these in lockstep with src/lib/agentModel.js + mobile-app/src/lib/agent-model.ts.
export const DEFAULT_MODEL = "cloudflare/@cf/moonshotai/kimi-k2.6";

// The only model specifiers a client may select. Anything else is ignored and
// the conversation falls back to DEFAULT_MODEL, so a client can never push an
// arbitrary model string to the provider.
export const ALLOWED_MODELS = new Set<string>([
  // Cloudflare Workers AI — no external key, auto CF AI Gateway.
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
]);

export function isAllowedModel(model: unknown): model is string {
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
