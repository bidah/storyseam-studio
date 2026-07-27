// Document text extraction for chat attachments.
//
// The chat composer accepts more than images: drop / paste / pick a PDF, .txt,
// .md, .csv, .docx … and it lands in R2 through the same /api/upload path. But
// an image can travel to the model as vision input while a DOCUMENT has to
// become text first — that conversion happens here, once, server-side, so both
// consumers see the same result:
//
//   * the GUI composer, which inlines the extracted text into the message it
//     sends (so the agent ingests the document with the turn), and
//   * the agent's `read_document` tool, which re-reads the same attachment when
//     the inlined excerpt was truncated (large PDFs) or when it wants a later
//     slice of a long file.
//
// text/* and friends decode straight from the stored bytes. Everything else
// (PDF, DOCX, XLSX, PPTX, HTML, …) goes through Workers AI's Markdown
// Conversion API (`env.AI.toMarkdown`) — which is why this needs the `AI`
// binding that already sits in wrangler.jsonc for /api/transcribe.

// Formats we can decode ourselves — no model call, no neurons burnt.
const TEXT_MIME = new Set([
  "application/json",
  "application/x-ndjson",
  "application/jsonl",
  "application/yaml",
  "application/x-yaml",
  "application/javascript",
  "application/xml",
]);
const TEXT_EXT =
  /\.(txt|text|log|md|markdown|mdx|csv|tsv|json|jsonl|ndjson|ya?ml|xml|srt|vtt|fountain|ini|toml|js|jsx|ts|tsx|py|rb|go|rs|sh|css|sql)$/i;

// How much text one call hands back by default, and the hard ceiling. A
// 300-page PDF is megabytes of markdown; nobody wants that in one JSON body.
const DEFAULT_LIMIT = 100_000;
const MAX_LIMIT = 400_000;

// R2 keys are minted as `chat-uploads/<uuid>-<safeName>` (see storeUpload in
// index.js). Callers pass either that key or the public `/files/<key>` URL the
// upload response handed them — the agent only ever sees the URL.
function keyFromUrl(raw) {
  if (!raw) return null;
  let path = String(raw);
  try {
    path = new URL(path, "https://placeholder.invalid").pathname;
  } catch {
    /* already a bare path */
  }
  const at = path.indexOf("/files/");
  if (at === -1) return null;
  try {
    return decodeURIComponent(path.slice(at + "/files/".length));
  } catch {
    return path.slice(at + "/files/".length);
  }
}

// "b3f1…-quarterly_report.pdf" → "quarterly_report.pdf" for display. The uuid
// prefix is storage bookkeeping; the author named the file the other thing.
function displayName(key) {
  const base = String(key || "").split("/").pop() || "document";
  return base.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, "");
}

function isTextual(contentType, name) {
  const ct = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (ct.startsWith("text/") && ct !== "text/html") return true;
  if (TEXT_MIME.has(ct)) return true;
  // Browsers hand up "" or application/octet-stream for .md / .fountain / most
  // code files, so the extension is the more reliable signal for those.
  if ((!ct || ct === "application/octet-stream") && TEXT_EXT.test(name)) return true;
  return false;
}

// Chat attachments and nothing else. Two reasons this prefix is the gate:
//
//   * Access. Both callers reach this route, but only one of them is
//     authenticated — the browser rides its session cookie, while the flue
//     agent's tool client (flue-agent/src/lib/api.ts) sends no auth at all. A
//     `chat-uploads/` object is ALREADY public over `/files/*`, and its key
//     carries an unguessable uuid, so serving the same bytes as text grants
//     nothing new. Session-gating instead would simply break `read_document`.
//   * Cost. Non-text formats burn Workers AI neurons, so the route must not
//     become a general "markdown-convert anything in the bucket" endpoint —
//     project media (`media/…`) is off limits.
const ALLOWED_PREFIX = "chat-uploads/";

export function registerExtract(app) {
  app.post("/api/extract", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const key = String(body.key || keyFromUrl(body.url) || "").replace(/^\/+/, "");
    if (!key) {
      return c.json({ error: "Pass the attachment's `key` or its /files/… `url`" }, 400);
    }
    if (!key.startsWith(ALLOWED_PREFIX) || key.includes("..")) {
      return c.json({ error: "Only chat attachments can be read here" }, 403);
    }

    const offset = Math.max(0, Number(body.offset) || 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit) || DEFAULT_LIMIT));

    const obj = await c.env.BUCKET.get(key);
    if (!obj) return c.json({ error: `No stored file at ${key}` }, 404);

    const name = displayName(key);
    const contentType = obj.httpMetadata?.contentType || "application/octet-stream";

    let text;
    let format;
    try {
      if (isTextual(contentType, name)) {
        text = await obj.text();
        format = "text";
      } else {
        const buf = await obj.arrayBuffer();
        const [result] = await c.env.AI.toMarkdown([
          { name, blob: new Blob([buf], { type: contentType }) },
        ]);
        if (!result || result.format === "error") {
          return c.json(
            { error: `Couldn't read ${name}: ${result?.error || "unsupported format"}` },
            422,
          );
        }
        text = result.data || "";
        format = result.format || "markdown";
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: `Extraction failed for ${name}: ${msg}` }, 500);
    }

    const chars = text.length;
    const slice = text.slice(offset, offset + limit);
    const end = offset + slice.length;
    return c.json({
      ok: true,
      key,
      name,
      mimetype: contentType,
      format,
      chars,
      offset,
      text: slice,
      truncated: end < chars,
      // Where a follow-up read_document call should pick up, or null when the
      // document is fully read.
      nextOffset: end < chars ? end : null,
    });
  });
}
