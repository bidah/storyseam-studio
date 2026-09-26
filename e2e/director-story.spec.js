import { test, expect } from "@playwright/test";
import { mockBackend } from "./helpers/mock.js";

// /director-story — text to story, and nothing else (src/routes/director-story.jsx).
// A sibling of RootLayout: no studio header, no tab bar, no agent panel. The
// simple view is a hero + one input; a Film in flight turns the page into one
// 100dvh story view with the steps, and a finished Film fills ~70% of it.

const job = (over = {}) => ({
  id: "film_1",
  prompt: "A lighthouse keeper's cat relights the lamp",
  status: "running",
  createdAt: "2026-09-26T00:00:00.000Z",
  steps: [
    { key: "world", label: "Idea + World", status: "done", summary: "The Lamp — 2 characters, 1 place" },
    { key: "sheets", label: "Reference sheets", status: "running", summary: null },
  ],
  spend: {},
  ...over,
});

const doneJob = () =>
  job({
    status: "done",
    steps: ["world", "sheets", "shotlist", "cuesheet", "run", "stills", "sitting", "score"].map((key) => ({
      key,
      label: key,
      status: "done",
    })),
    film: { url: "/files/film-test.mp4", title: "The Lamp", seconds: 120 },
    spent: 12.5,
  });

async function expectNoStudioShell(page) {
  await expect(page.locator("header")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /message|ask the agent/i })).toHaveCount(0);
}

test.describe("director story", () => {
  test("unauthenticated → redirected to login with next", async ({ page }) => {
    await mockBackend(page, { signedIn: false });
    await page.goto("/director-story");
    await expect(page).toHaveURL(/\/login\?next=%2Fdirector-story$/);
  });

  test("signed in → hero and input only", async ({ page }) => {
    await mockBackend(page, { routes: { "/api/auto/films/current": { job: null, queue: [] } } });
    await page.goto("/director-story");

    await expect(page.getByRole("heading", { name: /text to long form video stories in seconds/i })).toBeVisible();
    await expect(page.getByPlaceholder("Tell what story premise you have")).toBeVisible();
    // Empty box → the mic; typing turns it into the send arrow.
    await expect(page.getByRole("button", { name: "Dictate your premise" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Make the story" })).toHaveCount(0);
    await page.getByPlaceholder("Tell what story premise you have").fill("A lighthouse keeper's cat");
    await expect(page.getByRole("button", { name: "Make the story" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dictate your premise" })).toHaveCount(0);
    await expectNoStudioShell(page);
  });

  test("submitting turns the page into the steps view", async ({ page }) => {
    await mockBackend(page, { routes: { "/api/auto/films/current": { job: null, queue: [] } } });
    let posted = null;
    await page.route("**/api/auto/films", (route) => {
      posted = route.request().postDataJSON();
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, job: job({ steps: [] }) }),
      });
    });
    await page.goto("/director-story");
    const input = page.getByPlaceholder("Tell what story premise you have");
    await input.fill("A lighthouse keeper's cat relights the lamp");
    await input.press("Enter");

    await expect(page.locator("[data-story-view]")).toBeVisible();
    expect(posted).toEqual({ prompt: "A lighthouse keeper's cat relights the lamp" });
    await expect(page.locator("[data-step]")).toHaveCount(8);
  });

  test("a running job on load → 100vh steps view", async ({ page }) => {
    await mockBackend(page, { routes: { "/api/auto/films/current": { job: job(), queue: [] } } });
    await page.goto("/director-story");

    const view = page.locator("[data-story-view]");
    await expect(view).toBeVisible();
    await expect(page.locator("[data-prompt]")).toHaveText(/lighthouse keeper/);
    await expect(page.locator('[data-step="world"]')).toHaveAttribute("data-status", "done");
    await expect(page.locator('[data-step="sheets"]')).toHaveAttribute("data-status", "running");
    await expect(page.locator('[data-step="score"]')).toHaveAttribute("data-status", "pending");
    await expect(page.locator("video")).toHaveCount(0);
    const vh = page.viewportSize().height;
    // Layout heights, not bounding boxes: the view zooms in as it appears.
    expect(await view.evaluate((el) => el.offsetHeight)).toBe(vh);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(vh);
    await expectNoStudioShell(page);
  });

  test("a done job → the Film fills ~70% of the view", async ({ page }) => {
    await mockBackend(page, { routes: { "/api/auto/films/current": { job: doneJob(), queue: [] } } });
    await page.route("**/files/film-test.mp4", (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/director-story");

    const video = page.locator("video[data-film]");
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute("controls", "");
    const vh = page.viewportSize().height;
    const h = await video.locator("..").evaluate((el) => el.offsetHeight);
    expect(h / vh).toBeGreaterThan(0.65);
    expect(h / vh).toBeLessThan(0.75);
    // No title card, no cost.
    await expect(page.getByText("The Lamp", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/\$12/)).toHaveCount(0);
    await expectNoStudioShell(page);

    // "New story" goes back to the simple view.
    await page.getByRole("button", { name: /new story/i }).click();
    await expect(page.getByRole("heading", { name: /text to long form video stories in seconds/i })).toBeVisible();
  });
});
