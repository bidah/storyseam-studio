// The proxy route table — the ONE source of truth for which request paths the
// SPA's host must forward to the Worker backend instead of serving the SPA.
// Consumed by BOTH hosts of the front-end:
//   • vite.config.js (local dev server) builds its `server.proxy` from it,
//   • desktop/ (the Electron origin bridge) classifies every app:// request
//     with it.
// A new backend prefix added here reaches both automatically; adding a path in
// only one place is impossible (see test/web/routeTable.test.js parity test).
//
// Pure data + a pure classifier: no imports, safe in node, the browser, and the
// Electron main process alike.

// Where the backend lives when nothing overrides it (WORKER env var in dev).
export const DEFAULT_WORKER_ORIGIN = "https://storyseam.app";

// Ordered prefix → kind list. Order matters: the SSE event paths and the agent
// path stream unbuffered and MUST match before the general "/api" prefix; the
// first `startsWith` match wins (the same first-match semantics Vite's proxy
// applies to its config keys, which are built from this list in order).
//   kind "sse" — live-sync / chat streams: forward unbuffered, no compression.
//   kind "api" — plain API + media: forward as-is.
export const ROUTE_TABLE = [
  { prefix: "/api/script/events", kind: "sse" },
  { prefix: "/api/timeline/events", kind: "sse" },
  { prefix: "/api/data/events", kind: "sse" },
  { prefix: "/api", kind: "api" },
  { prefix: "/media", kind: "api" },
  { prefix: "/multishot-media", kind: "api" },
  { prefix: "/refs", kind: "api" },
  // Trailing slash on purpose: every real request is `/asset/<rel>`, and a bare
  // "/asset" prefix would also swallow the SPA's built `/assets/*` bundle files
  // (fatal for the desktop bridge, which serves the built SPA).
  { prefix: "/asset/", kind: "api" },
  { prefix: "/thumb", kind: "api" },
  { prefix: "/hf-thumb", kind: "api" },
  // Tiered image derivatives — /img/<thumb|display>/<prefix>/<file>.
  { prefix: "/img/", kind: "api" },
  { prefix: "/final", kind: "api" },
  { prefix: "/gen", kind: "api" },
  { prefix: "/sound-media", kind: "api" },
  { prefix: "/proxy", kind: "api" },
  { prefix: "/stills", kind: "api" },
  { prefix: "/visual-media", kind: "api" },
  { prefix: "/moodboard-media", kind: "api" },
  { prefix: "/director-media", kind: "api" },
  { prefix: "/files", kind: "api" },
  // Link-preview cards (worker/src/routes/og.js). /watch itself stays the SPA's
  // here — the Worker only rewrites its og tags for crawlers in production.
  { prefix: "/og/", kind: "api" },
  // The flue chat agent — token streams, so it forwards like SSE (unbuffered).
  // /eve/* is same-origin so useFlueAgent() needs no host/CORS config; the
  // Worker owns /eve/*, injecting the session user id into the instance id +
  // minting the HMAC, then proxying to the flue worker. For a local stack set
  // FLUE_ORIGIN in worker/.dev.vars to the `flue dev` URL.
  { prefix: "/eve", kind: "sse" },
];

// Classify a request pathname for the host serving the SPA:
//   "forward-sse"  → proxy to the Worker, streaming, no buffering/compression
//   "forward-api"  → proxy to the Worker as-is
//   "serve-static" → not a backend path; serve the SPA (asset or index.html)
export function classifyPath(pathname) {
  for (const { prefix, kind } of ROUTE_TABLE) {
    if (pathname.startsWith(prefix)) {
      return kind === "sse" ? "forward-sse" : "forward-api";
    }
  }
  return "serve-static";
}

// Build the Vite dev-server `server.proxy` object from the table. Every entry
// forwards to the Worker with `changeOrigin` and stamps `x-app-origin` with the
// browser's REAL origin (the proxy's changeOrigin hides it) so the Worker's
// Better Auth builds the right OAuth redirect_uri + cookie domain in local dev.
// "sse" entries additionally force identity encoding so event streams pass
// through unbuffered.
export function buildDevProxy(workerOrigin, appOrigin) {
  const entry = (unbuffered) => ({
    target: workerOrigin,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on("proxyReq", (proxyReq) => {
        if (unbuffered) proxyReq.setHeader("accept-encoding", "identity");
        proxyReq.setHeader("x-app-origin", appOrigin);
      });
    },
  });
  const out = {};
  for (const { prefix, kind } of ROUTE_TABLE) {
    out[prefix] = entry(kind === "sse");
  }
  return out;
}
