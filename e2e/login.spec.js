import { test, expect } from "@playwright/test";
import { mockBackend } from "./helpers/mock.js";

// The auth gate (src/components/Login.jsx). Unauthenticated visitors get the
// branded homepage with the Higgsfield sign-in; a live session drops the gate
// and mounts the studio shell. Both halves are pinned here against a mocked
// Better Auth session so the flow is deterministic and offline.

test.describe("login gate", () => {
  test("unauthenticated → branded homepage with sign-in", async ({ page }) => {
    await mockBackend(page, { signedIn: false });
    await page.goto("/world");

    // The marketing headline and the OAuth CTA render.
    await expect(
      page.getByRole("heading", { name: /agent-driven UI to create visual masterpieces/i }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with higgsfield/i })).toBeVisible();

    // The feature grid advertises the pipeline surfaces.
    for (const label of ["Chat agent", "Script writing", "Sound studio"]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }

    // The gate is up: the studio shell (header + tab bar) is NOT mounted.
    await expect(page.locator("header")).toHaveCount(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
  });

  test("clicking sign-in kicks off the OAuth flow", async ({ page }) => {
    await mockBackend(page, { signedIn: false });
    // Better Auth's oauth2 sign-in POSTs to /api/auth/sign-in/... then redirects
    // to Higgsfield. Capture the attempt instead of following it off-origin.
    let signInHit = false;
    await page.route("**/api/auth/sign-in/**", (route) => {
      signInHit = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ url: "https://higgsfield.ai/oauth/authorize?mock=1", redirect: true }),
      });
    });

    await page.goto("/world");
    await page.getByRole("button", { name: /sign in with higgsfield/i }).click();

    await expect.poll(() => signInHit, { timeout: 5000 }).toBe(true);
  });

  test("authenticated → gate drops, studio shell mounts", async ({ page }) => {
    await mockBackend(page, { signedIn: true });
    await page.goto("/world");

    // Shell chrome is present and the homepage CTA is gone.
    await expect(page.locator("header")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with higgsfield/i })).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "World" })).toBeVisible();
  });
});
