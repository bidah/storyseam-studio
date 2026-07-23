// Per-conversation Atlas Cloud key (BYOK) — the exact same pattern as the fal
// key (lib/fal-key.ts): the browser keeps the user's Atlas key in localStorage
// only and stamps it on every `/eve/*` send as `x-flue-atlas-key`; app.ts
// persists it here (setAtlasKey DO RPC) just before the prompt is admitted, so
// the atlas_* render tools can use it mid-run and across the turn's async job
// polling. It lives in the conversation's Durable Object storage — never in
// D1/KV.

interface SqlLike {
  exec(
    query: string,
    ...bindings: unknown[]
  ): { toArray(): Array<Record<string, unknown>> };
}

const TABLE = "app_settings"; // shared with models.ts / fal-key.ts
const ATLAS_KEY_KEY = "atlasKey";
const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;

// Same conservative shape check as the fal key — enough to reject blobs while
// accepting any plausible token format.
export function isPlausibleAtlasKey(key: unknown): key is string {
  return typeof key === "string" && /^[\w:.-]{10,200}$/.test(key);
}

export function writeAtlasKey(sql: SqlLike, key: unknown): void {
  const value = isPlausibleAtlasKey(key) ? key : "";
  sql.exec(DDL);
  sql.exec(
    `INSERT INTO ${TABLE} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ATLAS_KEY_KEY,
    value,
  );
}

export function readAtlasKey(sql: SqlLike): string {
  try {
    sql.exec(DDL);
    const rows = sql
      .exec(`SELECT value FROM ${TABLE} WHERE key = ?`, ATLAS_KEY_KEY)
      .toArray();
    const value = rows[0]?.value;
    return isPlausibleAtlasKey(value) ? value : "";
  } catch {
    return "";
  }
}
