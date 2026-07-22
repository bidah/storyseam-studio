import { defineConfig } from "vitest/config";

// Vitest-evals: behavioural checks against a RUNNING whistlewood agent (flue).
// These are NOT part of `npm test` — they need a live agent endpoint + model
// credits, so they live behind FLUE_BASE_URL and their own config.
//
//   # against a local agent (`npm run flue:dev`)
//   FLUE_BASE_URL=http://localhost:8788 npm run test:evals
//
//   # against a deployed preview
//   FLUE_BASE_URL=https://shot-studio-flue.<acct>.workers.dev npm run test:evals
//
// See evals/README.md for auth headers and how tool-use is scored.
export default defineConfig({
  test: {
    name: "evals",
    include: ["evals/**/*.eval.ts"],
    environment: "node",
    // Model turns are slow; give each case room and don't parallelize the agent.
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    reporters: ["default"],
  },
});
