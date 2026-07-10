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

const KINDS = new Set(["shots", "gen", "sound-media", "final", "refs", "multishot"]);

export function mediaKey(projectId, kind, file) {
  const pid = String(projectId || "p_default").replace(/[^a-zA-Z0-9._-]/g, "") || "p_default";
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
  };
  return map[prefix] || null;
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

// Store bytes as a project's media object. `body` is a Buffer/ArrayBuffer/stream.
export async function putMedia(env, projectId, kind, file, body, contentType) {
  await env.BUCKET.put(mediaKey(projectId, kind, file), body, {
    httpMetadata: contentType ? { contentType } : undefined,
  });
}

// Stream an R2 media object as a Response, honoring a Range request header so
// the browser's <video>/<audio> can seek. `key` is a full R2 key.
export async function streamKey(env, key, rangeHeader) {
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
  const total = obj.size;

  if (obj.range && (range?.offset !== undefined || range?.suffix !== undefined)) {
    const start = obj.range.offset ?? (total - (obj.range.length ?? 0));
    const len = obj.range.length ?? total - start;
    headers.set("content-range", `bytes ${start}-${start + len - 1}/${total}`);
    headers.set("content-length", String(len));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set("content-length", String(total));
  headers.set("cache-control", "public, max-age=3600");
  return new Response(obj.body, { headers });
}
