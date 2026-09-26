import { describe, it, expect } from "vitest";
import * as v from "valibot";

import { getWorld } from "../../flue-agent/src/tools/get_world";
import { getScript } from "../../flue-agent/src/tools/get_script";
import { saveShotlist } from "../../flue-agent/src/tools/save_shotlist";
import { toggleLibrary } from "../../flue-agent/src/tools/toggle_library";
import { attachStill } from "../../flue-agent/src/tools/attach_still";
import { editTimeline } from "../../flue-agent/src/tools/edit_timeline";
import { commitPacing } from "../../flue-agent/src/tools/commit_pacing";
import { selectReference } from "../../flue-agent/src/tools/select_reference";
import { pinDraft } from "../../flue-agent/src/tools/pin_draft";
import { makeFilm, getFilm } from "../../flue-agent/src/tools/auto_film";

// A recording fake api: each verb logs its call and returns a preset payload.
function makeApi(responses: { get?: any; post?: any; req?: any } = {}) {
  const calls: Array<{ verb: string; path: string; method?: string; body?: any }> = [];
  return {
    calls,
    get: async (path: string) => (calls.push({ verb: "get", path }), responses.get ?? {}),
    post: async (path: string, body?: any) => (calls.push({ verb: "post", path, body }), responses.post ?? {}),
    req: async (path: string, method: string, body?: any) =>
      (calls.push({ verb: "req", path, method, body }), responses.req ?? {}),
  } as any;
}

// A flue 2 tool takes its parsed arguments as `data` and returns a result
// ENVELOPE — `{ output?, terminate? }` — so unwrap `.output` once here rather
// than in every assertion. This is also the cheapest proof that every `run`
// body was migrated: an unwrapped return shows up as `undefined` here.
const run = async (tool: any, input?: any) =>
  (await tool.run({ data: input, signal: undefined }))?.output;

describe("read tools dispatch to the right endpoint", () => {
  it("get_world GETs /api/world and passes the payload through", async () => {
    const api = makeApi({ get: { title: "Whistlewood" } });
    const out = await run(getWorld(api));
    expect(api.calls[0]).toMatchObject({ verb: "get", path: "/api/world" });
    expect(out).toEqual({ title: "Whistlewood" });
  });

  it("get_script GETs /api/script and normalizes the response shape", async () => {
    const api = makeApi({
      get: {
        title: "Ep 1",
        doc: { type: "doc", content: [] },
        draftName: "Draft 1",
        proposal: { pending: true },
        drafts: [{ name: "Draft 1", pinned: true, lineCount: 12 }],
      },
    });
    const out: any = await run(getScript(api));
    expect(api.calls[0].path).toBe("/api/script");
    expect(out).toMatchObject({ title: "Ep 1", pinnedDraft: "Draft 1", pendingProposal: true });
    expect(out.drafts[0]).toEqual({ name: "Draft 1", pinned: true, lineCount: 12 });
  });
});

describe("save_shotlist", () => {
  const shot = { beat: "B1", dur: 3, location: "school-clearing", action: "a", prompt: "p" };

  it("accepts a well-formed shot and rejects one missing required fields", () => {
    const tool: any = saveShotlist(makeApi());
    expect(v.safeParse(tool.input, { shots: [shot] }).success).toBe(true);
    expect(v.safeParse(tool.input, { shots: [{ beat: "B1" }] }).success).toBe(false); // no dur/location/action/prompt
    expect(v.safeParse(tool.input, { mode: "bogus", shots: [shot] }).success).toBe(false); // bad enum
  });

  it("POSTs /api/shotlist, defaulting mode=replace and source=agent", async () => {
    const api = makeApi({ post: { count: 1 } });
    await run(saveShotlist(api), { shots: [shot] });
    // A "replace" READS the current list first — that is the shrink gate
    // (a shorter list over an existing one needs the author's go-ahead), and
    // with nothing stored it falls straight through to the write.
    expect(api.calls[0]).toMatchObject({ verb: "get", path: "/api/shotlist" });
    expect(api.calls[1]).toMatchObject({
      verb: "post",
      path: "/api/shotlist",
      body: { shots: [shot], source: "agent", mode: "replace" },
    });
  });

  it("passes an explicit append mode + source through", async () => {
    const api = makeApi({ post: {} });
    await run(saveShotlist(api), { shots: [shot], mode: "append", source: "human" });
    expect(api.calls[0].body).toMatchObject({ mode: "append", source: "human" });
  });
});

// The `ask_question` block that lived here is gone with the tool: `render_ui`
// replaced it, and `flue-agent/src/tools/ask_question.ts` was deleted — this
// file's import of it had been failing since. (Its parts still render in old
// transcripts, but there is nothing left to unit-test.)

