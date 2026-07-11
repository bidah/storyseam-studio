import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Front-end on 3333 proxies API + media to the deployed Cloudflare Worker (the
// backend — Express/Render was retired). For a local Worker instead, run
// `wrangler dev` in worker/ and set WORKER=http://localhost:8787 in the env.
const WORKER = process.env.WORKER || "https://shot-studio-uploads.rodrigofigueroa-name.workers.dev";
const APP_ORIGIN = "http://localhost:3333";

// Tell the Worker the browser's real origin (it's on localhost:3333, but the
// proxy's changeOrigin hides that) so Better Auth builds the right OAuth
// redirect_uri + cookie domain for LOCAL dev. When deployed there's no proxy, so
// the Worker uses its own origin.
const api = (target) => ({
  target,
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("x-app-origin", APP_ORIGIN));
  },
});
const sse = (target) => ({
  target,
  changeOrigin: true,
  configure: (proxy) => {
    proxy.on("proxyReq", (proxyReq) => {
      proxyReq.setHeader("accept-encoding", "identity");
      proxyReq.setHeader("x-app-origin", APP_ORIGIN);
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 3333,
    proxy: {
      // Live-update SSE streams — must come BEFORE "/api" and disable buffering.
      "/api/script/events": sse(WORKER),
      "/api/timeline/events": sse(WORKER),
      "/api": api(WORKER),
      "/media": api(WORKER),
      "/multishot-media": api(WORKER),
      "/refs": api(WORKER),
      "/asset": api(WORKER),
      "/final": api(WORKER),
      "/gen": api(WORKER),
      "/sound-media": api(WORKER),
      "/proxy": api(WORKER),
      "/stills": api(WORKER),
      "/files": api(WORKER),
      // The eve agent (chat) dev server. Proxying makes /eve same-origin so
      // useEveAgent() needs no host/CORS config. SSE streaming passes through.
      "/eve": {
        target: "http://localhost:2000",
        changeOrigin: true,
        configure: (proxy) => {
          // don't buffer the Server-Sent-Events stream
          proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("accept-encoding", "identity"));
        },
      },
    },
  },
});
