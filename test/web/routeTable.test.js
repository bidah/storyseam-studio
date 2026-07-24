// Parity guard for the shared proxy route table (src/lib/routeTable.js): the
// classifier and the Vite dev proxy built from the same table must agree on
// every prefix — a media prefix added to one consumer but not the other cannot
// pass this suite. (vite.config.js itself pulls in esbuild, which jsdom can't
// load, so the "no duplicated path list" check reads it as text.)
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ROUTE_TABLE,
  classifyPath,
  buildDevProxy,
  DEFAULT_WORKER_ORIGIN,
} from "@/lib/routeTable.js";

describe("classifyPath", () => {
  it("classifies every table prefix as its own kind (no entry shadowed by an earlier one)", () => {
    for (const { prefix, kind } of ROUTE_TABLE) {
      expect(classifyPath(prefix)).toBe(kind === "sse" ? "forward-sse" : "forward-api");
    }
  });

  it("orders the SSE event paths before the general /api prefix", () => {
    const apiAt = ROUTE_TABLE.findIndex((e) => e.prefix === "/api");
    expect(apiAt).toBeGreaterThan(-1);
    for (const e of ROUTE_TABLE) {
      if (e.kind === "sse" && e.prefix.startsWith("/api/")) {
        expect(ROUTE_TABLE.indexOf(e)).toBeLessThan(apiAt);
      }
    }
  });

  it("classifies backend paths as forwarded", () => {
    expect(classifyPath("/api/script/events")).toBe("forward-sse");
    expect(classifyPath("/api/timeline/events")).toBe("forward-sse");
    expect(classifyPath("/api/data/events")).toBe("forward-sse");
    expect(classifyPath("/eve/agents/whistlewood/chat")).toBe("forward-sse");
    expect(classifyPath("/api/shotlist")).toBe("forward-api");
    expect(classifyPath("/api/auth/oauth2/callback/higgsfield")).toBe("forward-api");
    expect(classifyPath("/media/foo.mp4")).toBe("forward-api");
    expect(classifyPath("/sound-media/x.mp3")).toBe("forward-api");
    expect(classifyPath("/files/abc")).toBe("forward-api");
  });

  it("classifies SPA paths as serve-static", () => {
    expect(classifyPath("/")).toBe("serve-static");
    expect(classifyPath("/index.html")).toBe("serve-static");
    expect(classifyPath("/assets/index-abc123.js")).toBe("serve-static");
    expect(classifyPath("/script")).toBe("serve-static");
    expect(classifyPath("/settings")).toBe("serve-static");
  });
});

describe("buildDevProxy", () => {
  const APP_ORIGIN = "http://localhost:3333";
  const proxy = buildDevProxy(DEFAULT_WORKER_ORIGIN, APP_ORIGIN);

  // Run an entry's `configure` hook against a stub http-proxy and capture the
  // headers it stamps on the outgoing request.
  function stampedHeaders(entry) {
    let onProxyReq;
    entry.configure({ on: (event, cb) => { if (event === "proxyReq") onProxyReq = cb; } });
    const headers = {};
    onProxyReq({ setHeader: (k, v) => { headers[k] = v; } });
    return headers;
  }

  it("emits the table's prefixes, in table order", () => {
    expect(Object.keys(proxy)).toEqual(ROUTE_TABLE.map((e) => e.prefix));
  });

  it("every entry targets the worker with changeOrigin and the real app origin header", () => {
    for (const entry of Object.values(proxy)) {
      expect(entry.target).toBe(DEFAULT_WORKER_ORIGIN);
      expect(entry.changeOrigin).toBe(true);
      expect(stampedHeaders(entry)["x-app-origin"]).toBe(APP_ORIGIN);
    }
  });

  it("sse entries forward unbuffered (identity encoding); api entries don't touch encoding", () => {
    for (const { prefix, kind } of ROUTE_TABLE) {
      const headers = stampedHeaders(proxy[prefix]);
      if (kind === "sse") expect(headers["accept-encoding"]).toBe("identity");
      else expect(headers["accept-encoding"]).toBeUndefined();
    }
  });
});

describe("vite.config.js uses the shared table", () => {
  // jsdom rewrites import.meta.url to an http: URL — resolve from the repo
  // root (vitest's cwd) instead.
  const source = readFileSync("vite.config.js", "utf8");

  it("builds its proxy from routeTable.js", () => {
    expect(source).toContain("buildDevProxy(");
    expect(source).toContain("src/lib/routeTable.js");
  });

  it("keeps no duplicated proxy path list of its own", () => {
    for (const { prefix } of ROUTE_TABLE) {
      // An object-literal proxy entry would look like `"/media": …` — none may
      // survive in the config now that the table is the single source of truth.
      expect(source).not.toMatch(new RegExp(`["']${prefix}["']\\s*:`));
    }
  });
});
