// Per-conversation render-provider preferences: which backends the user has
// toggled OFF in Settings, and which one is ACTIVE (the default). The browser
// stamps them on every `/eve/*` send as `x-flue-disabled-providers` (a CSV,
// sent even when empty so re-enabling overwrites the stored list) and
// `x-flue-render-provider`; app.ts persists them here (setRenderPrefs DO RPC)
// before admission. whistlewood.ts reads them back to drop disabled providers'
// tools and steer the agent toward the active one.

interface SqlLike {
  exec(
    query: string,
    ...bindings: unknown[]
  ): { toArray(): Array<Record<string, unknown>> };
}

const TABLE = "app_settings"; // shared with models.ts / fal-key.ts / atlas-key.ts
const PREFS_KEY = "renderPrefs";
const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;

const PROVIDER_IDS = ["higgsfield", "fal", "atlas"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];
// `ready` = the SELECTED provider actually has its credential (Higgsfield linked
// or the BYOK key present). The browser computes it (it's the only side that
// knows the client-only keys and the linked-account state) and stamps it as
// x-flue-render-ready; whistlewood.ts reads it to draw a "connect a provider"
// card instead of attempting a render that would 401. Defaults TRUE so an older
// client that never sends the header is never falsely blocked.
export type RenderPrefs = { active: ProviderId | ""; disabled: ProviderId[]; ready: boolean };

const isProviderId = (v: unknown): v is ProviderId =>
  typeof v === "string" && (PROVIDER_IDS as readonly string[]).includes(v);

// Parse the raw headers into validated prefs. Unknown ids are dropped; an
// active provider that is itself disabled is cleared. `ready` is only false when
// the header is explicitly "0" — an absent header stays ready (optimistic).
export function parseRenderPrefs(
  active: unknown,
  disabledCsv: unknown,
  ready?: unknown,
): RenderPrefs {
  const disabled = String(disabledCsv ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(isProviderId);
  const act = isProviderId(active) && !disabled.includes(active) ? active : "";
  return { active: act, disabled, ready: ready === undefined ? true : ready !== "0" && ready !== false };
}

export function writeRenderPrefs(sql: SqlLike, prefs: RenderPrefs): void {
  sql.exec(DDL);
  sql.exec(
    `INSERT INTO ${TABLE} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    PREFS_KEY,
    JSON.stringify(prefs),
  );
}

export function readRenderPrefs(sql: SqlLike): RenderPrefs {
  try {
    sql.exec(DDL);
    const rows = sql
      .exec(`SELECT value FROM ${TABLE} WHERE key = ?`, PREFS_KEY)
      .toArray();
    const raw = rows[0]?.value;
    if (typeof raw !== "string") return { active: "", disabled: [], ready: true };
    const parsed = JSON.parse(raw) as { active?: unknown; disabled?: unknown; ready?: unknown };
    return parseRenderPrefs(
      parsed?.active,
      Array.isArray(parsed?.disabled) ? parsed.disabled.join(",") : "",
      // Stored as a boolean; treat a legacy row with no `ready` as ready.
      parsed?.ready === undefined ? undefined : parsed.ready === false ? "0" : "1",
    );
  } catch {
    return { active: "", disabled: [], ready: true };
  }
}
