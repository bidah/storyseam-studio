// Ask the Worker to turn a new chat's first message into a short, descriptive
// title via Cloudflare Workers AI (see worker/src/routes/chat-title.js). The
// local `deriveTitle` fallback shows the raw first line instantly; this upgrades
// it to a tidy 3-6 word label for the history list.
//
// Same-origin fetch, so the session cookie rides along and the route's
// sign-in gate is satisfied. Best-effort: any failure just leaves the fallback
// title in place, so callers can swallow errors.
export async function generateChatTitle(text) {
  const body = (text || "").trim();
  if (!body) return null;
  const res = await fetch("/api/chat-title", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: body }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => ({}));
  const title = typeof data?.title === "string" ? data.title.trim() : "";
  return title || null;
}
