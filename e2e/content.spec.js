import { test, expect } from "@playwright/test";
import { mockBackend } from "./helpers/mock.js";

// Populated-data rendering. The navigation suite proves empty-state mounts;
// here a few tabs get seeded payloads to prove the route actually renders the
// server's data (grouping, counts, labels) rather than just its empty shell.

test.describe("populated tabs", () => {
  test("shot list groups shots by beat with counts", async ({ page }) => {
    await mockBackend(page, {
      routes: {
        "/api/shotlist": {
          shots: [
            { id: "1", beat: "b1", beatTitle: "Cold open", location: "Kitchen", action: "A" },
            { id: "2", beat: "b1", beatTitle: "Cold open", location: "Kitchen", action: "B" },
            { id: "3", beat: "b2", beatTitle: "The reveal", location: "Hall", action: "C" },
          ],
          bundles: [],
        },
      },
    });
    await page.goto("/shotlist");

    // Beat group headers + per-beat shot counts.
    await expect(page.getByText("Cold open", { exact: true })).toBeVisible();
    await expect(page.getByText("The reveal", { exact: true })).toBeVisible();
    await expect(page.getByText("2 shots", { exact: true })).toBeVisible();
    await expect(page.getByText("1 shots", { exact: true })).toBeVisible();

    // Individual shots render their id badges.
    await expect(page.getByText("shot 1", { exact: true })).toBeVisible();
    await expect(page.getByText("shot 3", { exact: true })).toBeVisible();
  });

  test("library shows folders and the selection tally", async ({ page }) => {
    await mockBackend(page, {
      routes: {
        "/api/library": {
          folders: [
            {
              folder: "Characters",
              images: [
                { rel: "characters/a.png", url: "/x/a.png", name: "a.png", selected: true },
                { rel: "characters/b.png", url: "/x/b.png", name: "b.png", selected: false },
              ],
            },
            { folder: "Locations", images: [{ rel: "locations/c.png", url: "/x/c.png", name: "c.png", selected: false }] },
          ],
        },
      },
    });
    await page.goto("/library");

    await expect(page.getByRole("heading", { name: "Asset library" })).toBeVisible();
    await expect(page.getByText("2 folders", { exact: true })).toBeVisible();
    await expect(page.getByText("Characters", { exact: true })).toBeVisible();
    await expect(page.getByText("Locations", { exact: true })).toBeVisible();
    // One image across the folders is in final_selection.
    await expect(page.getByText(/1 selected/)).toBeVisible();
  });

  test("empty shot list shows its empty-state prompt", async ({ page }) => {
    await mockBackend(page); // default empty shotlist
    await page.goto("/shotlist");
    await expect(page.getByRole("heading", { name: "Shot list" })).toBeVisible();
    await expect(page.getByRole("button", { name: /rebuild from current episode/i })).toBeVisible();
  });
});
