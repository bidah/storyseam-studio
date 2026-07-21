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
import { proxyKey, streamKey } from "../lib/media.js";
import { ensureHfThumbs } from "../lib/proxy.js";
import {
  getHiggsfieldToken,
  forceRefreshHiggsfieldToken,
  mcpToolCall,
  HiggsfieldAuthError,
  isAllowedMediaUrl,
} from "../lib/higgsfield.js";

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

// Verify the HMAC assertion the eve agent sends to the token-bridge endpoint
// (payload `{ sub, iss: "shot-studio-agent", exp }`, signed with the shared
// EVE_PROXY_SECRET — the reverse direction of the `x-eve-proxy-user` header).
const AGENT_ASSERTION_ISSUER = "shot-studio-agent";

function b64urlDecode(input) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (input.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function verifyAgentAssertion(token, secret) {
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const payloadPart = token.slice(0, dot);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  let sig;
  try { sig = b64urlDecode(token.slice(dot + 1)); } catch { return null; }
  if (!(await crypto.subtle.verify("HMAC", key, sig, enc.encode(payloadPart)))) return null;
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadPart))); } catch { return null; }
  if (payload.iss !== AGENT_ASSERTION_ISSUER) return null;
  if (typeof payload.sub !== "string" || !payload.sub) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 < Date.now()) return null;
  return { sub: payload.sub };
}

// `accessTokenExpiresAt` is whatever Better Auth stored (ISO string or epoch);
// normalize to epoch ms, or null when unparsable.
function expiryMs(v) {
  if (v == null || v === "") return null;
  const t = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

export function registerHiggsfield(app) {
  // Token bridge for the eve agent: exchange a signed agent assertion for the
  // signed-in user's live Higgsfield bearer (refreshed here as needed). This is
  // what lets the render skills reuse the app login's Higgsfield credential
  // instead of requiring a second, agent-only sign-in. 401 means the user has
  // no usable credential — the agent then falls back to its interactive OAuth.
  app.get("/api/agent/higgsfield-token", async (c) => {
    const secret = c.env.FLUE_PROXY_SECRET || c.env.EVE_PROXY_SECRET;
    const bearer = (c.req.header("authorization") || "").replace(/^Bearer\s+/i, "");
    const claims = secret && bearer ? await verifyAgentAssertion(bearer, secret) : null;
    if (!claims) return c.json({ error: "unauthorized" }, 401);

    const force = c.req.query("force") === "1";
    const token = force
      ? await forceRefreshHiggsfieldToken(c.env, claims.sub)
      : await getHiggsfieldToken(c.env, claims.sub);
    if (!token) return c.json({ error: "no_higgsfield_token" }, 401);

    // Report the stored expiry so the agent's token cache can re-fetch in time;
    // cap at 10 minutes so a missing/far-future expiry still cycles through the
    // refresh logic here regularly.
    const row = await c.env.DB.prepare(
      "SELECT accessTokenExpiresAt FROM account WHERE userId = ? AND providerId = 'higgsfield'",
    ).bind(claims.sub).first();
    const cap = Date.now() + 10 * 60_000;
    const stored = expiryMs(row?.accessTokenExpiresAt);
    return c.json({ token, expiresAt: stored ? Math.min(stored, cap) : cap });
  });

  // Gallery thumbnail: the cached 640px webp if the encode has landed, else a
  // short-lived 302 to the (full-res) CloudFront minUrl passed as ?src=. The
  // redirect is what makes fresh pages paint instantly; the cache is what makes
  // revisits cheap.
  app.get("/hf-thumb/:id", async (c) => {
    const id = c.req.param("id");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return c.text("Not found", 404);
    const key = `hf-thumbs/${id}.webp`;
    if (await c.env.BUCKET.head(key)) {
      return streamKey(c.env, key, c.req.header("range"), {
        ifNoneMatch: c.req.header("if-none-match"),
      });
    }
    const src = c.req.query("src");
    if (!isAllowedMediaUrl(src)) return c.text("Not found", 404);
    return new Response(null, {
      status: 302,
      headers: { location: src, "cache-control": "public, max-age=60" },
    });
  });

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
        .map((g) => {
          const minUrl = g.results.minUrl || g.results.rawUrl;
          return {
            id: g.id,
            model: g.model,
            prompt: g.params?.prompt || "",
            width: g.params?.width || null,
            height: g.params?.height || null,
            rawUrl: g.results.rawUrl,
            minUrl,
            // Grid src: cached 640px webp once encoded, 302 → minUrl until then.
            thumb: `/hf-thumb/${g.id}?src=${encodeURIComponent(minUrl)}`,
            createdAt: g.createdAt || null,
          };
        });
      // Batch-encode any of this page's thumbs we don't have yet (background).
      c.executionCtx.waitUntil(
        ensureHfThumbs(c.env, items.map(({ id, minUrl }) => ({ id, minUrl }))),
      );
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
    let base = cleanSeg(name) || cleanSeg(basenameFromUrl(rawUrl));
    // A custom name may omit the extension ("elara_closeup") — borrow it from
    // the delivery URL's file name.
    if (!/\.(png|jpe?g|webp|gif)$/i.test(base)) {
      const ext = (/\.(png|jpe?g|webp|gif)$/i.exec(cleanSeg(basenameFromUrl(rawUrl))) || [""])[0];
      base += ext;
    }
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
