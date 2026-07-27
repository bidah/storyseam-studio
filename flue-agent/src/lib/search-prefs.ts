// Per-conversation web-search preferences: which provider is the DEFAULT for
// search (Settings › Web search) and the user's BYOK keys for each.
//
// One blob instead of the three separate modules the render side grew
// (models.ts / fal-key.ts / atlas-key.ts / render-prefs.ts): search has a single
// Settings panel and a single DO RPC (`setSearchPrefs`), so there's nothing to
// gain from splitting it. The browser stamps `x-flue-search-provider`,
// `x-flue-exa-key` and `x-flue-firecrawl-key` on every `/eve/*` send; app.ts
// persists them here before admission and whistlewood.ts reads them back to
// build that turn's search tools.
//
// Unlike the render providers (where all backends' tools stay loaded so
// in-flight jobs can still be polled), search loads EXACTLY ONE backend — the
// tools are synchronous and identically named, so there is nothing to strand.

interface SqlLike {
  exec(
    query: string,
    ...bindings: unknown[]
  ): { toArray(): Array<Record<string, unknown>> };
}

const TABLE = "app_settings"; // shared with models.ts / fal-key.ts / atlas-key.ts
const PREFS_KEY = "searchPrefs";
const DDL = `CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;

const PROVIDER_IDS = ["exa", "firecrawl"] as const;
export type SearchProviderId = (typeof PROVIDER_IDS)[number];

export const DEFAULT_SEARCH_PROVIDER: SearchProviderId = "exa";

export type SearchPrefs = {
  provider: SearchProviderId;
  exaKey: string;
  firecrawlKey: string;
};

export const EMPTY_SEARCH_PREFS: SearchPrefs = {
  provider: DEFAULT_SEARCH_PROVIDER,
  exaKey: "",
  firecrawlKey: "",
};

const isProviderId = (v: unknown): v is SearchProviderId =>
  typeof v === "string" && (PROVIDER_IDS as readonly string[]).includes(v);

// Same conservative shape check as the fal / Atlas keys — enough to reject
// blobs while accepting any plausible token format (Firecrawl keys are `fc-…`).
export const isPlausibleSearchKey = (key: unknown): key is string =>
  typeof key === "string" && /^[\w:.-]{10,200}$/.test(key);

const cleanKey = (key: unknown): string => (isPlausibleSearchKey(key) ? key : "");

// Merge an inbound header set over the stored prefs. A header that is ABSENT
// leaves the stored value alone (so a client that doesn't send keys — e.g. an
// older build — never wipes them); a header that is present but implausible is
// treated as "clear this key", which is how Settings' Remove button lands.
export function mergeSearchPrefs(
  stored: SearchPrefs,
  incoming: { provider?: unknown; exaKey?: unknown; firecrawlKey?: unknown },
): SearchPrefs {
  return {
    provider: isProviderId(incoming.provider) ? incoming.provider : stored.provider,
    exaKey: incoming.exaKey === undefined ? stored.exaKey : cleanKey(incoming.exaKey),
    firecrawlKey:
      incoming.firecrawlKey === undefined ? stored.firecrawlKey : cleanKey(incoming.firecrawlKey),
  };
}

export function writeSearchPrefs(sql: SqlLike, prefs: SearchPrefs): void {
  sql.exec(DDL);
  sql.exec(
    `INSERT INTO ${TABLE} (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    PREFS_KEY,
    JSON.stringify({
      provider: isProviderId(prefs.provider) ? prefs.provider : DEFAULT_SEARCH_PROVIDER,
      exaKey: cleanKey(prefs.exaKey),
      firecrawlKey: cleanKey(prefs.firecrawlKey),
    }),
  );
}

export function readSearchPrefs(sql: SqlLike): SearchPrefs {
  try {
    sql.exec(DDL);
    const raw = sql
      .exec(`SELECT value FROM ${TABLE} WHERE key = ?`, PREFS_KEY)
      .toArray()[0]?.value;
    if (typeof raw !== "string") return { ...EMPTY_SEARCH_PREFS };
    const parsed = JSON.parse(raw) as Partial<SearchPrefs>;
    return {
      provider: isProviderId(parsed?.provider) ? parsed.provider : DEFAULT_SEARCH_PROVIDER,
      exaKey: cleanKey(parsed?.exaKey),
      firecrawlKey: cleanKey(parsed?.firecrawlKey),
    };
  } catch {
    return { ...EMPTY_SEARCH_PREFS };
  }
}
