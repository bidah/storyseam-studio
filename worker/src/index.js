// Shot Studio Worker (Hono).
//
// This is being migrated from the Express server (shot-studio/server/index.js)
// to be the whole backend on Cloudflare — API + data (D1/R2) + media (R2) + the
// built SPA (Worker Assets). Stage 0 keeps the existing surface intact while
// switching to Hono; later stages port the remaining Express endpoint groups.
//
// Current routes (called by the Express API during the strangler migration, and
// by the browser for uploads):
//   POST   /upload         — store an upload in R2 + a row in D1, return its URL
//   GET    /files/<key>    — stream an object back from R2 (public fetch URL)
//   GET    /uploads        — recent uploads (D1)
//   GET    /script         — read a project's script store (R2 JSON blob)
//   PUT    /script         — save a project's script store to R2 (verbatim)
//   GET    /projects       — list projects (D1 registry)
//   POST   /projects       — create a project { name }
//   PATCH  /projects/:id   — rename a project
//   DELETE /projects/:id   — soft-delete a project (+ drop its script object)
//   GET    /healthz        — service health
//   *                      — otherwise serve the SPA from Worker Assets
//
// Bindings (wrangler.jsonc): BUCKET → R2, DB → D1, ASSETS → built SPA.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerWorld } from "./routes/world.js";
import { registerShotlist } from "./routes/shotlist.js";
import { registerRadio } from "./routes/radio.js";
import { registerAnimatic } from "./routes/animatic.js";
import { registerScript } from "./routes/script.js";
import { registerSounds } from "./routes/sounds.js";
import { registerEpisode } from "./routes/episode.js";
import { registerTimeline } from "./routes/timeline.js";
import { registerSecrets } from "./routes/auth.js";
import { registerLibrary } from "./routes/library.js";
import { registerCuts } from "./routes/cuts.js";
import { registerProjects, getActiveProject, userCanAccessProject } from "./routes/projects.js";
import { registerRender } from "./routes/render.js";
import { registerExport } from "./routes/export.js";
import { registerAdmin } from "./routes/admin.js";
import { registerHiggsfield } from "./routes/higgsfield.js";
import { registerStoryboard } from "./routes/storyboard.js";
import { registerTranscribe } from "./routes/transcribe.js";
import { createAuth } from "./auth.js";
import { broadcast } from "./lib/broadcast.js";
import { normalizeProjectId } from "./lib/docs.js";
import { kindForPrefix, mediaKey, proxyKey, streamKey } from "./lib/media.js";
import { ensureProxy } from "./lib/proxy.js";

// Durable Object for per-project SSE live-sync (script + timeline channels).
export { ProjectEvents } from "./sse-do.js";

// --- eve proxy user token --------------------------------------------------
// The eve agent (on Vercel) is publicly reachable and can't see the Better Auth
// session cookie (that lives on this Worker's origin). To let a signed-in user
// reach the agent AS a user — required for the in-chat Higgsfield OAuth sign-in,
// which needs `principalType: "user"` — the Worker mints a short-lived
// HMAC-signed token carrying the session user id and hands it to the agent on
// the `x-eve-proxy-user` header. The agent verifies it with the same shared
// secret (EVE_PROXY_SECRET) and projects `sub` into a user principal. See
// agent/channels/eve.ts (proxiedUser).
// Shared HMAC identity handed to the flue agent worker on the proxy hop. Issuer
// stays "shot-studio" (matches flue-agent/src/lib/proxy-auth.ts). Header renamed
// eve → flue; the secret falls back to EVE_PROXY_SECRET so the already-provisioned
// value keeps working until it's renamed to FLUE_PROXY_SECRET.
const FLUE_PROXY_ISSUER = "shot-studio";
const FLUE_PROXY_HEADER = "x-flue-proxy-user";
const FLUE_PROXY_TTL_SECONDS = 300;

