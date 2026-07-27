// Shared surface for the web-search backends (lib/exa.ts, lib/firecrawl.ts).
//
// Both providers expose the SAME two tools under the SAME names (`web_search` /
// `fetch_url`) with the SAME input schema and the SAME result shape — only one
// backend is ever loaded at a time (see lib/search.ts), so the agent and every
// skill can talk about "web_search" without knowing which service is behind it.
// Switching providers in Settings must not change a single prompt.

import * as v from "valibot";

// Result text is fed straight into the model's context, so every text field is
// bounded. Search leans on short query-relevant excerpts; full page text is
// opt-in and capped.
export const SEARCH_TEXT_CHARS = 2000;
export const FETCH_TEXT_CHARS = 6000;
export const FETCH_TEXT_MAX = 20000;

// Generic (unlike tools/_util.ts's `d`) so input property types survive into
// run({ input }).
export const d = <T extends v.GenericSchema>(schema: T, text: string) =>
  v.pipe(schema, v.description(text));

export const clip = (text: unknown, max: number): string | undefined => {
  if (typeof text !== "string" || !text) return undefined;
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
};

// Exa's documented categories. Kept as the shared vocabulary; Firecrawl maps
// what it can and reports the rest back as ignored (see firecrawl.ts).
export const CATEGORIES = [
  "company",
  "people",
  "research paper",
  "news",
  "personal site",
  "financial report",
] as const;

export const WEB_SEARCH_INPUT = v.object({
  query: d(
    v.string(),
    "The search query. Write it as a full natural-language description of what you want ('documentary photos of 1920s Appalachian logging camps' beats 'logging camps').",
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
  exclude_domains: v.optional(
    d(v.array(v.string()), "Never return results from these domains."),
  ),
  start_published_date: v.optional(
    d(v.string(), "Only results published on/after this date (YYYY-MM-DD). Use for recency."),
  ),
  include_text: v.optional(
    d(
      v.boolean(),
      `Also return each page's text (capped at ~${SEARCH_TEXT_CHARS} chars). Default false — the excerpts are usually enough and far cheaper in context.`,
    ),
  ),
});

export const FETCH_URL_INPUT = v.object({
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
      "When set, the provider also returns a short summary of each page answering this question. Useful for long pages.",
    ),
  ),
});

export const WEB_SEARCH_DESCRIPTION =
  "Search the live web and get back ranked results with short query-relevant excerpts. Use it for anything outside this project's own data: checking a fact, researching a subject/era/place before writing or generating art, finding reference material, looking up how a real thing looks or works, or reading current news. Returns title, url, date and excerpts per result — call fetch_url on a result's url when you need the full page. This does NOT read project state (script, world, shots, sounds); use the get_* tools for that.";

export const FETCH_URL_DESCRIPTION =
  "Read the contents of one or more web pages by URL (clean, extracted text). Use it after web_search when the excerpts aren't enough, or when the user hands you a link to read. Returns the page text, truncated. For images/video the user wants to USE as a generation reference, do not fetch them here — pass their absolute URL to the render tools instead.";

// Uniform per-result shape across providers. Empty fields are omitted so the
// model isn't fed a wall of nulls.
export function result(fields: {
  title?: unknown;
  url?: unknown;
  publishedDate?: unknown;
  author?: unknown;
  excerpts?: unknown;
  summary?: unknown;
  text?: unknown;
  textCap: number;
}) {
  const excerpts = Array.isArray(fields.excerpts)
    ? fields.excerpts.filter((e) => typeof e === "string" && e)
    : typeof fields.excerpts === "string" && fields.excerpts
      ? [fields.excerpts]
      : [];
  const text = clip(fields.text, fields.textCap);
  return {
    title: (fields.title as string) ?? null,
    url: (fields.url as string) ?? null,
    publishedDate: (fields.publishedDate as string) ?? null,
    author: (fields.author as string) ?? null,
    ...(excerpts.length ? { excerpts } : {}),
    ...(fields.summary ? { summary: fields.summary as string } : {}),
    ...(text ? { text } : {}),
  };
}

// Shared HTTP error text extraction — providers disagree on the error field.
export async function providerError(label: string, path: string, res: Response): Promise<Error> {
  let detail = "";
  try {
    const body: any = await res.json();
    detail = body?.error || body?.message || body?.detail || JSON.stringify(body);
  } catch {
    detail = (await res.text().catch(() => "")).slice(0, 200);
  }
  return new Error(`${label} ${path} failed (${res.status})${detail ? `: ${detail}` : ""}`);
}
