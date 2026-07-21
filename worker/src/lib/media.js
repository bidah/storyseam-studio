// Per-project media in R2 — `media/<projectId>/<kind>/<file>`.
//
// Replaces the Express server's local media dirs + `express.static` mounts.
// `kind` mirrors the old URL prefixes:
//   shots       (was /media       → shot-by-shot/shots)
//   gen         (was /gen         → episode-multishot/generations)
//   sound-media (was /sound-media → sound-studio/media)
//   final       (was /final       → final_selection)
//   refs        (was /refs        → shot-by-shot)
//   multishot   (was /multishot-media)
//
// The Worker streams these back (with HTTP range support for video/audio
// seeking); writers (ffmpeg/remotion outputs, sound attach, uploads) put here.

import { normalizeProjectId } from "./docs.js";

const KINDS = new Set(["shots", "gen", "sound-media", "final", "refs", "multishot", "stills", "storyboard", "visual"]);

export function mediaKey(projectId, kind, file) {
  const pid = normalizeProjectId(projectId);
  const f = String(file || "").replace(/^\/+/, "").replace(/\.\.(\/|\\|$)/g, ""); // no traversal
  return `media/${pid}/${kind}/${f}`;
}

// URL prefix ("/gen/…") → kind. Returns null for unknown prefixes.
export function kindForPrefix(prefix) {
  const map = {
    media: "shots",
    gen: "gen",
    "sound-media": "sound-media",
    final: "final",
    refs: "refs",
    "multishot-media": "multishot",
    stills: "stills",
    "storyboard-media": "storyboard",
    "visual-media": "visual",
  };
  return map[prefix] || null;
}

// Preview-proxy key for a media file: `media/<pid>/proxy/<kind>/<file>`.
// Namespaced under a `proxy/` segment so `listMedia(pid, "gen")` never sees
// proxies (they'd otherwise pollute the media pool / duration surfaces).
// `kind` here is the *serving* prefix's kind (gen, multishot, sound-media).
export function proxyKey(projectId, kind, file) {
  return mediaKey(projectId, `proxy/${kind}`, file);
}

// List proxy basenames under a kind for a project (the file part after
// `media/<pid>/proxy/<kind>/`). Mirrors listMedia but for the proxy namespace.
export async function listProxies(env, projectId, kind) {
  const prefix = mediaKey(projectId, `proxy/${kind}`, "");
  const out = [];
  let cursor;
  do {
    const res = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const o of res.objects) out.push(o.key.slice(prefix.length));
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return out;
}

export async function mediaExists(env, projectId, kind, file) {
  if (!KINDS.has(kind)) return false;
  const obj = await env.BUCKET.head(mediaKey(projectId, kind, file));
  return !!obj;
}

// List the file names (basenames, sans the media/<pid>/<kind>/ prefix) under a
// kind for a project. Replaces the Express `fs.readdirSync` scans.
export async function listMedia(env, projectId, kind) {
  if (!KINDS.has(kind)) return [];
  const prefix = mediaKey(projectId, kind, "");
  const out = [];
  let cursor;
  do {
    const res = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    for (const o of res.objects) out.push(o.key.slice(prefix.length));
    cursor = res.truncated ? res.cursor : undefined;
  } while (cursor);
  return out;
}

// Like listMedia, but returns a Set of the basenames for O(1) existence checks.
// Use this to collapse an N-file "does each exist?" loop (N serial R2 HEADs)
// into ONE R2 list call, then `set.has(file)` in memory.
export async function listMediaSet(env, projectId, kind) {
  return new Set(await listMedia(env, projectId, kind));
}

// Store bytes as a project's media object. `body` is a Buffer/ArrayBuffer/stream.
export async function putMedia(env, projectId, kind, file, body, contentType) {
  await env.BUCKET.put(mediaKey(projectId, kind, file), body, {
    httpMetadata: contentType ? { contentType } : undefined,
  });
}

// Default cache-control for a media key. Gen/proxy/etc. keys are immutable by
// construction (`_genN`, `_trimN`, proxy encodes — never overwritten), so they
// get a 1-year immutable policy the browser HTTP cache can trust. The only
// overwritable family is `media/<pid>/final/*` (render.js rewrites a fixed
// `editor-render.mp4`), so those revalidate every time (cheap 304 via etag).
function defaultCacheControl(key) {
  return key.includes("/final/")
    ? "public, no-cache"
    : "public, max-age=31536000, immutable";
}

// if-none-match matcher: handles `*`, comma lists, and weak (`W/"…"`) tags.
function etagMatches(ifNoneMatch, etag) {
  if (!ifNoneMatch || !etag) return false;
  const strip = (s) => s.trim().replace(/^W\//, "");
  const target = strip(etag);
  return ifNoneMatch.split(",").some((t) => {
    const tok = t.trim();
    return tok === "*" || strip(tok) === target;
  });
}

// Stream an R2 media object as a Response, honoring a Range request header so
// the browser's <video>/<audio> can seek. `key` is a full R2 key.
//
// `opts`: { ifNoneMatch, cacheControl, extraHeaders } — `ifNoneMatch` enables
// 304 revalidation; `cacheControl` overrides the default policy (used by the
// proxy fallback to serve originals with a short TTL); `extraHeaders` are set
// on the final response (e.g. `x-proxy: fallback`).
//
// NOTE: Workers Cache API (`caches.default`) is a no-op on workers.dev and there
// is no custom domain, so the win here is purely the *browser* HTTP cache. If a
// custom domain is ever attached, add a `caches.default` block around this
// (~15 lines: check on entry, `waitUntil(cache.put(...))` before returning).
export async function streamKey(env, key, rangeHeader, opts = {}) {
  const { ifNoneMatch, cacheControl, extraHeaders } = opts;
  const cc = cacheControl || defaultCacheControl(key);

  let range;
  if (rangeHeader) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (m && (m[1] || m[2])) {
      const offset = m[1] ? Number(m[1]) : undefined;
      const end = m[2] ? Number(m[2]) : undefined;
      range = offset !== undefined && end !== undefined
        ? { offset, length: end - offset + 1 }
        : offset !== undefined
          ? { offset }
          : { suffix: end };
    }
  }

  const obj = await env.BUCKET.get(key, range ? { range } : undefined);
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("access-control-allow-origin", "*");
  headers.set("cache-control", cc);
  if (extraHeaders) for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
  const total = obj.size;

  // Conditional revalidation: unchanged object → 304, no body. Mainly helps the
  // no-cache `final/*` family; immutable keys aren't revalidated by browsers.
  if (etagMatches(ifNoneMatch, obj.httpEtag)) {
    return new Response(null, { status: 304, headers });
  }

  if (obj.range && (range?.offset !== undefined || range?.suffix !== undefined)) {
    const start = obj.range.offset ?? (total - (obj.range.length ?? 0));
    const len = obj.range.length ?? total - start;
    headers.set("content-range", `bytes ${start}-${start + len - 1}/${total}`);
    headers.set("content-length", String(len));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(total));
  return new Response(obj.body, { headers });
}
