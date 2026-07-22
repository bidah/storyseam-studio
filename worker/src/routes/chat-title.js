// Generate a short, descriptive chat title from the first message of a new
// conversation via Cloudflare Workers AI (a small instruct model). The chat
// history list otherwise falls back to the raw first user line (see
// `deriveTitle` in src/lib/chat-store.js), which is often a long, awkward label
// for later picking a chat back out of history — this rounds it into a tidy
// 3-6 word title.
//
// Session-gated like the rest of /api/* (a signed-in user is required); it's a
// pure text->title computation with no project writes, so index.js keeps it out
// of the post-mutation live-sync broadcast.
const MODEL = "@cf/meta/llama-3.1-8b-instruct";

const SYSTEM = [
  "You write short, descriptive titles for a chat, based on the user's first message.",
  "Rules: 3 to 6 words, Title Case, no surrounding quotes, no trailing punctuation,",
  "no emojis. Summarize the topic or intent — do not answer or continue the message.",
  "Reply with the title only, nothing else.",
].join(" ");

// Trim the model's output down to a clean menu label: strip wrapping quotes,
// collapse whitespace, drop trailing punctuation, and cap the length (mirrors
// the client's 48-char cap so history rows never overflow).
function cleanTitle(raw) {
  let t = String(raw || "")
    .replace(/\s+/g, " ")
    .trim()
    // The model sometimes prefixes "Title:" or wraps the whole thing in quotes.
    .replace(/^title\s*:\s*/i, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/[.,;:!?\s]+$/g, "")
    .trim();
  if (t.length > 48) t = `${t.slice(0, 47).trimEnd()}…`;
  return t;
}

export function registerChatTitle(app) {
  app.post("/api/chat-title", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);

    const body = await c.req.json().catch(() => null);
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text) return c.json({ error: "Missing text" }, 400);

    // Cap the input we hand the model — the first sentence or two carries the
    // topic; a whole essay just wastes tokens and can derail the summary.
    const input = text.length > 2000 ? text.slice(0, 2000) : text;

    try {
      const res = await c.env.AI.run(MODEL, {
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: input },
        ],
        max_tokens: 24,
        temperature: 0.3,
      });
      const title = cleanTitle(res?.response);
      if (!title) return c.json({ error: "No title generated" }, 502);
      return c.json({ title });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return c.json({ error: `Title generation failed: ${msg}` }, 500);
    }
  });
}
