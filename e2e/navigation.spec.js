import { test, expect } from "@playwright/test";
import { mockBackend } from "./helpers/mock.js";

// Tab routing (src/router.jsx) and per-tab mount. Each tab is a lazy-loaded
// route with its own loader; navigating must swap the URL, light the tab, pull
// the chunk, and render that tab's landmark — without any tab's mount throwing.

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

// A confirmed landmark per tab (heading / control that renders with empty data).
const TABS = [
  { tab: "World",         path: "world",    landmark: (p) => p.getByRole("heading", { name: "World creation" }) },
  { tab: "Script",        path: "script",   landmark: (p) => p.getByRole("button", { name: "Sign script" }) },
  { tab: "Shot list",     path: "shotlist", landmark: (p) => p.getByRole("heading", { name: "Shot list" }) },
  { tab: "Radio",         path: "radio",    landmark: (p) => p.getByRole("heading", { name: "Radio version" }) },
  { tab: "Animatic",      path: "animatic", landmark: (p) => p.getByRole("heading", { name: "Animatic" }) },
  { tab: "Episode (48)",  path: "episode",  landmark: (p) => p.getByRole("button", { name: "rebuild plan" }) },
  { tab: "Complete cuts", path: "cuts",     landmark: (p) => p.getByRole("heading", { name: /Complete cut/ }) },
  { tab: "Library",       path: "library",  landmark: (p) => p.getByRole("heading", { name: "Asset library" }) },
  { tab: "Sound studio",  path: "sounds",   landmark: (p) => p.getByRole("button", { name: "New background music" }) },
];

test.describe("tab navigation", () => {
  for (const { tab, path, landmark } of TABS) {
    test(`${tab} tab mounts its landmark and reports no fatal error`, async ({ page }) => {
      const fatal = [];
      page.on("pageerror", (e) => fatal.push(e.message));

      await page.goto(`/${path}`);
      await expect(landmark(page)).toBeVisible({ timeout: 15000 });

      // The route mounted without an error boundary and without tearing down.
      await expect(page.locator("header")).toBeVisible();
      expect(fatal, `pageerrors on /${path}:\n${fatal.join("\n")}`).toHaveLength(0);
    });
  }

  test("clicking through every tab updates URL and active state", async ({ page }) => {
    const fatal = [];
    page.on("pageerror", (e) => fatal.push(e.message));

    await page.goto("/world");
    await expect(page.locator("header")).toBeVisible({ timeout: 15000 });

    // Scope to the header — some tabs (e.g. Library) render their own in-content
    // sub-tabs with colliding labels.
    const header = page.locator("header");
    for (const { tab, path } of TABS) {
      await header.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/${path}(\\?|#|$)`));
      await expect(header.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("data-state", "active");
    }

    expect(fatal, `pageerrors during navigation:\n${fatal.join("\n")}`).toHaveLength(0);
  });

  test("the Editor tab loads its Remotion chunk without a fatal error", async ({ page }) => {
    // /editor is split out on its own so Remotion stays out of the main bundle;
    // just prove the chunk loads and mounts under the shell.
    const fatal = [];
    page.on("pageerror", (e) => fatal.push(e.message));

    await page.goto("/editor");
    await expect(page.locator("header")).toBeVisible();
    await expect.poll(async () => (await page.locator("main").innerHTML()).length, { timeout: 15000 })
      .toBeGreaterThan(200);
    expect(fatal, `pageerrors on /editor:\n${fatal.join("\n")}`).toHaveLength(0);
  });

  test("the index route redirects to /world", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/world$/);
  });

  test("an unknown route redirects to /script", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page).toHaveURL(/\/script$/);
  });
});
