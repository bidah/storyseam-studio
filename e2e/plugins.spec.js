import { test, expect } from "@playwright/test";
import { mockBackend } from "./helpers/mock.js";

// The plugin marketplace and the route gate (src/routes/plugins.jsx,
// src/components/PluginGate.jsx, src/components/PluginsProvider.jsx).
//
// The default mock installs every plugin so the other specs can still walk every
// tab; these tests override `/api/plugins` per case, because what they are
// actually about is the gate — a surface the project has NOT installed.

const CORE_ONLY = { enabled: [], defaulted: false, updatedAt: null };

// Point /api/plugins at a specific set, and capture what the client PUTs back.
// Registered BEFORE mockBackend's catch-all so this route wins.
async function withPlugins(page, state) {
  const writes = [];
  await page.route("**/api/plugins", (route) => {
    const req = route.request();
    if (req.method() !== "GET") {
      const body = JSON.parse(req.postData() || "{}");
      writes.push(body);
      const enabled = body.enabled ?? [
        ...state.enabled.filter((id) => !(body.disable || []).includes(id)),
        ...(body.enable || []),
      ];
      state.enabled = enabled;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ enabled, defaulted: false, updatedAt: null }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...state, updatedAt: null }),
    });
  });
  await mockBackend(page);
  return writes;
}

test.describe("plugin marketplace", () => {
  test("a project with nothing installed shows only the four core tabs", async ({ page }) => {
    await withPlugins(page, { ...CORE_ONLY });
    await page.goto("/world");

    const header = page.locator("header");
    for (const label of ["Bible", "Script", "Episodes", "Editor"]) {
      await expect(header.getByRole("tab", { name: label, exact: true })).toBeVisible();
    }
    // Nothing installed — so no plugin tab is in the header at all.
    for (const label of ["Radio", "Shot list", "Sound studio", "Image generation"]) {
      await expect(header.getByRole("tab", { name: label, exact: true })).toHaveCount(0);
    }
    await expect(header.getByRole("button", { name: /explore plugins/i })).toBeVisible();
  });

  test("an uninstalled surface renders the gate instead of its content", async ({ page }) => {
    await withPlugins(page, { ...CORE_ONLY });
    await page.goto("/radio");

    // The route still exists and still resolves — it just asks first.
    await expect(page.getByRole("button", { name: /install radio/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /browse all plugins/i })).toBeVisible();
    // …and does NOT paint the tab's own content.
    await expect(page.getByRole("heading", { name: "Radio version" })).toHaveCount(0);
  });

  test("installing from the gate reveals the tab and the content", async ({ page }) => {
    const state = { ...CORE_ONLY };
    const writes = await withPlugins(page, state);
    await page.goto("/radio");

    await page.getByRole("button", { name: /install radio/i }).click();

    expect(writes).toContainEqual({ enable: ["radio"] });
    await expect(page.locator("header").getByRole("tab", { name: "Radio", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Radio version" })).toBeVisible({ timeout: 15000 });
  });

  test("the marketplace lists every plugin and installs one", async ({ page }) => {
    const state = { ...CORE_ONLY };
    const writes = await withPlugins(page, state);
    await page.goto("/plugins");

    await expect(page.getByRole("heading", { name: "Explore plugins" })).toBeVisible();
    // The catalog, not a subset: twelve cards, each with an install control.
    await expect(page.getByRole("button", { name: "Install", exact: true })).toHaveCount(12);

    // The card opens its detail dialog; the dialog installs.
    await page.getByRole("button", { name: /about radio/i }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: /install plugin/i }).click();

    expect(writes).toContainEqual({ enable: ["radio"] });
    await expect(page.locator("header").getByRole("tab", { name: "Radio", exact: true })).toBeVisible();
  });

  test("core surfaces are never gated", async ({ page }) => {
    await withPlugins(page, { ...CORE_ONLY });
    for (const path of ["world", "script", "episode"]) {
      await page.goto(`/${path}`);
      await expect(page.getByRole("button", { name: /^install /i })).toHaveCount(0);
    }
  });
});
