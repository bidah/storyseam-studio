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
// Every Film runs in a project of its own: the page looks it up by id
// (GET /api/auto/films/:id/project) before it reads the job.
const FILM_PROJECT = "p_film";
const filmRoute = (id, body, projectId = FILM_PROJECT) => ({
  [`/api/auto/films/${id}/project`]: { projectId },
  [`/api/auto/films/${id}`]: body,
});
const NOT_FOUND = { __status: 404, __body: { ok: false, code: "not-found", error: "No such Film." } };

async function expectNoStudioShell(page) {
  await expect(page.locator("header")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: /message|ask the agent/i })).toHaveCount(0);
}

test.describe("director story", () => {
  test("signed out → the page opens; submitting keeps the premise and asks for Google", async ({ page }) => {
    await mockBackend(page, { signedIn: false });
    await page.goto("/director-story");
    await expect(page.getByRole("heading", { name: HERO })).toBeVisible();
    await expect(page.locator("[data-latest-stories]")).toHaveCount(0);
    await page.getByPlaceholder("Tell what story premise you have").fill("A lighthouse keeper's cat");
    await page.getByRole("button", { name: "Make the story" }).click();
    await expect(page.getByRole("dialog")).toContainText(/sign in to make your story/i);
    await expect(page.locator("[data-google-signin]")).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("director-story:pending")));
    expect(saved).toMatchObject({ prompt: "A lighthouse keeper's cat" });
  });

  test("back from sign-in (?resume=1) → the saved premise starts and lands on its Film", async ({ page }) => {
    await mockBackend(page, {
      routes: { "/api/auto/films/latest": { job: null }, "/api/auto/films/mine": { films: [] }, ...filmRoute("film_1", { job: job({ steps: [] }) }) },
    });
    let posted = null;
    await page.route("**/api/auto/films", (route) => {
      posted = route.request().postDataJSON();
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, job: job({ steps: [] }) }) });
    });
    await page.addInitScript(() => {
      localStorage.setItem("director-story:pending", JSON.stringify({ prompt: "A saved premise", seconds: null, at: Date.now() }));
    });
    await page.goto("/director-story?resume=1");
    await expect(page).toHaveURL(/\/director-story\/create\/film_1$/);
    expect(posted).toMatchObject({ prompt: "A saved premise" });
  });

  test("Latest stories with none yet → 'No stories created'", async ({ page }) => {
    await mockBackend(page, { routes: { "/api/auto/films/latest": { job: null }, "/api/auto/films/mine": { films: [] } } });
    await page.goto("/director-story");
    await page.locator("[data-latest-stories]").click();
    await expect(page.locator("[data-latest-empty]")).toHaveText(/no stories created/i);
  });

  test("Latest stories → a scrollable modal; picking one opens its Film", async ({ page }) => {
    const films = Array.from({ length: 25 }, (_, i) => ({
      filmId: `film_${i + 1}`, projectId: `p_${i + 1}`, title: `Story ${i + 1}`, prompt: `Premise ${i + 1}`,
      status: i ? "done" : "running", seconds: 120, createdAt: "2026-09-26T00:00:00.000Z",
    }));
    await mockBackend(page, {
      routes: { "/api/auto/films/latest": { job: null }, "/api/auto/films/mine": { films }, ...filmRoute("film_3", { job: doneJob() }, "p_3") },
    });
    await page.goto("/director-story");
    await page.locator("[data-latest-stories]").click();
    const list = page.locator("[data-latest-list]");
    await expect(list.getByRole("button")).toHaveCount(25);
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    await list.getByRole("button", { name: /Story 3\b/ }).click();
    await expect(page).toHaveURL(/\/director-story\/create\/film_3$/);
  });

  test("unauthenticated on a Film's page → next is that page", async ({ page }) => {
    await mockBackend(page, { signedIn: false });
    await page.goto("/director-story/create/film_1");
    await expect(page).toHaveURL(/\/login\?next=%2Fdirector-story%2Fcreate%2Ffilm_1$/);
  });

  test("signed in → hero and input only", async ({ page }) => {
    await mockBackend(page, { routes: { "/api/auto/films/latest": { job: null } } });
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
      routes: { "/api/auto/films/latest": { filmId: "film_1", projectId: FILM_PROJECT, job: job() }, ...filmRoute("film_1", { job: job() }) },
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
      routes: { "/api/auto/films/latest": { job: null }, ...filmRoute("film_1", { job: job({ steps: [] }) }) },
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
    expect(posted).toEqual({ prompt: "A lighthouse keeper's cat relights the lamp" });
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
      routes: { "/api/auto/films/latest": { job: null }, ...filmRoute("film_1", { job: chosen }) },
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

  test("a second story while one is being made is refused, with the link to the running one", async ({ page }) => {
    await mockBackend(page, {
      routes: { "/api/auto/films/latest": { job: null }, ...filmRoute("film_1", { job: job() }) },
    });
    await page.route("**/api/auto/films", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          refusal: { code: "busy", message: "A story is already being made — wait for it to finish, then start the next one." },
          filmId: "film_1",
          projectId: FILM_PROJECT,
          job: job(),
        }),
      }),
    );
    await page.goto("/director-story");
    const input = page.getByPlaceholder("Tell what story premise you have");
    await input.fill("A second story");
    await input.press("Enter");

    await expect(page).toHaveURL(/\/director-story$/);
    await expect(page.locator("[data-note]")).toHaveText(/already being made/);
    await page.locator("[data-running-link]").click();
    await expect(page).toHaveURL(/\/director-story\/create\/film_1$/);
  });

  test("a Film's page reads the job in the Film's OWN project, whatever the current one is", async ({ page }) => {
    await mockBackend(page, { routes: filmRoute("film_1", { job: job() }) });
    const scoped = page.waitForRequest((req) => new URL(req.url()).pathname === "/api/auto/films/film_1");
    await page.goto("/director-story/create/film_1");
    const req = await scoped;
    expect(req.headers()["x-project-id"]).toBe(FILM_PROJECT);
    await expect(page.locator("[data-story-view]")).toBeVisible();
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
      routes: { "/api/auto/films/latest": { job: null }, ...filmRoute("film_1", { job: doneJob() }) },
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

  const stoppedJob = () =>
    job({
      status: "stopped",
      error: "Stills: The first frame was refused: Too big",
      steps: [
        ...["world", "sheets", "shotlist", "cuesheet", "run"].map((key) => ({ key, label: key, status: "done" })),
        { key: "stills", label: "Stills", status: "failed", error: "The first frame was refused: Too big" },
      ],
      stopped: { stage: "stills", label: "Stills", reason: "The first frame was refused: Too big", kept: [], spent: 6.4 },
    });

  test("a stopped Film offers Retry from its failed step, which POSTs and flips the step to running", async ({ page }) => {
    await mockBackend(page, { routes: filmRoute("film_1", { job: stoppedJob() }) });
    let posted = 0;
    await page.route("**/api/auto/films/film_1/retry", (route) => {
      expect(route.request().method()).toBe("POST");
      posted += 1;
      const running = stoppedJob();
      running.status = "running";
      running.error = null;
      delete running.stopped;
      running.steps[5] = { key: "stills", label: "Stills", status: "running", error: null };
      return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ ok: true, job: running }) });
    });
    await page.goto("/director-story/create/film_1");

    await expect(page.locator('[data-step="stills"]')).toHaveAttribute("data-status", "failed");
    await expect(page.locator("[data-stopped]")).toBeVisible();
    const retry = page.getByRole("button", { name: "Retry from Stills" });
    await expect(retry).toBeVisible();
    await expect(page.getByRole("button", { name: /new story/i })).toBeVisible();

    await retry.click();
    await expect(page.locator('[data-step="stills"]')).toHaveAttribute("data-status", "running");
    expect(posted).toBe(1);
    await expect(page.locator("[data-stopped]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /retry from/i })).toHaveCount(0);
  });

  test("a refused retry shows its reason as the stopped line", async ({ page }) => {
    await mockBackend(page, { routes: filmRoute("film_1", { job: stoppedJob() }) });
    await page.route("**/api/auto/films/film_1/retry", (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, code: "busy", message: "Another story is being made on this project — wait for it to finish." }),
      }),
    );
    await page.goto("/director-story/create/film_1");
    await page.getByRole("button", { name: "Retry from Stills" }).click();
    await expect(page.locator("[data-stopped]")).toHaveText(/Another story is being made/);
    await expect(page.locator('[data-step="stills"]')).toHaveAttribute("data-status", "failed");
  });

  test("an unknown id → a clean not-found", async ({ page }) => {
    await mockBackend(page, {
      routes: { "/api/auto/films/film_nope/project": NOT_FOUND, "/api/auto/films/film_nope": NOT_FOUND },
    });
    await page.goto("/director-story/create/film_nope");

    await expect(page.getByText("There's no story here.")).toBeVisible();
    await expect(page.getByText(/current project/)).toHaveCount(0);
    await page.getByRole("link", { name: /new story/i }).click();
    await expect(page).toHaveURL(/\/director-story$/);
    await expect(page.getByRole("heading", { name: HERO })).toBeVisible();
  });
});