describe("write tools dispatch", () => {
  it("toggle_library POSTs /api/library/toggle with { rel }", async () => {
    const api = makeApi({ post: { selected: true } });
    await run(toggleLibrary(api), { rel: "final/sara.png" });
    expect(api.calls[0]).toMatchObject({ verb: "post", path: "/api/library/toggle", body: { rel: "final/sara.png" } });
  });

  it("attach_still validates a URL and POSTs /api/storyboard/image", async () => {
    const tool: any = attachStill(makeApi());
    expect(v.safeParse(tool.input, { bundle: "MS-01", shot: "MS-012", url: "not-a-url" }).success).toBe(false);
    const api = makeApi({ post: { file: "take1.png" } });
    const out = await run(attachStill(api), { bundle: "MS-01", shot: "MS-012", url: "https://cdn/x.png" });
    expect(api.calls[0].path).toBe("/api/storyboard/image");
    expect(out).toEqual({ file: "take1.png" });
  });

  it("edit_timeline validates ops enum and POSTs /api/timeline/edit", async () => {
    const tool: any = editTimeline(makeApi());
    expect(v.safeParse(tool.input, { ops: [{ op: "move", id: "a", from: 10 }] }).success).toBe(true);
    expect(v.safeParse(tool.input, { ops: [{ op: "teleport" }] }).success).toBe(false); // bad op
    const api = makeApi({ post: { ok: true, timeline: {} } });
    await run(editTimeline(api), { ops: [{ op: "remove", id: "x" }] });
    expect(api.calls[0]).toMatchObject({ path: "/api/timeline/edit", body: { ops: [{ op: "remove", id: "x" }] } });
  });

  it("commit_pacing POSTs /api/radio/commit-pacing with an empty body", async () => {
    const api = makeApi({ post: { ok: true } });
    await run(commitPacing(api));
    expect(api.calls[0]).toMatchObject({ verb: "post", path: "/api/radio/commit-pacing", body: {} });
  });

  it("select_reference requires a boolean `selected`", () => {
    const tool: any = selectReference(makeApi());
    expect(v.safeParse(tool.input, { bundle: "MS-01", rel: "x", selected: true }).success).toBe(true);
    expect(v.safeParse(tool.input, { bundle: "MS-01", rel: "x" }).success).toBe(false);
  });
});

describe("pin_draft (two-step: resolve then pin)", () => {
  it("resolves a draft by name (case-insensitive) then POSTs /api/script/pin", async () => {
    const api = makeApi({ get: { drafts: [{ id: "d2", name: "Draft 2" }] }, post: {} });
    const out: any = await run(pinDraft(api), { name: "draft 2" });
    expect(api.calls[0]).toMatchObject({ verb: "get", path: "/api/script/drafts" });
    expect(api.calls[1]).toMatchObject({ verb: "post", path: "/api/script/pin", body: { id: "d2" } });
    expect(out).toEqual({ ok: true, pinned: "Draft 2" });
  });

  it("returns a helpful error (and does NOT pin) when the name is unknown", async () => {
    const api = makeApi({ get: { drafts: [{ id: "d1", name: "Draft 1" }] } });
    const out: any = await run(pinDraft(api), { name: "ghost" });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/No draft named "ghost"/);
    expect(api.calls.some((c) => c.path === "/api/script/pin")).toBe(false);
  });
});

describe("Auto film tools", () => {
  it("make_film POSTs the same body the Auto surface does: the prompt untouched, the length as `seconds`", async () => {
    const api = makeApi({ post: { ok: true, job: { id: "film-1", status: "running", steps: [], spend: {} } } });
    const out: any = await run(makeFilm(api), { prompt: "a mecha short", seconds: 180 });
    expect(api.calls[0]).toMatchObject({ verb: "post", path: "/api/auto/films", body: { prompt: "a mecha short", seconds: 180 } });
    expect(out).toMatchObject({ started: true, filmId: "film-1", seconds: 180, length: "3:00", job: { status: "running" } });
  });

  it("make_film rounds a spoken length up to a step, caps it at 5:00, and sends none when none was asked", async () => {
    const api = makeApi({ post: { ok: true, job: { id: "film-1", status: "running", steps: [], spend: {} } } });
    await run(makeFilm(api), { prompt: "x", seconds: 190 });
    expect(api.calls[0].body).toEqual({ prompt: "x", seconds: 210 });
    const capped: any = await run(makeFilm(api), { prompt: "x", seconds: 600 });
    expect(api.calls[1].body).toEqual({ prompt: "x", seconds: 300 });
    expect(capped).toMatchObject({ capped: true, length: "5:00" });
    await run(makeFilm(api), { prompt: "x" });
    expect(api.calls[2].body).toEqual({ prompt: "x" });
  });

  it("make_film reports a queue position", async () => {
    const api = makeApi({ post: { ok: true, queued: true, position: 2, film: { id: "film-2" }, job: { id: "film-1", status: "running" } } });
    const out: any = await run(makeFilm(api), { prompt: "x" });
    expect(out).toMatchObject({ started: false, queued: true, position: 2, filmId: "film-2" });
  });

  it("make_film turns a refusal into a message instead of throwing", async () => {
    const api: any = {
      post: async () => {
        throw Object.assign(new Error("Shot Studio API /api/auto/films failed: used up"), {
          status: 429,
          body: { ok: false, refusal: { code: "allowance", message: "You've made all 10 Films this month." }, job: null },
        });
      },
    };
    const out: any = await run(makeFilm(api), { prompt: "x" });
    expect(out).toMatchObject({ started: false, refused: true, code: "allowance", message: "You've made all 10 Films this month." });
  });

  it("get_film shows stage summaries, and the Film only when done", async () => {
    const running = makeApi({
      get: {
        job: {
          id: "f", status: "running", spend: { world: 0.01 }, film: { url: "nope" },
          steps: [{ key: "world", label: "World", status: "done", summary: "3 characters", result: { big: true } }],
        },
        queue: [],
      },
    });
    const a: any = await run(getFilm(running));
    expect(running.calls[0].path).toBe("/api/auto/films/current");
    expect(a.job.steps[0]).toEqual({ key: "world", label: "World", status: "done", summary: "3 characters" });
    expect(a.job.film).toBeUndefined();

    const done = makeApi({ get: { job: { id: "f", status: "done", steps: [], spend: {}, film: { url: "https://x/film.mp4", seconds: 120 } }, queue: [] } });
    const b: any = await run(getFilm(done));
    expect(b.job.film).toEqual({ url: "https://x/film.mp4", seconds: 120 });
  });
});