function base64url(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintFlueUserToken(userId, secret) {
  const enc = new TextEncoder();
  const payload = base64url(
    enc.encode(
      JSON.stringify({
        sub: String(userId),
        iss: FLUE_PROXY_ISSUER,
        exp: Math.floor(Date.now() / 1000) + FLUE_PROXY_TTL_SECONDS,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return `${payload}.${base64url(sig)}`;
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

const app = new Hono();

app.use(
  "*",
  cors({
    origin: (o) => o || "*",
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["content-type", "x-filename", "x-project-id", "x-client-id", "authorization", "x-app-origin"],
    maxAge: 86400,
    credentials: true,
  }),
);

// --- Better Auth (email/password login + sessions) -------------------------
// A fresh auth instance per request (Workers are stateless). Mount its handler
// at /api/auth/* and expose the session's user id on the context for per-user
// scoping. See src/auth.js.
//
// Local dev vs deployed: the browser's real origin decides the OAuth redirect_uri
// + cookie domain. When deployed, that's the Worker's own origin. In local dev
// the browser is on http://localhost:3333 and Vite proxies /api here (losing the
// origin), so Vite forwards it in `x-app-origin` — honored only for trusted
// origins to prevent spoofing.
const TRUSTED_APP_ORIGINS = [
  "http://localhost:3333",
  "https://shot-studio-uploads.rodrigofigueroa-name.workers.dev",
];
function appOrigin(c) {
  const claimed = c.req.header("x-app-origin");
  if (claimed && TRUSTED_APP_ORIGINS.includes(claimed)) return claimed;
  return new URL(c.req.url).origin;
}
app.use("*", async (c, next) => {
  c.set("auth", createAuth(c.env, c.req.raw.cf || {}, appOrigin(c)));
  await next();
});
app.on(["GET", "POST"], "/api/auth/*", (c) => c.get("auth").handler(c.req.raw));

// Load the session user for every request (the cookie rides along on media
// streams too, so per-user resolution + ownership work everywhere). Skip the
// auth routes themselves and the SPA assets.
app.use("*", async (c, next) => {
  const p = new URL(c.req.url).pathname;
  if (!p.startsWith("/api/auth/")) {
    try {
      const session = await c.get("auth").api.getSession({ headers: c.req.raw.headers });
      if (session?.user) c.set("userId", session.user.id);
    } catch { /* unauthenticated */ }
  }
  await next();
});

// Resolve the active project (x-project-id header, ?projectId=, else the user's
// active/most-recent project) AND enforce per-user ownership on data routes so
// one user can't read another's project by guessing an id.
app.use("*", async (c, next) => {
  const p = new URL(c.req.url).pathname;
  const userId = c.get("userId");
  const named = c.req.header("x-project-id") || c.req.query("projectId");
  const pid = named || (await getActiveProject(c.env, userId));
  c.set("projectId", pid);

  const isData = p.startsWith("/api/") && !p.startsWith("/api/auth/") && !p.startsWith("/api/projects");
  if (isData && userId && pid && !(await userCanAccessProject(c.env, userId, pid))) {
    return c.json({ error: "Forbidden" }, 403);
  }
  await next();
});

// Live-sync firehose: after any SUCCESSFUL /api/* mutation, announce it on the
// project's "data" channel so open tabs refetch immediately (no manual Refresh).
// Skips reads, the auth + *_events endpoints, and script/timeline (they emit
// their own targeted payloads on dedicated channels). The browser stamps its own
// writes with `x-client-id` so the client can ignore its own echoes; the agent
// sends none, so agent writes always reach the tabs. Runs under waitUntil so the
// DO fan-out never delays the write's response.
app.use("*", async (c, next) => {
  await next();
  const method = c.req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const p = new URL(c.req.url).pathname;
  if (!p.startsWith("/api/") || p.startsWith("/api/auth/") || p.endsWith("/events")) return;
  if (p.startsWith("/api/script") || p.startsWith("/api/timeline")) return;
  if (!c.res || c.res.status >= 400) return;
  broadcast(
    c.env,
    c.get("projectId"),
    "data",
    {
      path: p,
      // Coarse resource key ("sounds", "world", "episode", …) so the client can
      // move from invalidate-everything to targeted invalidation later.
      resource: p.split("/")[2] || null,
      clientId: c.req.header("x-client-id") || null,
      at: Date.now(),
    },
    c.executionCtx,
  );
});

app.get("/healthz", (c) => c.json({ ok: true, service: "shot-studio-uploads" }));

// --- store an upload -------------------------------------------------------
app.post("/upload", async (c) => {
  const env = c.env;
  const url = new URL(c.req.url);
  const contentType = c.req.header("content-type") || "application/octet-stream";
  const name = safeName(c.req.header("x-filename"));
  const buf = await c.req.arrayBuffer();
  if (!buf || buf.byteLength === 0) return c.json({ error: "Empty upload body" }, 400);

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

  return c.json({ ok: true, id, url: `${url.origin}/files/${key}`, key, name, contentType, size });
});

// --- recent uploads --------------------------------------------------------
app.get("/uploads", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, key, name, content_type, size, created_at FROM uploads ORDER BY created_at DESC LIMIT 100",
  ).all();
  return c.json({ uploads: results });
});

// NOTE: the legacy top-level `/projects*` and `/script` routes were removed to
// free those URL namespaces for the React Router SPA (a client route like
// `/script` would otherwise be answered by this JSON API on a hard reload). The
// canonical equivalents live under `/api/projects*` (routes/projects.js) and
// `/api/script*` (routes/script.js); nothing calls the old top-level paths.

// --- token-guarded R2 write ------------------------------------------------
// Lets the Daytona ffmpeg/render sandboxes push outputs back to R2 without R2
// S3 credentials — they PUT to /ingest/<key> with a bearer token; the Worker
// writes via its binding. (Inputs are pulled from the public /files/<key>.)
app.put("/ingest/*", async (c) => {
  const auth = c.req.header("authorization") || "";
  if (!c.env.INGEST_TOKEN || auth !== `Bearer ${c.env.INGEST_TOKEN}`) {
    return c.text("Unauthorized", 401);
  }
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/ingest/".length));
  await c.env.BUCKET.put(key, c.req.raw.body, {
    httpMetadata: { contentType: c.req.header("content-type") || "application/octet-stream" },
  });
  proxyOnIngest(c, key);
  return c.json({ ok: true, key });
});

// When a gen/multishot mp4 lands in R2, kick off 720p proxy generation in the
// background so the editor previews it. Skips final/ (overwritable renders) and
// proxy/ (the encode output itself). ensureProxy dedupes + locks internally.
function proxyOnIngest(c, key) {
  const m = /^media\/([^/]+)\/(gen|multishot)\/([^/]+\.mp4)$/.exec(key || "");
  if (!m) return;
  const [, pid, kind, file] = m;
  c.executionCtx.waitUntil(ensureProxy(c.env, { pid, kind, file }));
}

// --- token-guarded R2 multipart write (for outputs >100MB, the Worker request
// body cap) — the sandbox splits the file and uploads parts. ---------------
function ingestAuthed(c) {
  const auth = c.req.header("authorization") || "";
  return c.env.INGEST_TOKEN && auth === `Bearer ${c.env.INGEST_TOKEN}`;
}
app.post("/ingest-mpu/start", async (c) => {
  if (!ingestAuthed(c)) return c.text("Unauthorized", 401);
  const key = c.req.query("key");
  const mpu = await c.env.BUCKET.createMultipartUpload(key);
  return c.json({ uploadId: mpu.uploadId });
});
app.put("/ingest-mpu/part", async (c) => {
  if (!ingestAuthed(c)) return c.text("Unauthorized", 401);
  const key = c.req.query("key");
  const uploadId = c.req.query("uploadId");
  const partNumber = Number(c.req.query("part"));
  const mpu = c.env.BUCKET.resumeMultipartUpload(key, uploadId);
  const part = await mpu.uploadPart(partNumber, c.req.raw.body);
  return c.json({ partNumber, etag: part.etag });
});
app.post("/ingest-mpu/complete", async (c) => {
  if (!ingestAuthed(c)) return c.text("Unauthorized", 401);
  const key = c.req.query("key");
  const uploadId = c.req.query("uploadId");
  const body = await c.req.json();
  const mpu = c.env.BUCKET.resumeMultipartUpload(key, uploadId);
  await mpu.complete(body.parts);
  proxyOnIngest(c, key);
  return c.json({ ok: true, key });
});

// --- stream an R2 object ---------------------------------------------------
// Delegated to streamKey so this gets Range support (ffmpeg-sandbox `curl`
// inputs still work — a plain GET returns the full 200 body) and the shared
// cache policy (immutable for gen/*, no-cache for the overwritable final/*,
// instead of the old blanket immutable which cached stale re-renders).
app.get("/files/*", (c) => {
  const key = decodeURIComponent(new URL(c.req.url).pathname.slice("/files/".length));
  return streamKey(c.env, key, c.req.header("range"), {
    ifNoneMatch: c.req.header("if-none-match"),
  });
});

// --- live-sync SSE (script + timeline), backed by the ProjectEvents DO -------
function eventsRoute(channel) {
  return (c) => {
    // normalizeProjectId: subscribe with the SAME key broadcast() and the doc
    // stores use, so a null-project subscriber and a null-project writer meet
    // on the p_default DO instead of silently diverging.
    const stub = c.env.PROJECT_EVENTS.get(
      c.env.PROJECT_EVENTS.idFromName(normalizeProjectId(c.get("projectId"))),
    );
    return stub.fetch(`https://do/subscribe?channel=${channel}`);
  };
}
app.get("/api/script/events", eventsRoute("script"));
app.get("/api/timeline/events", eventsRoute("timeline"));
// Generic live-sync firehose: every successful /api/* mutation (except script &
// timeline, which have their own targeted channels above) is announced here so
// open tabs — shot list, episode, cuts, library, sound studio — refetch the
// moment the chat agent changes anything, no manual Refresh needed. See the
// post-mutation broadcast middleware below.
app.get("/api/data/events", eventsRoute("data"));

// --- media streaming from R2 (replaces the Express express.static mounts) ----
// Each old static prefix maps to a per-project R2 key media/<pid>/<kind>/<file>,
// streamed with HTTP range support for <video>/<audio> seeking.
function mediaRoute(prefix) {
  const kind = kindForPrefix(prefix);
  const skip = prefix.length + 2; // "/<prefix>/"
  return (c) => {
    const file = decodeURIComponent(new URL(c.req.url).pathname.slice(skip));
    return streamKey(c.env, mediaKey(c.get("projectId"), kind, file), c.req.header("range"), {
      ifNoneMatch: c.req.header("if-none-match"),
    });
  };
}
for (const p of ["media", "gen", "sound-media", "final", "refs", "multishot-media", "stills", "storyboard-media"]) {
  app.get(`/${p}/*`, mediaRoute(p));
}
// The shared asset library (voice refs, browsable images) — per project under
// media/<pid>/asset/. (The library-browse endpoints are ported separately.)
app.get("/asset/*", (c) => {
  const rel = decodeURIComponent(new URL(c.req.url).pathname.slice("/asset/".length));
  return streamKey(c.env, `media/${c.get("projectId")}/asset/${rel}`, c.req.header("range"), {
    ifNoneMatch: c.req.header("if-none-match"),
  });
});

// --- asset-library image thumbnails ------------------------------------------
// `/thumb/<rel>` serves the small webp (media/<pid>/proxy/asset/<rel>) if it
// exists, else the full-res original short-lived as a fallback. Thumbs are
// written at Higgsfield-import time (from the ready-made minUrl) or batched by
// ensureAssetThumbs when /api/library spots missing ones — no per-request
// generation here, so a folder of N images never fans out N sandbox jobs.
app.get("/thumb/*", async (c) => {
  const rel = decodeURIComponent(new URL(c.req.url).pathname.slice("/thumb/".length));
  const pid = c.get("projectId");
  const range = c.req.header("range");
  const ifNoneMatch = c.req.header("if-none-match");
  const tKey = proxyKey(pid, "asset", rel);
  if (await c.env.BUCKET.head(tKey)) return streamKey(c.env, tKey, range, { ifNoneMatch });
  return streamKey(c.env, mediaKey(pid, "asset", rel), range, {
    ifNoneMatch,
    cacheControl: "public, max-age=60",
    extraHeaders: { "x-thumb": "fallback" },
  });
});

// --- 720p preview proxies --------------------------------------------------
// The editor timeline / cuts page preview a low-bitrate proxy instead of the
// full-res original (see lib/proxy.js). `/proxy/<prefix>/<file>` serves the
// proxy if it exists; otherwise it streams the ORIGINAL with a short TTL (so
// fresh gens play immediately) and kicks off lazy proxy generation in the
// background. Never a 302 — the client always gets bytes on the first hit.
const PROXY_PREFIXES = new Set(["gen", "multishot-media", "sound-media"]);
app.get("/proxy/:prefix/*", async (c) => {
  const prefix = c.req.param("prefix");
  const kind = kindForPrefix(prefix);
  if (!PROXY_PREFIXES.has(prefix) || !kind) return c.text("Not found", 404);
  const pid = c.get("projectId");
  const file = decodeURIComponent(
    new URL(c.req.url).pathname.slice(`/proxy/${prefix}/`.length),
  );
  const pKey = proxyKey(pid, kind, file);
  const range = c.req.header("range");
  const ifNoneMatch = c.req.header("if-none-match");

  const head = await c.env.BUCKET.head(pKey);
  if (head) return streamKey(c.env, pKey, range, { ifNoneMatch });

  // No proxy yet — serve the original short-lived and generate one lazily.
  c.executionCtx.waitUntil(ensureProxy(c.env, { pid, kind, file }));
  return streamKey(c.env, mediaKey(pid, kind, file), range, {
    ifNoneMatch,
    cacheControl: "public, max-age=60",
    extraHeaders: { "x-proxy": "fallback" },
  });
});

// --- ported API route groups (Stage 1+) ------------------------------------
registerWorld(app);
registerShotlist(app);
registerRadio(app);
registerAnimatic(app);
registerScript(app);
registerSounds(app);
registerEpisode(app);
registerTimeline(app);
registerSecrets(app);
registerLibrary(app);
registerCuts(app);
registerProjects(app);
registerRender(app);
registerExport(app);
registerAdmin(app);
registerHiggsfield(app);
registerStoryboard(app);
registerTranscribe(app);

// --- flue chat agent proxy -------------------------------------------------
// The chat agent (flue) runs as its own Cloudflare Worker (shot-studio-flue).
// The SPA is served from this Worker and calls /eve/* SAME-ORIGIN, so proxy those
// through to the flue worker, stripping the /eve prefix (flue serves its agent
// routes at /agents/:name/:id). Covers every method — GET for the SSE/stream
// views, POST for prompts. Returning the upstream Response verbatim streams the
// body without buffering. Listed in wrangler.jsonc `run_worker_first` so it beats
// the SPA asset layer. (Path kept as /eve/* to avoid client churn this pass; the
// header/functions are flue-named. Renaming the path + moving to a CF service
// binding is a later consolidation step.)
const DEFAULT_FLUE_ORIGIN = "https://shot-studio-flue.rodrigofigueroa-name.workers.dev";
app.all("/eve/*", async (c) => {
  const url = new URL(c.req.url);
  const origin = c.env.FLUE_ORIGIN || c.env.EVE_ORIGIN || DEFAULT_FLUE_ORIGIN;
  let path = url.pathname.replace(/^\/eve/, "") || "/";
  const userId = c.get("userId");
  // Inject the authenticated user id into the agent instance id. The client
  // addresses `/agents/<name>/<projectId>~<chatId>`; we prepend `<userId>~` so
  // the flue worker scopes the conversation (and its per-user Higgsfield token)
  // to this user. Because the id prefix and the HMAC `sub` below both come from
  // the session user, flue's ownership check always passes and a client can
  // never address another user's conversation.
  if (userId) {
    const m = path.match(/^\/agents\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (m) {
      const [, name, id, rest = ""] = m;
      path = `/agents/${name}/${userId}~${id}${rest}`;
    }
  }
  const target = new URL(path + url.search, origin);
  // Canonical Workers reverse-proxy: rebuilding the Request against the flue
  // origin preserves method, headers, and the (streaming) body. We rebuild the
  // headers explicitly (rather than reusing c.req.raw.headers wholesale) so the
  // inbound `Host` header for this Worker doesn't ride along — over a public-URL
  // worker→worker fetch a stale Host makes Cloudflare's edge 404 the request.
  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  // The agent trusts x-flue-proxy-user as an authenticated user id, so it must
  // only ever come from us: strip any client-supplied copy, then re-add a
  // freshly-signed one for the Better Auth session user (if any). Without the
  // secret configured we send nothing and the agent rejects (401).
  headers.delete(FLUE_PROXY_HEADER);
  const secret = c.env.FLUE_PROXY_SECRET || c.env.EVE_PROXY_SECRET;
  if (userId && secret) {
    headers.set(FLUE_PROXY_HEADER, await mintFlueUserToken(userId, secret));
  }
  const method = c.req.raw.method;
  const hasBody = method !== "GET" && method !== "HEAD";
  const proxied = new Request(target, {
    method,
    headers,
    // Stream the request body through for POST/etc. `duplex: "half"` is required
    // when the body is a ReadableStream. GET/HEAD carry no body.
    ...(hasBody ? { body: c.req.raw.body, duplex: "half" } : {}),
    redirect: "manual",
  });
  // In prod, dispatch through the Cloudflare service binding (in-process
  // worker→worker, no DNS/Host routing — the public-URL fetch 404'd there). In
  // local dev flue runs as its own `flue dev` process reached over FLUE_ORIGIN
  // (a localhost URL), so fall back to fetch() then — the `wrangler dev` service
  // binding would otherwise try (and fail) to resolve a local shot-studio-flue.
  const localOrigin = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)(:|\/|$)/.test(origin);
  return c.env.FLUE && !localOrigin ? c.env.FLUE.fetch(proxied) : fetch(proxied);
});

// --- SPA fallback (Worker Assets) ------------------------------------------
// Anything not matched above is served from the built SPA. The assets binding's
// single-page-application not_found_handling returns index.html for client routes.
app.get("*", (c) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.text("Not found", 404)));

export default app;
