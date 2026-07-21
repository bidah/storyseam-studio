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
      "/api/data/events": sse(WORKER),
      "/api": api(WORKER),
      "/media": api(WORKER),
      "/multishot-media": api(WORKER),
      "/refs": api(WORKER),
      "/asset": api(WORKER),
      "/thumb": api(WORKER),
      "/hf-thumb": api(WORKER),
      "/final": api(WORKER),
      "/gen": api(WORKER),
      "/sound-media": api(WORKER),
      "/proxy": api(WORKER),
      "/stills": api(WORKER),
      "/files": api(WORKER),
      // The flue chat agent. /eve/* is same-origin so useFlueAgent() needs no
      // host/CORS config; the Worker (wrangler dev) owns /eve/*, injecting the
      // session user id into the instance id + minting the HMAC, then proxying to
      // the flue worker (`flue dev`). Set FLUE_ORIGIN in worker/.dev.vars to the
      // `flue dev` URL. Streaming passes through unbuffered (sse()).
      "/eve": sse(WORKER),
    },
  },
});
