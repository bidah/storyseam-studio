import { test, expect } from "@playwright/test";
import { mockBackend } from "./helpers/mock.js";

// /director-story — text to story, and nothing else (src/routes/director-story
// .jsx + director-story-film.jsx, shared pieces in components/DirectorStory.jsx).
// Siblings of RootLayout: no studio header, no tab bar, no agent panel. The
// simple view is a hero + one input; a submit moves the URL to the Film's own
// page, /director-story/create/:filmId — one 100dvh story view with the steps,
// and a finished Film fills ~70% of it. The URL is the state: loading that page
// directly (a reload) lands on the same Film.

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

const HERO = /text to long form video stories in seconds/i;
const filmRoute = (id, body) => ({ [`/api/auto/films/${id}`]: body });
const NOT_FOUND = { __status: 404, __body: { ok: false, code: "not-found", error: "No such Film on this project." } };

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

  test("unauthenticated on a Film's page → next is that page", async ({ page }) => {
    await mockBackend(page, { signedIn: false });
    await page.goto("/director-story/create/film_1");
    await expect(page).toHaveURL(/\/login\?next=%2Fdirector-story%2Fcreate%2Ffilm_1$/);
  });

  test("signed in → hero and input only", async ({ page }) => {
    await mockBackend(page, { routes: { "/api/auto/films/current": { job: null, queue: [] } } });
    await page.goto("/director-story");

    await expect(page.getByRole("heading", { name: HERO })).toBeVisible();
    await expect(page.getByPlaceholder("Tell what story premise you have")).toBeVisible();
    // Empty box → the mic; typing turns it into the send arrow.
    await expect(page.getByRole("button", { name: "Dictate your premise" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Make the story" })).toHaveCount(0);
    await page.getByPlaceholder("Tell what story premise you have").fill("A lighthouse keeper's cat");
    await expect(page.getByRole("button", { name: "Make the story" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Dictate your premise" })).toHaveCount(0);
    await expect(page.locator("[data-running-link]")).toHaveCount(0);
    await expectNoStudioShell(page);
  });

  test("a running Film does not hijack /director-story — it offers a link", async ({ page }) => {
    await mockBackend(page, {
      routes: { "/api/auto/films/current": { job: job(), queue: [] }, ...filmRoute("film_1", { job: job() }) },
    });
    await page.goto("/director-story");

    await expect(page.getByRole("heading", { name: HERO })).toBeVisible();
    await expect(page.locator("[data-story-view]")).toHaveCount(0);
    const link = page.locator("[data-running-link]");
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/director-story\/create\/film_1$/);
    await expect(page.locator("[data-story-view]")).toBeVisible();
  });

  test("submitting navigates to the Film's page, and a reload stays on it", async ({ page }) => {
    await mockBackend(page, {
      routes: { "/api/auto/films/current": { job: null, queue: [] }, ...filmRoute("film_1", { job: job({ steps: [] }) }) },
    });
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

    await expect(page).toHaveURL(/\/director-story\/create\/film_1$/);
    await expect(page.locator("[data-story-view]")).toBeVisible();
    // The gear's default length rides along.
    expect(posted).toEqual({ prompt: "A lighthouse keeper's cat relights the lamp", seconds: 120 });
    await expect(page.locator("[data-step]")).toHaveCount(8);
    await expect(page.locator("[data-prompt]")).toHaveText(/lighthouse keeper/);

    // The URL is the state: a reload lands on the same Film.
    await page.reload();
    await expect(page.locator("[data-story-view]")).toBeVisible();
    await expect(page.locator("[data-prompt]")).toHaveText(/lighthouse keeper/);
  });

  test("the settings gear picks the length: 3:00 sends seconds 180, is remembered, and shows on the story", async ({ page }) => {
    const chosen = job({ steps: [], seconds: 180 });
    await mockBackend(page, {
      routes: { "/api/auto/films/current": { job: null, queue: [] }, ...filmRoute("film_1", { job: chosen }) },
    });
    let posted = null;
    await page.route("**/api/auto/films", (route) => {
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, job: chosen }) });
    });
    await page.goto("/director-story");

    const gear = page.getByRole("button", { name: "Story settings" });
    await expect(gear).toBeVisible();
    await expect(gear).toContainText("2:00");
    await gear.click();
    const panel = page.locator("[data-story-settings-panel]");
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("radio", { name: "2:00" })).toHaveAttribute("aria-checked", "true");
    await expect(panel.getByRole("radio", { name: "5:00" })).toBeVisible();
    await panel.getByRole("radio", { name: "3:00" }).click();
    await expect(panel.getByRole("radio", { name: "3:00" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(gear).toContainText("3:00");

    // Remembered per browser.
    await page.reload();
    await expect(page.getByRole("button", { name: "Story settings" })).toContainText("3:00");

    const input = page.getByPlaceholder("Tell what story premise you have");
    await input.fill("A two minute lighthouse story");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/director-story\/create\/film_1$/);
    expect(posted).toEqual({ prompt: "A two minute lighthouse story", seconds: 180 });
    await expect(page.locator("[data-length]")).toHaveText("3:00");
  });

  test("a queued submit navigates to its id and says Queued", async ({ page }) => {
    const queued = { id: "film_2", prompt: "A second story", status: "queued", position: 1, steps: [], spend: {} };
    await mockBackend(page, {
      routes: { "/api/auto/films/current": { job: job(), queue: [] }, ...filmRoute("film_2", { job: queued }) },
    });
    await page.route("**/api/auto/films", (route) =>
      route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          queued: true,
          position: 1,
          film: { id: "film_2", prompt: "A second story", position: 1 },
          job: job(),
        }),
      }),
    );
    await page.goto("/director-story");
    const input = page.getByPlaceholder("Tell what story premise you have");
    await input.fill("A second story");
    await input.press("Enter");

    await expect(page).toHaveURL(/\/director-story\/create\/film_2$/);
    await expect(page.locator("[data-queued]")).toHaveText(/Queued — position 1/);
  });

  test("loading a running Film's page directly → 100vh steps view", async ({ page }) => {
    await mockBackend(page, { routes: filmRoute("film_1", { job: job() }) });
    await page.goto("/director-story/create/film_1");

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

  test("loading a done Film's page → the Film fills ~70% of the view", async ({ page }) => {
    await mockBackend(page, {
      routes: { "/api/auto/films/current": { job: null, queue: [] }, ...filmRoute("film_1", { job: doneJob() }) },
    });
    await page.route("**/files/film-test.mp4", (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto("/director-story/create/film_1");

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

    // "New story" goes back to the simple view, at /director-story.
    await page.getByRole("button", { name: /new story/i }).click();
    await expect(page).toHaveURL(/\/director-story$/);
    await expect(page.getByRole("heading", { name: HERO })).toBeVisible();
  });

  test("an id this project doesn't have → the not-found line", async ({ page }) => {
    await mockBackend(page, { routes: filmRoute("film_nope", NOT_FOUND) });
    await page.goto("/director-story/create/film_nope");

    await expect(page.getByText("This story isn't in your current project.")).toBeVisible();
    await page.getByRole("link", { name: /new story/i }).click();
    await expect(page).toHaveURL(/\/director-story$/);
    await expect(page.getByRole("heading", { name: HERO })).toBeVisible();
  });
});
