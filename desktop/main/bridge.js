// The origin bridge: the app:// protocol handler that hosts the unchanged web
// SPA in production. Every request to the app origin is classified with the
// SHARED route table (src/lib/routeTable.js, vendored by scripts/sync-shared.mjs
// — never a path list of its own):
//   forward-api / forward-sse → forwarded to the deployed Worker through the
//     Electron session's network stack (net.fetch, credentials: "include"), so
//     the Better Auth session cookie in the app's cookie jar rides along and
//     Set-Cookie responses land back in it. SSE forwards force identity
//     encoding and stream straight through (net.fetch responses are streamed).
//   serve-static → the bundled Vite build (index.html SPA fallback), with a
//     strict CSP stamped on documents.
import { net, protocol } from "electron";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { classifyPath } from "./routeTable.js";

export const APP_SCHEME = "app";
export const APP_HOST = "shot-studio";
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

// Must run before app.whenReady(): make app:// a first-class secure origin so
// fetch/XHR/EventSource/localStorage/history all behave exactly like https.
export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: false,
      },
    },
  ]);
}

// Everything same-origin ('self') plus https: for the direct-to-provider calls
// the web app is allowed to make (uploads, provider thumbs); scripts stay
// 'self'-only — inline scripts in index.html (the theme bootstrap) are
// whitelisted by hash, computed at serve time so an edited inline script can't
// silently break the desktop build. ws/wss for potential live streams;
// blob/data for previews.
const cspFor = (html) => {
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(([, body]) => `'sha256-${createHash("sha256").update(body).digest("base64")}'`)
    .join(" ");
  return CSP.replace("script-src 'self'", `script-src 'self' ${hashes}`.trimEnd());
};
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' blob: data: https: wss:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
].join("; ");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

async function forward(request, url, kind, workerOrigin) {
  const target = workerOrigin + url.pathname + url.search;
  const headers = new Headers(request.headers);
  // The renderer talks to app://shot-studio; the Worker must see itself as the
  // origin (its own OAuth redirect_uri, cookie domain, CSRF checks). Note: NO
  // x-app-origin here — unlike the Vite dev proxy, the Worker's own origin IS
  // the app origin for the desktop build.
  headers.delete("host");
  headers.delete("referer");
  if (headers.has("origin")) headers.set("origin", workerOrigin);
  if (kind === "forward-sse") headers.set("accept-encoding", "identity");
  try {
    // Buffer the body: net.fetch can't take protocol.handle's request stream
    // directly (the forward dies with "Failed to fetch"). Bridged writes are
    // JSON API calls — large uploads go to the Worker origin directly.
    const body =
      request.method === "GET" || request.method === "HEAD" || !request.body
        ? undefined
        : await request.arrayBuffer();
    return await net.fetch(target, {
      method: request.method,
      headers,
      body,
      // Attach the session cookie jar (Better Auth session) and store
      // Set-Cookie responses back into it.
      credentials: "include",
      cache: "no-store",
    });
  } catch (err) {
    // Backend unreachable — a structured 502 the SPA's error boundaries show
    // as a load error with Retry, instead of a hung request.
    return Response.json(
      { error: "backend-unreachable", detail: String(err?.message || err) },
      { status: 502, headers: { "x-desktop-bridge": "unreachable" } },
    );
  }
}

function serveStatic(pathname, distDir) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    rel = pathname;
  }
  let file = path.normalize(path.join(distDir, rel));
  // Traversal guard: anything that escapes dist falls back to the SPA shell.
  if (!file.startsWith(distDir + path.sep)) file = path.join(distDir, "index.html");
  if (!existsSync(file) || !statSync(file).isFile()) {
    // SPA fallback: /script, /episode, … are client-side routes.
    file = path.join(distDir, "index.html");
  }
  const ext = path.extname(file).toLowerCase();
  const isDoc = ext === ".html";
  const headers = {
    "content-type": MIME[ext] || "application/octet-stream",
    // Hashed bundle assets are immutable; the document must revalidate so a
    // new build shows up on next launch.
    "cache-control": isDoc ? "no-cache" : "public, max-age=31536000, immutable",
  };
  if (isDoc) {
    // Documents are tiny — read them whole so the CSP can hash inline scripts.
    const html = readFileSync(file, "utf8");
    headers["content-security-policy"] = cspFor(html);
    return new Response(html, { status: 200, headers });
  }
  return new Response(Readable.toWeb(createReadStream(file)), { status: 200, headers });
}

// Register the app:// handler on the (default) session. Call after app ready.
export function registerBridge({ distDir, workerOrigin }) {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    const kind = classifyPath(url.pathname);
    if (kind === "serve-static") return serveStatic(url.pathname, distDir);
    return forward(request, url, kind, workerOrigin);
  });
}
