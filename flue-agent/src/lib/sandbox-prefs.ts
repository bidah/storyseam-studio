// Per-conversation sandbox selection: what the agent's bash/skill execution runs
// on (Settings › Sandbox).
//
//   "memory"  — flue's built-in `just-bash` virtual filesystem. DEFAULT. Rebuilt
//               EMPTY on every harness init, i.e. every turn (and every durability
//               retry within a turn), so a file written in one message is gone by
//               the next. Free, instant, and enough for the vast majority of the
//               pipeline, which moves state through the typed tools (D1) and R2
//               rather than through files.
//   "daytona" — a real Linux container that PERSISTS across turns (lib/sandbox.ts).
//               Opt-in because it costs money per conversation and adds a
//               cold-start on the first message.
//
// Default is deliberately "memory": the app works well without Daytona, so a
// container is only spun up for conversations the user has explicitly switched
// over. Same key/value DO table and header→RPC→initializer path as the model
// selection and the search prefs.

interface SqlLike {
  exec(
    query: string,
    ...bindings: unknown[]
  ): { toArray(): Array<Record<string, unknown>> };
}

const TABLE = "app_settings"; // shared with models.ts / search-prefs.ts / …
const MODE_KEY = "sandboxMode";
const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;

const MODES = ["memory", "daytona"] as const;
export type SandboxMode = (typeof MODES)[number];

export const DEFAULT_SANDBOX_MODE: SandboxMode = "memory";

export function isSandboxMode(value: unknown): value is SandboxMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export function writeSandboxMode(sql: SqlLike, mode: unknown): void {
  const value = isSandboxMode(mode) ? mode : DEFAULT_SANDBOX_MODE;
  sql.exec(DDL);
  sql.exec(
    `INSERT INTO ${TABLE} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    MODE_KEY,
    value,
  );
}

// Anything unset, unknown, or unreadable falls back to the in-memory sandbox —
// the safe direction, since the failure mode is "no persistent files", not "an
// unexpected container bill".
export function readSandboxMode(sql: SqlLike): SandboxMode {
  try {
    sql.exec(DDL);
    const value = sql
      .exec(`SELECT value FROM ${TABLE} WHERE key = ?`, MODE_KEY)
      .toArray()[0]?.value;
    return isSandboxMode(value) ? value : DEFAULT_SANDBOX_MODE;
  } catch {
    return DEFAULT_SANDBOX_MODE;
  }
}
