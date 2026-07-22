// Network-mock harness for the Playwright flow suite.
//
// The SPA is gated behind a Better Auth session and the dev server proxies
// `/api` → the DEPLOYED prod Worker (see vite.config.js). To exercise the real
// route tree offline and deterministically, we intercept every same-origin
// backend call with page.route() and serve fixtures: a signed-in session, one
// project, quiet SSE streams, and an empty-but-valid payload per tab loader.
//
// Fixtures are intentionally MINIMAL — each tab has an empty-state, so an empty
// payload still mounts the real route component, loader, lazy chunk, and error
// boundary. Tests that need populated content pass `overrides` to seed a tab.

const SESSION = {
  user: {
    id: "u_test",
    name: "Test User",
    email: "test@example.com",
    emailVerified: true,
    image: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
  session: {
    id: "s_test",
    userId: "u_test",
    token: "tok_test",
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
  },
};

const PROJECT = { id: "p_test", name: "Test Project" };

// Empty-but-valid payload for each tab loader (keyed by pathname). Shapes match
// what the route components read; empties trigger each tab's empty-state.
const DEFAULT_ROUTES = {
  "/api/projects": { projects: [PROJECT], activeId: PROJECT.id },
  "/api/shots": { shots: [] },
  "/api/world": { world: "", locations: [], characters: [] },
  "/api/visual-world": { board: { nodes: [], edges: [] }, nodes: [], edges: [] },
  "/api/shotlist": { shots: [], bundles: [] },
  "/api/radio": { takes: [], lines: [], pacing: null },
  "/api/animatic/view": { items: [], bundles: [], shots: [] },
  "/api/episode": { episode: { bundles: [] } },
  "/api/library": { folders: [] },
  "/api/final": { items: [] },
  "/api/audio": { items: [] },
  "/api/storyboard": { stills: {}, bundles: [] },
  "/api/episode/cuts": { range: { from: "MS-01", to: "MS-01" }, segments: [], music: [], history: [], output: null },
  "/api/sounds": { tracks: [] },
};

function jsonResponse(body, status = 200) {
  return {
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify(body),
  };
}

// A live-but-silent SSE response so EventSource opens without spewing reconnects.
function sseResponse() {
  return {
    status: 200,
    contentType: "text/event-stream",
    headers: { "cache-control": "no-cache", connection: "keep-alive" },
    body: ": connected\n\n",
  };
}

/**
 * Install the backend mock on a page.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} [opts]
 * @param {boolean} [opts.signedIn=true]  serve a session (false → login gate)
 * @param {Record<string, any>} [opts.routes]  per-pathname payload overrides;
 *        a value may be `{ __status, __body }` to force an error response.
 */
export async function mockBackend(page, opts = {}) {
  const { signedIn = true, routes = {} } = opts;
  const table = { ...DEFAULT_ROUTES, ...routes };

  // Playwright evaluates routes LAST-registered-first, so register from
  // least- to most-specific: the catch-all goes first, specific overrides after.

  // Catch-all under /api (lowest priority).
  await page.route("**/api/**", (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;

    // Non-GET mutations (activate, toggle, save, …) — accept optimistically.
    if (req.method() !== "GET") return route.fulfill(jsonResponse({ ok: true }));

    // Exact-match a known loader payload.
    if (path in table) {
      const v = table[path];
      if (v && typeof v === "object" && "__status" in v) {
        return route.fulfill(jsonResponse(v.__body ?? { error: "mock error" }, v.__status));
      }
      return route.fulfill(jsonResponse(v));
    }

    // Project sub-routes (/api/projects/:id/activate handled by non-GET above).
    // Unknown GETs default to an empty object so nothing 404s into a throw.
    return route.fulfill(jsonResponse({}));
  });

  // Quiet the live-sync EventSource firehoses (/api/data|script|timeline/events).
  await page.route(/\/api\/[^?]*events(\?|$)/, (route) => route.fulfill(sseResponse()));

  // The flue agent proxy — health + anything else returns benign JSON.
  await page.route("**/eve/**", (route) => route.fulfill(jsonResponse({ ok: true })));

  // Better Auth session — the gate keys on this (highest priority).
  await page.route("**/api/auth/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/get-session")) {
      return route.fulfill(jsonResponse(signedIn ? SESSION : null));
    }
    return route.fulfill(jsonResponse({ ok: true }));
  });
}

export const fixtures = { SESSION, PROJECT, DEFAULT_ROUTES };
