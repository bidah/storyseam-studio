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

// The web picker's option ids are the anthropic model ids; the flue specifier is
// `anthropic/<id>`. Keep these three in lockstep with src/lib/agentModel.js.
export const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

// The only model specifiers a client may select. Anything else is ignored and
// the conversation falls back to DEFAULT_MODEL, so a client can never push an
// arbitrary model string to the provider.
export const ALLOWED_MODELS = new Set<string>([
  "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-4.6",
  "anthropic/claude-fable-5",
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
