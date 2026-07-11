// "Import from Higgsfield" — browse the signed-in user's past image
// generations (via the Higgsfield MCP `show_generations` tool) and copy picked
// ones into the project's asset library in R2.
//
//   GET  /api/higgsfield/images?cursor=&size=  — gallery page {items, nextCursor}
//   POST /api/higgsfield/import                — { rawUrl, minUrl, folder, name? }
//
// Import writes the full-res image to `media/<pid>/asset/<folder>/<file>` (so
// it shows up in /api/library) and Higgsfield's ready-made `_min.webp` to the
// thumb key `media/<pid>/proxy/asset/<folder>/<file>` — no encode needed.
import { proxyKey } from "../lib/media.js";
import {
  getHiggsfieldToken,
  forceRefreshHiggsfieldToken,
  mcpToolCall,
  HiggsfieldAuthError,
} from "../lib/higgsfield.js";

// Only pull bytes from Higgsfield's own delivery hosts (the URLs come from the
// client, so pin them — the Worker must not be a generic fetch proxy).
function isAllowedMediaUrl(u) {
  try {
    const url = new URL(String(u || ""));
    if (url.protocol !== "https:") return false;
    const h = url.hostname;
    return h.endsWith(".cloudfront.net") || h === "higgsfield.ai" || h.endsWith(".higgsfield.ai");
  } catch {
    return false;
  }
}

// One path segment, filesystem-tame (mirrors safeName in index.js).
const cleanSeg = (s) =>
  String(s || "")
    .replace(/[^A-Za-z0-9 ._-]/g, "_")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 80)
    .trim();

// Folder may be nested ("chars/judges"); "." / "" means the library root.
function cleanFolder(folder) {
  return String(folder || "")
    .split("/")
    .map(cleanSeg)
    .filter(Boolean)
    .slice(0, 4)
    .join("/");
}

function basenameFromUrl(u) {
  try {
    return decodeURIComponent(new URL(u).pathname.split("/").pop() || "");
  } catch {
    return "";
  }
}

export function registerHiggsfield(app) {
  app.get("/api/higgsfield/images", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const token = await getHiggsfieldToken(c.env, userId);
    if (!token) return c.json({ error: "no_higgsfield_token" }, 401);

    const size = Math.min(100, Math.max(1, Number(c.req.query("size")) || 24));
    const cursor = c.req.query("cursor");
    const args = {
      type: "image",
      size,
      ...(cursor != null && cursor !== "" ? { cursor: Number(cursor) } : {}),
    };
    try {
      let data;
      try {
        data = await mcpToolCall(c.env, token, "show_generations", args);
      } catch (e) {
        // An expired bearer surfaces as a generic tool error, not a 401 — try
        // one forced refresh before giving up.
        const fresh = await forceRefreshHiggsfieldToken(c.env, userId);
        if (!fresh) throw e;
        data = await mcpToolCall(c.env, fresh, "show_generations", args);
      }
      const items = (data?.items || [])
        .filter((g) => g.status === "completed" && g?.results?.rawUrl)
        .map((g) => ({
          id: g.id,
          model: g.model,
          prompt: g.params?.prompt || "",
          width: g.params?.width || null,
          height: g.params?.height || null,
          rawUrl: g.results.rawUrl,
          minUrl: g.results.minUrl || g.results.rawUrl,
          createdAt: g.createdAt || null,
        }));
      return c.json({ items, nextCursor: data?.next_cursor ?? null });
    } catch (e) {
      if (e instanceof HiggsfieldAuthError) return c.json({ error: "no_higgsfield_token" }, 401);
      return c.json({ error: `Higgsfield: ${e.message || e}` }, 502);
    }
  });

  app.post("/api/higgsfield/import", async (c) => {
    const userId = c.get("userId");
    if (!userId) return c.json({ error: "Sign in required" }, 401);
    const pid = c.get("projectId");
    let body;
    try { body = await c.req.json(); } catch { body = {}; }
    const { rawUrl, minUrl, folder, name } = body || {};
    if (!isAllowedMediaUrl(rawUrl)) return c.json({ error: "Bad image URL" }, 400);

    const dir = cleanFolder(folder);
    const base = cleanSeg(name) || cleanSeg(basenameFromUrl(rawUrl));
    if (!/\.(png|jpe?g|webp|gif)$/i.test(base)) return c.json({ error: "Not an image file" }, 400);
    const rel = dir ? `${dir}/${base}` : base;
    const safePid = String(pid || "p_default").replace(/[^a-zA-Z0-9._-]/g, "") || "p_default";

    const src = await fetch(rawUrl);
    if (!src.ok) return c.json({ error: `Image fetch failed (${src.status})` }, 502);
    await c.env.BUCKET.put(`media/${safePid}/asset/${rel}`, src.body, {
      httpMetadata: { contentType: src.headers.get("content-type") || "image/png" },
    });

    // Thumb straight from Higgsfield's `_min.webp` — best-effort; the batched
    // ffmpeg backfill (ensureAssetThumbs) covers it if this fails.
    if (isAllowedMediaUrl(minUrl) && minUrl !== rawUrl) {
      try {
        const mn = await fetch(minUrl);
        if (mn.ok) {
          await c.env.BUCKET.put(proxyKey(pid, "asset", rel), mn.body, {
            httpMetadata: { contentType: mn.headers.get("content-type") || "image/webp" },
          });
        }
      } catch { /* fall back to generated thumb */ }
    }

    return c.json({ ok: true, rel, name: base, folder: dir || ".", url: `/asset/${rel}` });
  });
}
