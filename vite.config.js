import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Front-end on 5173 proxies API + media to the Express server on 5174.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3333,
    proxy: {
      "/api": "http://localhost:3334",
      "/media": "http://localhost:3334",
      "/multishot-media": "http://localhost:3334",
      "/refs": "http://localhost:3334",
      "/asset": "http://localhost:3334",
      "/final": "http://localhost:3334",
    },
  },
});
