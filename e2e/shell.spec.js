import { test, expect } from "@playwright/test";
import { mockBackend } from "./helpers/mock.js";

// The authenticated app shell (src/components/RootLayout.jsx): the header, the
// project switcher, the tab bar, the Refresh control, and the account menu
// (theme toggle + sign-out). These are project-wide chrome, exercised once.

test.beforeEach(async ({ page }) => {
  await mockBackend(page);
});

// The header is now the four CORE surfaces plus whatever the project has
// installed (src/lib/plugins.ts). The mock backend reports every plugin
// installed, so all of these are expected here; a real project starts with the
// first four alone.
const CORE_TABS = ["Bible", "Script", "Episodes", "Editor"];
const PLUGIN_TABS = [
  "Script agents", "Moodboard", "Shot list", "Image generation",
  "Video generation", "Visual nodes", "Animatic", "Radio", "Sound studio",
  "Musical", "Complete cuts", "Library",
];
const VISIBLE_TABS = [...CORE_TABS, ...PLUGIN_TABS];

test.describe("app shell", () => {
  test("renders header chrome: project, all tabs, refresh, account", async ({ page }) => {
    await page.goto("/world");
    const header = page.locator("header");
    await expect(header).toBeVisible();

    // The active project name shows in the switcher.
    await expect(header.getByText("Test Project")).toBeVisible();

    // Every non-hidden tab is present (the two sample tabs stay hidden).
    for (const label of VISIBLE_TABS) {
      await expect(page.getByRole("tab", { name: label, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("tab", { name: "Shots", exact: true })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Multi-shot", exact: true })).toHaveCount(0);

    // The two doorways that live beside the tabs: the marketplace and the MCP
    // explainer. Both are new chrome, both are always present.
    await expect(page.getByRole("button", { name: /explore plugins/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /use mcp/i })).toBeVisible();

    await expect(page.getByRole("button", { name: /refresh/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /account menu/i })).toBeVisible();
  });

  test("project switcher opens the projects menu", async ({ page }) => {
    await page.goto("/world");
    await page.getByRole("button", { name: /switch project/i }).click();

    await expect(page.getByText("Projects", { exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /new project/i })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /rename current/i })).toBeVisible();
  });

  test("account menu toggles the light/dark theme", async ({ page }) => {
    await page.goto("/world");
    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/); // dark is the default

    await page.getByRole("button", { name: /account menu/i }).click();
    await page.getByRole("menuitem", { name: /light mode/i }).click();
    await expect(html).not.toHaveClass(/dark/);

    // Preference persists to localStorage.
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("light");
  });

  test("account menu exposes the Higgsfield link and sign-out", async ({ page }) => {
    await page.goto("/world");
    await page.getByRole("button", { name: /account menu/i }).click();

    await expect(page.getByRole("menuitem", { name: /visit higgsfield\.ai/i })).toBeVisible();
    const signOut = page.getByRole("menuitem", { name: /sign out/i });
    await expect(signOut).toBeVisible();

    // Sign-out hits Better Auth's sign-out endpoint before the reload.
    let signOutHit = false;
    await page.route("**/api/auth/sign-out**", (route) => {
      signOutHit = true;
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await signOut.click();
    await expect.poll(() => signOutHit, { timeout: 5000 }).toBe(true);
  });

  test("refresh re-runs the active tab loader", async ({ page }) => {
    let shotlistFetches = 0;
    await page.route("**/api/shotlist", (route) => {
      shotlistFetches += 1;
      return route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify({ shots: [], bundles: [] }),
      });
    });

    await page.goto("/shotlist");
    await expect(page.getByRole("heading", { name: "Shot list" })).toBeVisible();
    const before = shotlistFetches;

    await page.getByRole("button", { name: /refresh/i }).click();
    // Refresh does invalidateTabCache + revalidate → a fresh loader fetch.
    await expect.poll(() => shotlistFetches, { timeout: 5000 }).toBeGreaterThan(before);
  });
});
