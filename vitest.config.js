import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Shot-studio has three independently-deployed code bases in one repo, each with
// its own runtime and module system:
//   • web    — the Vite + React SPA (src/), browser globals, `@/` alias, jsdom.
//   • worker — the Cloudflare Worker API (worker/src/), plain ESM, node env.
//   • flue   — the flue chat agent (flue-agent/src/), TypeScript, node env.
//
// One Vitest config, three `projects`, so `npm test` runs all of them in one
// pass while each gets the right environment + resolution. Coverage is measured
// across the pure "logic layer" of all three (see `coverage.include` below): the
// giant React route/editor components and the React hooks are exercised by the
// Playwright E2E suite instead, not unit tests.
const webAlias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  // scriptDiff.js imports SP_TYPES from the "@/components/notes" barrel, which
  // also re-exports the TipTap SlashCommand UI. For a headless unit test we only
  // need the vocabulary, so point the barrel at the pure schema module.
  "@/components/notes": fileURLToPath(
    new URL("./src/components/notes/schema.js", import.meta.url),
  ),
};

export default defineConfig({
  // flue-agent's tsconfig targets ES2024, which this esbuild doesn't name yet
  // (harmless warning noise); pin a target esbuild recognizes for transpile.
  esbuild: { target: "es2022" },
  test: {
    projects: [
      {
        resolve: { alias: webAlias },
        test: {
          name: "web",
          environment: "jsdom",
          include: ["test/web/**/*.test.{js,jsx}"],
          setupFiles: ["test/web/setup.js"],
        },
      },
      {
        test: {
          name: "worker",
          environment: "node",
          include: ["test/worker/**/*.test.js"],
        },
      },
      {
        resolve: {
          alias: [
            // @flue/runtime is a Worker-target package (it imports
            // `cloudflare:workers` and is bundled by the flue Vite plugin), so
            // it doesn't load under Vitest — stub the thin factories and hooks
            // the tools use. See test/flue/_stubs/flue-runtime.ts.
            //
            // Matched as a REGEX so the subpaths land on the stub too:
            // lib/sandbox.ts imports `@flue/runtime/cloudflare`, which a bare
            // string alias left unresolved (sandbox.test.ts never loaded).
            {
              find: /^@flue\/runtime(\/.*)?$/,
              replacement: fileURLToPath(
                new URL("./test/flue/_stubs/flue-runtime.ts", import.meta.url),
              ),
            },
          ],
        },
        test: {
          name: "flue",
          environment: "node",
          include: ["test/flue/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      all: true,
      reporter: ["text-summary", "text", "html", "json-summary"],
      reportsDirectory: "coverage",
      // The logic layer under unit test. Pure functions + small stores; the
      // React components/hooks and route handlers that need a live Worker/DO are
      // covered by Playwright (e2e/) and the flue evals (evals/), not here.
      include: [
        "src/editor/timeline.js",
        "src/lib/scriptDiff.js",
        "src/lib/tabCache.js",
        "src/lib/chat-store.js",
        "src/lib/agentModel.js",
        "src/lib/swr.js",
        "src/components/notes/schema.js",
        "worker/src/lib/**/*.js",
        "flue-agent/src/lib/**/*.ts",
        "flue-agent/src/tools/**/*.ts",
      ],
      exclude: [
        // Bridges to external services / other runtimes — integration-tested,
        // not unit-tested (they only do fetch/crypto plumbing to live systems).
        "worker/src/lib/ffmpeg.js",
        "worker/src/lib/proxy.js",
        "worker/src/lib/broadcast.js",
        "worker/src/lib/upload-snippet.js",
      ],
      thresholds: {
        // Lock in the coverage floor for the logic layer so a regression fails
        // CI instead of silently eroding. Set below the current ~78%/86%/72%.
        statements: 70,
        branches: 80,
        functions: 65,
        lines: 70,
      },
    },
  },
});
