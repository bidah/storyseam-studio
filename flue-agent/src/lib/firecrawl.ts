// Firecrawl (https://firecrawl.dev) — the other web-search backend behind
// `web_search` / `fetch_url` (see lib/exa.ts, lib/search.ts). Keyword/engine
// search plus a strong page extractor: `fetch_url` here renders JavaScript and
// returns clean markdown, which beats Exa on app-like pages and paywall-ish
// layouts. Exa wins on "find me things like this" semantic discovery.
//
// Same two tool names, same input schema, same result shape as Exa — only one
// backend loads per conversation, so nothing downstream (skills, instructions)
// knows which one is in use.
//
// BYOK-first like Exa: the user's key rides from the browser into the
// conversation's Durable Object (lib/search-prefs.ts), with the FIRECRAWL_API_KEY
// worker secret as the operator fallback.
//
// Filter mapping. Firecrawl's search takes a query + engine-style operators
// rather than Exa's structured filters, so:
//   - include_domains / exclude_domains → `site:` / `-site:` operators, and
//   - category "news" → `sources: ["news"]`.
// Anything it can't honor (the other categories, start_published_date) is NOT
// silently dropped — it comes back in `ignored_filters` so the model can adjust
// (usually by folding the constraint into the query text) instead of trusting a
// filter that never applied.

import { defineTool } from "@flue/runtime";
import type { ToolDefinition } from "@flue/runtime";
import {
  FETCH_TEXT_CHARS,
  FETCH_URL_DESCRIPTION,
  FETCH_URL_INPUT,
  SEARCH_TEXT_CHARS,
  WEB_SEARCH_DESCRIPTION,
  WEB_SEARCH_INPUT,
  providerError,
  result,
} from "./search-util.js";

const FIRECRAWL_API = "https://api.firecrawl.dev/v2";

async function firecrawlPost(
  key: string,
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  const res = await fetch(`${FIRECRAWL_API}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await providerError("Firecrawl", path, res);
  return await res.json();
}

// `data` is `{ web: [...], news: [...], images: [...] }` on v2; older/scraped
// responses hand back a bare array. Accept both, drop images (no text to read).
function rowsOf(data: any): any[] {
  const d = data?.data;
  if (Array.isArray(d)) return d;
  return [...(Array.isArray(d?.web) ? d.web : []), ...(Array.isArray(d?.news) ? d.news : [])];
}

const siteOperators = (domains: string[] | undefined, negate: boolean): string =>
  (domains ?? [])
    .map((raw) => String(raw).trim().replace(/^https?:\/\//, "").replace(/\/.*$/, ""))
    .filter(Boolean)
    .map((host) => `${negate ? "-" : ""}site:${host}`)
    .join(" ");

export function createFirecrawlTools(userKey?: string): ToolDefinition[] {
  const key = (userKey || "").trim() || (process.env.FIRECRAWL_API_KEY || "").trim();
  if (!key) return []; // no Firecrawl key — tools absent by design

  const webSearch = defineTool({
    name: "web_search",
    description: WEB_SEARCH_DESCRIPTION,
    input: WEB_SEARCH_INPUT,
    async run({ input, signal }) {
      const ignored: string[] = [];
      // Domain filters ride the query as search operators.
      const query = [
        input.query,
        siteOperators(input.include_domains, false),
        siteOperators(input.exclude_domains, true),
      ]
        .filter(Boolean)
        .join(" ");

      if (input.start_published_date) ignored.push("start_published_date");
      if (input.category && input.category !== "news") ignored.push(`category=${input.category}`);

      const data = await firecrawlPost(
        key,
        "/search",
        {
          query,
          limit: input.num_results ?? 5,
          ...(input.category === "news" ? { sources: ["news"] } : {}),
          // Scraping each hit is what produces excerpts/text. Without it
          // Firecrawl returns only title + description.
          ...(input.include_text
            ? { scrapeOptions: { formats: ["markdown"], onlyMainContent: true } }
            : {}),
        },
        signal,
      );

      const rows = rowsOf(data);
      return {
        provider: "firecrawl",
        query: input.query,
        count: rows.length,
        ...(ignored.length
          ? {
              ignored_filters: ignored,
              note: "Firecrawl could not apply the listed filters — fold those constraints into the query text if they matter.",
            }
          : {}),
        results: rows.map((r: any) =>
          result({
            title: r?.title,
            url: r?.url,
            publishedDate: r?.date ?? r?.metadata?.publishedTime,
            author: r?.metadata?.author,
            // `description`/`snippet` is the engine's excerpt — the closest
            // thing to Exa's highlights.
            excerpts: r?.description ?? r?.snippet,
            text: r?.markdown,
            textCap: SEARCH_TEXT_CHARS,
          }),
        ),
      };
    },
  });

  const fetchUrl = defineTool({
    name: "fetch_url",
    description: FETCH_URL_DESCRIPTION,
    input: FETCH_URL_INPUT,
    async run({ input, signal }) {
      const max = input.max_characters ?? FETCH_TEXT_CHARS;
      // /scrape is one URL per call — fan out, and let one bad page fail
      // alone rather than sinking the batch.
      const settled = await Promise.all(
        input.urls.map(async (url) => {
          try {
            const data = await firecrawlPost(
              key,
              "/scrape",
              {
                url,
                formats: input.summary_query
                  ? ["markdown", { type: "summary", prompt: input.summary_query }]
                  : ["markdown"],
                onlyMainContent: true,
              },
              signal,
            );
            const doc = data?.data ?? {};
            return result({
              title: doc?.metadata?.title ?? doc?.metadata?.ogTitle,
              url: doc?.metadata?.sourceURL ?? url,
              publishedDate: doc?.metadata?.publishedTime,
              author: doc?.metadata?.author,
              summary: doc?.summary,
              text: doc?.markdown,
              textCap: max,
            });
          } catch (err: any) {
            return { url, error: String(err?.message || err) };
          }
        }),
      );
      return { provider: "firecrawl", count: settled.length, results: settled };
    },
  });

  return [webSearch, fetchUrl];
}
