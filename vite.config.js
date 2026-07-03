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
      "/api": "http://localhost:3334",
      "/media": "http://localhost:3334",
      "/multishot-media": "http://localhost:3334",
      "/refs": "http://localhost:3334",
      "/asset": "http://localhost:3334",
      "/final": "http://localhost:3334",
      "/gen": "http://localhost:3334",
      "/sound-media": "http://localhost:3334",
    },
  },
});
