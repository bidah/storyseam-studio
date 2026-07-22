import { test, expect } from "@playwright/test";
import { mockBackend } from "./helpers/mock.js";

// Failure resilience. Each data tab wraps its loader in a RouteError boundary
// (src/router.jsx) so a backend 500 renders an error in-place while the shell
// survives — and the live-sync EventSource / agent proxy going dark must not
// break the studio.

test.describe("error handling", () => {
  test("a loader 500 renders the route error, shell stays up", async ({ page }) => {
    await mockBackend(page, {
      routes: { "/api/shotlist": { __status: 500, __body: { error: "shotlist exploded" } } },
    });
    await page.goto("/shotlist");

    // The route surfaces the loader's error message...
    await expect(page.getByText(/shotlist exploded/i)).toBeVisible({ timeout: 15000 });
    // ...but the header/tab bar is untouched — the failure is contained.
    await expect(page.locator("header")).toBeVisible();
    await expect(page.getByRole("tab", { name: "World" })).toBeVisible();
  });

  test("navigating away from a failed tab recovers", async ({ page }) => {
    await mockBackend(page, {
      routes: { "/api/shotlist": { __status: 500, __body: { error: "shotlist exploded" } } },
    });
    await page.goto("/shotlist");
    await expect(page.getByText(/shotlist exploded/i)).toBeVisible();

    // A healthy tab still mounts normally.
    await page.getByRole("tab", { name: "World" }).click();
    await expect(page.getByRole("heading", { name: "World creation" })).toBeVisible();
  });

  test("the app tolerates a dead live-sync stream and agent proxy", async ({ page }) => {
    const fatal = [];
    page.on("pageerror", (e) => fatal.push(e.message));

    await mockBackend(page);
    // Kill the SSE firehoses and the /eve agent proxy outright. Registered AFTER
    // mockBackend so these win (Playwright runs the last-registered route first),
    // while auth + tab loaders keep coming from the mock.
    await page.route(/\/api\/[^?]*events(\?|$)/, (route) => route.abort());
    await page.route("**/eve/**", (route) => route.abort());

    await page.goto("/world");
    await expect(page.getByRole("heading", { name: "World creation" })).toBeVisible();
    await expect(page.locator("header")).toBeVisible();
    expect(fatal, `pageerrors with dead streams:\n${fatal.join("\n")}`).toHaveLength(0);
  });
});
