import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke tests for the SPA. Playwright boots the Vite dev server (which
// proxies /api + media to the DEPLOYED prod Worker — see vite.config.js), so
// these exercise the real app shell. Data-dependent flows need a signed-in
// session against prod; the default smoke suite deliberately asserts only what
// holds without auth (the app boots and mounts), so it is safe to run in CI.
//
// Run:   npm run test:e2e         (first time: npx playwright install chromium)
const PORT = 3333;
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  // The Vite dev server compiles lazily, so the first request per worker (and
  // every code-split route chunk) pays a one-off cost; a roomier expect timeout
  // keeps first-mount assertions from flaking under fullyParallel load.
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Only manage a dev server when pointing at localhost; skip if E2E_BASE_URL is
  // an already-running/remote target.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
