import { describe, it, expect } from "vitest";
import * as v from "valibot";

import { getWorld } from "../../flue-agent/src/tools/get_world";
import { getScript } from "../../flue-agent/src/tools/get_script";
import { saveShotlist } from "../../flue-agent/src/tools/save_shotlist";
import { askQuestion } from "../../flue-agent/src/tools/ask_question";
import { toggleLibrary } from "../../flue-agent/src/tools/toggle_library";
import { attachStill } from "../../flue-agent/src/tools/attach_still";
import { editTimeline } from "../../flue-agent/src/tools/edit_timeline";
import { commitPacing } from "../../flue-agent/src/tools/commit_pacing";
import { selectReference } from "../../flue-agent/src/tools/select_reference";
import { pinDraft } from "../../flue-agent/src/tools/pin_draft";

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

const run = (tool: any, input?: any) => tool.run({ input, signal: undefined });

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
    expect(api.calls[0]).toMatchObject({
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

describe("ask_question (non-blocking HITL card)", () => {
  it("requires a non-empty question and validates option shape", () => {
    const tool: any = askQuestion();
    expect(v.safeParse(tool.input, { question: "Which take?" }).success).toBe(true);
    expect(v.safeParse(tool.input, { question: "" }).success).toBe(false);
    expect(
      v.safeParse(tool.input, {
        question: "Pick",
        options: [{ id: "a", label: "A", style: "danger" }],
      }).success,
    ).toBe(true);
    expect(
      v.safeParse(tool.input, { question: "Pick", options: [{ id: "a", label: "A", style: "loud" }] }).success,
    ).toBe(false); // bad style enum
  });

  it("returns immediately with the card payload and a stop-the-turn note (no api)", async () => {
    const out: any = await askQuestion().run({
      input: { question: "Overwrite?", options: [{ id: "y", label: "Yes" }] },
    });
    expect(out.presented).toBe(true);
    expect(out.question).toBe("Overwrite?");
    expect(out.options).toEqual([{ id: "y", label: "Yes" }]);
    expect(out.note).toMatch(/end your turn/i);
  });
});

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
