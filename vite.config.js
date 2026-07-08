import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Front-end on 3333 proxies API + media to the Express server on 3334.
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
      // Script live-updates (SSE) — must come BEFORE "/api" and disable
      // buffering so the event stream reaches the browser promptly.
      "/api/script/events": {
        target: "http://localhost:3334",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => proxyReq.setHeader("accept-encoding", "identity"));
        },
      },
      "/api": "http://localhost:3334",
      "/media": "http://localhost:3334",
      "/multishot-media": "http://localhost:3334",
      "/refs": "http://localhost:3334",
      "/asset": "http://localhost:3334",
      "/final": "http://localhost:3334",
      "/gen": "http://localhost:3334",
      "/sound-media": "http://localhost:3334",
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
