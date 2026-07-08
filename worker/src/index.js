// Shot Studio uploads Worker.
//
// Handles chat-attachment uploads for the eve agent chat:
//   POST /upload        — store an image in R2 + record a row in D1, return its URL
//   GET  /files/<key>   — stream an object back from R2 (this is the public URL the
//                         model fetches; no public bucket needed)
//   GET  /uploads       — the most recent uploads (from D1), for listing/debugging
//
// Bindings (see wrangler.jsonc): BUCKET → R2 bucket, DB → D1 database.

const ALLOW_HEADERS = "content-type,x-filename";
const ALLOW_METHODS = "GET,POST,OPTIONS";

function cors(origin) {
  return {
    "access-control-allow-origin": origin || "*",
    "access-control-allow-methods": ALLOW_METHODS,
    "access-control-allow-headers": ALLOW_HEADERS,
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors(origin) },
  });
}

// "my file (1).PNG" → "my_file_1_.PNG", capped to 80 chars.
function safeName(raw) {
  let name = "upload";
  try {
    name = decodeURIComponent(raw || "upload");
  } catch {
    name = raw || "upload";
  }
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^_+/, "").slice(-80) || "upload";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    // --- store an upload ---------------------------------------------------
    if (request.method === "POST" && url.pathname === "/upload") {
      const contentType = request.headers.get("content-type") || "application/octet-stream";
      const name = safeName(request.headers.get("x-filename"));
      const buf = await request.arrayBuffer();
      if (!buf || buf.byteLength === 0) return json({ error: "Empty upload body" }, 400, origin);

      const id = crypto.randomUUID();
      const key = `chat-uploads/${id}-${name}`;
      await env.BUCKET.put(key, buf, { httpMetadata: { contentType } });

      const size = buf.byteLength;
      const createdAt = new Date().toISOString();
      await env.DB.prepare(
        "INSERT INTO uploads (id, key, name, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(id, key, name, contentType, size, createdAt)
        .run();

      return json(
        { ok: true, id, url: `${url.origin}/files/${key}`, key, name, contentType, size },
        200,
        origin,
      );
    }

    // --- serve an object ---------------------------------------------------
    if (request.method === "GET" && url.pathname.startsWith("/files/")) {
      const key = decodeURIComponent(url.pathname.slice("/files/".length));
      const obj = await env.BUCKET.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("etag", obj.httpEtag);
      headers.set("cache-control", "public, max-age=31536000, immutable");
      headers.set("access-control-allow-origin", "*");
      return new Response(obj.body, { headers });
    }

    // --- recent uploads ----------------------------------------------------
    if (request.method === "GET" && url.pathname === "/uploads") {
      const { results } = await env.DB.prepare(
        "SELECT id, key, name, content_type, size, created_at FROM uploads ORDER BY created_at DESC LIMIT 100",
      ).all();
      return json({ uploads: results }, 200, origin);
    }

    if (url.pathname === "/") {
      return json({ ok: true, service: "shot-studio-uploads" }, 200, origin);
    }
    return new Response("Not found", { status: 404, headers: cors(origin) });
  },
};
