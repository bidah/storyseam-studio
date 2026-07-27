// Web search + page reading via Exa (https://exa.ai) — the agent's only route
// to the open web.
//
// flue has NO built-in web search: its built-in tools are sandbox-local
// (read/write/edit/grep/glob/bash), `AgentRuntimeConfig` has no provider-tool
// passthrough (so the anthropic/* models' server-side search is unreachable),
// and the only documented ways to add search are a custom tool or
// `connectMcpServer`. MCP is out here for the same reason as Higgsfield (see
// lib/higgsfield.ts): the MCP SDK compiles output schemas with Ajv
// (`new Function`), which Cloudflare Workers forbid. So: plain fetch against
// Exa's REST API, wrapped as two typed tools.
//
// Keyed by the EXA_API_KEY worker secret (operator-owned, NOT BYOK like fal /
// Atlas — search is cheap and shared). Without the secret both tools are simply
// absent, mirroring createFalTools / createHiggsfieldTools.

import { defineTool } from "@flue/runtime";
import type { ToolDefinition } from "@flue/runtime";
import * as v from "valibot";

const EXA_API = "https://api.exa.ai";

// Result text is fed straight into the model's context, so every text field is
// bounded. Search leans on `highlights` (short, query-relevant excerpts);
// full page text is opt-in and capped.
const SEARCH_TEXT_CHARS = 2000;
const FETCH_TEXT_CHARS = 6000;
const FETCH_TEXT_MAX = 20000;

// Generic (unlike tools/_util.ts's `d`) so input property types survive into
// run({ input }).
const d = <T extends v.GenericSchema>(schema: T, text: string) =>
  v.pipe(schema, v.description(text));

// Documented Exa categories — a picklist so the model can't invent one and get
// silently-empty results.
const CATEGORIES = [
  "company",
  "people",
  "research paper",
  "news",
  "personal site",
  "financial report",
] as const;

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
  if (!res.ok) {
    let detail = "";
    try {
      const err: any = await res.json();
      detail = err?.error || err?.message || JSON.stringify(err);
    } catch {
      detail = (await res.text().catch(() => "")).slice(0, 200);
    }
    throw new Error(`Exa ${path} failed (${res.status})${detail ? `: ${detail}` : ""}`);
  }
  return await res.json();
}

const clip = (text: unknown, max: number): string | undefined => {
  if (typeof text !== "string" || !text) return undefined;
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
};

// Exa returns a lot per result (image, favicon, subpages, highlightScores, …).
// Keep only what a model reasons over.
function slim(r: any, textChars: number) {
  return {
    title: r?.title ?? null,
    url: r?.url ?? null,
    publishedDate: r?.publishedDate ?? null,
    author: r?.author ?? null,
    ...(Array.isArray(r?.highlights) && r.highlights.length
      ? { highlights: r.highlights }
      : {}),
    ...(r?.summary ? { summary: r.summary } : {}),
    ...(clip(r?.text, textChars) ? { text: clip(r.text, textChars) } : {}),
  };
}

export function createExaTools(): ToolDefinition[] {
  const key = (process.env.EXA_API_KEY || "").trim();
  if (!key) return []; // no key — search tools absent by design

  const webSearch = defineTool({
    name: "web_search",
    description:
      "Search the live web with Exa and get back ranked results with short query-relevant excerpts. Use it for anything outside this project's own data: checking a fact, researching a subject/era/place before writing or generating art, finding reference material, looking up how a real thing looks or works, or reading current news. Returns title, url, date and highlights per result — call fetch_url on a result's url when you need the full page. This does NOT read project state (script, world, shots, sounds); use the get_* tools for that.",
    input: v.object({
      query: d(
        v.string(),
        "The search query. Write it as a full natural-language description of what you want (Exa is embeddings-based, so 'documentary photos of 1920s Appalachian logging camps' beats 'logging camps').",
      ),
      num_results: v.optional(
        d(
          v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(20)),
          "How many results (1-20). Default 5.",
        ),
      ),
      category: v.optional(
        d(v.picklist(CATEGORIES), "Restrict to one content type. Omit for general web."),
      ),
      include_domains: v.optional(
        d(v.array(v.string()), "Only return results from these domains, e.g. ['wikipedia.org']."),
      ),
      exclude_domains: v.optional(d(v.array(v.string()), "Never return results from these domains.")),
      start_published_date: v.optional(
        d(v.string(), "Only results published on/after this date (YYYY-MM-DD). Use for recency."),
      ),
      include_text: v.optional(
        d(
          v.boolean(),
          `Also return each page's text (capped at ~${SEARCH_TEXT_CHARS} chars). Default false — highlights are usually enough and far cheaper in context.`,
        ),
      ),
    }),
    async run({ input, signal }) {
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
      const results = Array.isArray(data?.results) ? data.results : [];
      return {
        query: input.query,
        count: results.length,
        results: results.map((r: any) => slim(r, SEARCH_TEXT_CHARS)),
      };
    },
  });

  const fetchUrl = defineTool({
    name: "fetch_url",
    description:
      "Read the contents of one or more web pages by URL (via Exa's extractor — cached, with live crawl fallback). Use it after web_search when the highlights aren't enough, or when the user hands you a link to read. Returns the page's extracted text, truncated. For images/video the user wants to USE as a generation reference, do not fetch them here — pass their absolute URL to the render tools instead.",
    input: v.object({
      urls: d(
        v.pipe(v.array(v.pipe(v.string(), v.url())), v.minLength(1), v.maxLength(5)),
        "Absolute page URLs to read (1-5).",
      ),
      max_characters: v.optional(
        d(
          v.pipe(v.number(), v.integer(), v.minValue(200), v.maxValue(FETCH_TEXT_MAX)),
          `Cap on extracted text per page. Default ${FETCH_TEXT_CHARS}.`,
        ),
      ),
      summary_query: v.optional(
        d(
          v.string(),
          "When set, Exa also returns an LLM summary of each page answering this question. Useful for long pages.",
        ),
      ),
    }),
    async run({ input, signal }) {
      const max = input.max_characters ?? FETCH_TEXT_CHARS;
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
      const results = Array.isArray(data?.results) ? data.results : [];
      return {
        count: results.length,
        results: results.map((r: any) => slim(r, max)),
      };
    },
  });

  return [webSearch, fetchUrl];
}
