// Which web-search backend this conversation gets.
//
// EXACTLY ONE loads. Both providers register the same two tool names
// (`web_search` / `fetch_url`) with the same schema and result shape, so
// loading both would be a duplicate-name collision — and pointless: unlike the
// render providers, there is no in-flight job to strand when the user switches.
//
// Selection is the Settings choice, with a fallback: if the selected provider
// has no credential but the other one does, we load the other rather than leave
// the agent with no web access at all. Credentials are BYOK-first (the user's
// key from the browser) with the EXA_API_KEY / FIRECRAWL_API_KEY worker secrets
// as operator fallbacks — see lib/exa.ts and lib/firecrawl.ts.

import type { ToolDefinition } from "@flue/runtime";
import { createExaTools } from "./exa.js";
import { createFirecrawlTools } from "./firecrawl.js";
import {
  DEFAULT_SEARCH_PROVIDER,
  type SearchPrefs,
  type SearchProviderId,
} from "./search-prefs.js";

export type SearchSelection = {
  tools: ToolDefinition[];
  /** The provider actually loaded — null when neither has a usable key. */
  active: SearchProviderId | null;
  /** True when we fell back because the selected provider had no credential. */
  fellBack: boolean;
};

export function selectSearchTools(prefs: SearchPrefs): SearchSelection {
  const build = (id: SearchProviderId): ToolDefinition[] =>
    id === "exa" ? createExaTools(prefs.exaKey) : createFirecrawlTools(prefs.firecrawlKey);

  const wanted: SearchProviderId =
    prefs.provider === "firecrawl" || prefs.provider === "exa"
      ? prefs.provider
      : DEFAULT_SEARCH_PROVIDER;
  const other: SearchProviderId = wanted === "exa" ? "firecrawl" : "exa";

  const primary = build(wanted);
  if (primary.length) return { tools: primary, active: wanted, fellBack: false };

  const secondary = build(other);
  if (secondary.length) return { tools: secondary, active: other, fellBack: true };

  return { tools: [], active: null, fellBack: false };
}
