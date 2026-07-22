import { test, expect } from "@playwright/test";

// Smoke test: the SPA boots, mounts React into #root, and doesn't die on load.
// This catches build/bundle/mount regressions (a white screen, a throwing
// entrypoint, a broken lazy route) without needing an authenticated prod session.

test.describe("app shell", () => {
  test("loads and mounts the React root", async ({ page }) => {
    const fatalErrors = [];
    page.on("pageerror", (err) => fatalErrors.push(err.message));

    await page.goto("/");

    // The document identity is correct.
    await expect(page).toHaveTitle(/shot-studio/i);

    // React actually mounted something into #root (not a white screen).
    const root = page.locator("#root");
    await expect(root).toBeAttached();
    await expect
      .poll(async () => (await root.innerHTML()).trim().length, { timeout: 15_000 })
      .toBeGreaterThan(0);

    // The app reaches an interactive state — some control or heading renders,
    // whether that's the sign-in surface or the studio chrome.
    await expect(page.locator("button, a, [role=button], h1, h2").first()).toBeVisible({
      timeout: 15_000,
    });

    // No uncaught exception tore the page down during boot.
    expect(fatalErrors, `page errors:\n${fatalErrors.join("\n")}`).toHaveLength(0);
  });

  test("keeps the <html> dark-theme default before paint", async ({ page }) => {
    await page.goto("/");
    // index.html applies the saved/default theme before first paint (defaults dark).
    await expect(page.locator("html")).toHaveClass(/dark/);
  });
});
