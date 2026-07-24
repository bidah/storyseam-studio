import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { buildDevProxy, DEFAULT_WORKER_ORIGIN } from "./src/lib/routeTable.js";

// Front-end on 3333 proxies API + media to the deployed Cloudflare Worker (the
// backend — Express/Render was retired). For a local Worker instead, run
// `wrangler dev` in worker/ and set WORKER=http://localhost:8787 in the env.
//
// The proxy path list itself lives in src/lib/routeTable.js — ONE source of
// truth shared with the Electron origin bridge (desktop/). SSE event paths and
// the /eve agent stream come before the general /api prefix and forward
// unbuffered; x-app-origin tells the Worker the browser's real origin so
// Better Auth builds the right OAuth redirect_uri + cookie domain in local dev.
const WORKER = process.env.WORKER || DEFAULT_WORKER_ORIGIN;
const APP_ORIGIN = "http://localhost:3333";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 3333,
    proxy: buildDevProxy(WORKER, APP_ORIGIN),
  },
});
