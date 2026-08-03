import { cloudflare } from "@cloudflare/vite-plugin";
import { flue, flueWorkerConfig } from "@flue/vite";
import { defineConfig } from "vite";

export default defineConfig({
  // flue() MUST come before cloudflare(): it generates the Worker entry
  // (.flue-vite/) and the merged wrangler config (.flue-vite.wrangler.jsonc),
  // which `flueWorkerConfig()` then hands to the Cloudflare plugin. Without
  // that customizer the Cloudflare plugin never sees the generated entry or the
  // per-agent Durable Object bindings, and the build fails saying so.
  plugins: [
    flue({
      // Exhaustive allowlist — a specifier naming an unlisted provider fails at
      // model resolution, so this must cover every prefix in ALLOWED_MODELS
      // (src/lib/models.ts). `cloudflare` is what registers the Workers AI
      // binding provider in the generated entry; our own setProvider() in
      // app.ts wins over it (see lib/output-cap.ts). `anthropic` carries no
      // allowed model today but keeps the documented re-add path one entry
      // away — see the comment block in src/lib/models.ts.
      providers: ["cloudflare", "cerebras", "anthropic"],
    }),
    cloudflare({ config: flueWorkerConfig() }),
  ],
  // `vite dev` only. Left to itself the dep optimizer DISCOVERS @flue/runtime's
  // subpaths while the Worker is already booting, re-runs, and invalidates the
  // shared chunks it just handed out — the dev server dies before serving a
  // single request with "The file does not exist at .../deps_*/mcp-*.js which is
  // in the optimize deps directory". Declaring them up front means the whole set
  // is pre-bundled before boot, so nothing is discovered late. (Excluding them
  // instead does not work: the graph reaches CommonJS — the old MCP SDK's ajv
  // validator, via @openuidev/lang-core — which workerd cannot load raw and
  // which fails with "exports is not defined".)
  //
  // This lives under `environments` because the Cloudflare plugin puts the
  // Worker in its own Vite environment, named after the Worker; a top-level
  // `optimizeDeps` never reaches it. Rename the Worker and rename this key.
  // The production build does not use the optimizer and is unaffected.
  environments: {
    shot_studio_flue_v2: {
      optimizeDeps: {
        include: [
          "@flue/runtime",
          "@flue/runtime/cloudflare",
          "@flue/runtime/cloudflare/internal",
          "@flue/runtime/cloudflare/workers-ai",
          "@flue/runtime/internal",
          "@flue/runtime/routing",
          "agents",
        ],
      },
    },
  },
});
