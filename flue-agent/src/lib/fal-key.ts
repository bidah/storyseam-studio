// Per-conversation fal.ai key (BYOK). The browser keeps the user's fal key in
// localStorage only and stamps it on every `/eve/*` send as `x-flue-fal-key`;
// app.ts persists it here (setFalKey DO RPC, same pattern as the chat-model
// selection in models.ts) just before the prompt is admitted, so the agent
// initializer — and therefore the fal_* render tools — can use it mid-run and
// across the turn's async job polling. It lives in the conversation's Durable
// Object storage (scoped to this user's conversation, gone when the
// conversation is deleted) — never in D1/KV.

interface SqlLike {
  exec(
    query: string,
    ...bindings: unknown[]
  ): { toArray(): Array<Record<string, unknown>> };
}

const TABLE = "app_settings"; // shared with models.ts (same key/value table)
const FAL_KEY_KEY = "falKey";
const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;

// fal keys are `<uuid>:<hex>`-shaped; accept a conservative superset and cap
// the length so a client can't stuff arbitrary blobs into DO storage.
export function isPlausibleFalKey(key: unknown): key is string {
  return typeof key === "string" && /^[\w:.-]{10,200}$/.test(key);
}

export function writeFalKey(sql: SqlLike, key: unknown): void {
  const value = isPlausibleFalKey(key) ? key : "";
  sql.exec(DDL);
  sql.exec(
    `INSERT INTO ${TABLE} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    FAL_KEY_KEY,
    value,
  );
}

export function readFalKey(sql: SqlLike): string {
  try {
    sql.exec(DDL);
    const rows = sql
      .exec(`SELECT value FROM ${TABLE} WHERE key = ?`, FAL_KEY_KEY)
      .toArray();
    const value = rows[0]?.value;
    return isPlausibleFalKey(value) ? value : "";
  } catch {
    return "";
  }
}
