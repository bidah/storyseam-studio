// Exa (https://exa.ai) — one of the two web-search backends behind the agent's
// `web_search` / `fetch_url` tools. Embeddings-based search, so natural-language
// queries beat keywords. See lib/search.ts for the selection, lib/firecrawl.ts
// for the other backend, and lib/search-util.ts for the shared tool surface.
//
// Why a hand-written tool at all: flue has NO built-in web search — its built-in
// tools are sandbox-local (read/write/edit/grep/glob/bash), `AgentRuntimeConfig`
// has no provider-tool passthrough (so the anthropic/* models' server-side
// search is unreachable), and the only documented ways to add search are a
// custom tool or `connectMcpServer`. MCP is out here for the same reason as
// Higgsfield (see lib/higgsfield.ts): the MCP SDK compiles output schemas with
// Ajv (`new Function`), which Cloudflare Workers forbid. So: plain fetch.
//
// Credentials are BYOK-first like fal / Atlas — the user's key rides from the
// browser and is kept in the conversation's Durable Object (lib/search-prefs.ts)
// — with the EXA_API_KEY worker secret as the operator fallback. No key at all
// and the tools are simply absent.

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

const EXA_API = "https://api.exa.ai";

async function exaPost(
  key: string,
  path: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<any> {
  const res = await fetch(`${EXA_API}${path}`, {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await providerError("Exa", path, res);
  return await res.json();
}

export function createExaTools(userKey?: string): ToolDefinition[] {
  const key = (userKey || "").trim() || (process.env.EXA_API_KEY || "").trim();
  if (!key) return []; // no Exa key for this conversation — tools absent by design

  const webSearch = defineTool({
    name: "web_search",
    description: WEB_SEARCH_DESCRIPTION,
    input: WEB_SEARCH_INPUT,
    async run({ data: input, signal }) {
      const data = await exaPost(
        key,
        "/search",
        {
          query: input.query,
          numResults: input.num_results ?? 5,
          ...(input.category ? { category: input.category } : {}),
          ...(input.include_domains?.length ? { includeDomains: input.include_domains } : {}),
          ...(input.exclude_domains?.length ? { excludeDomains: input.exclude_domains } : {}),
          ...(input.start_published_date
            ? { startPublishedDate: input.start_published_date }
            : {}),
          contents: {
            highlights: { query: input.query },
            ...(input.include_text ? { text: { maxCharacters: SEARCH_TEXT_CHARS } } : {}),
          },
        },
        signal,
      );
      const rows = Array.isArray(data?.results) ? data.results : [];
      return {
        output: {
          provider: "exa",
          query: input.query,
          count: rows.length,
          results: rows.map((r: any) =>
            result({
              title: r?.title,
              url: r?.url,
              publishedDate: r?.publishedDate,
              author: r?.author,
              excerpts: r?.highlights,
              summary: r?.summary,
              text: r?.text,
              textCap: SEARCH_TEXT_CHARS,
            }),
          ),
        },
      };
    },
  });

  const fetchUrl = defineTool({
    name: "fetch_url",
    description: FETCH_URL_DESCRIPTION,
    input: FETCH_URL_INPUT,
    async run({ data: input, signal }) {
      const max = input.max_characters ?? FETCH_TEXT_CHARS;
      // Exa's /contents takes the whole batch in one call (cached, with live
      // crawl fallback for uncached pages).
      const data = await exaPost(
        key,
        "/contents",
        {
          urls: input.urls,
          text: { maxCharacters: max },
          ...(input.summary_query ? { summary: { query: input.summary_query } } : {}),
        },
        signal,
      );
      const rows = Array.isArray(data?.results) ? data.results : [];
      return {
        output: {
          provider: "exa",
          count: rows.length,
          results: rows.map((r: any) =>
            result({
              title: r?.title,
              url: r?.url,
              publishedDate: r?.publishedDate,
              author: r?.author,
              summary: r?.summary,
              text: r?.text,
              textCap: max,
            }),
          ),
        },
      };
    },
  });

  return [webSearch, fetchUrl];
}
