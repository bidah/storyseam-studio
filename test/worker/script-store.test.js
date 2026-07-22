import { describe, it, expect } from "vitest";
import { makeEnv } from "./_fakes.js";
import {
  scriptKey,
  countLines,
  makeDraft,
  makeProposal,
  normalizeStore,
  pinnedDraft,
  draftMeta,
  metaList,
  readStore,
  writeStore,
} from "../../worker/src/lib/script-store.js";

const docWith = (...texts) => ({
  type: "doc",
  content: texts.map((t) => ({ type: "screenplay", content: t ? [{ type: "text", text: t }] : [] })),
});

describe("scriptKey", () => {
  it("keys by sanitized project id", () => {
    expect(scriptKey("p1")).toBe("script/p1.json");
    expect(scriptKey("a/b c")).toBe("script/abc.json");
  });

  it("uses the legacy key for a blank / fully-stripped id", () => {
    expect(scriptKey(null)).toBe("script/current.json");
    expect(scriptKey("!!!")).toBe("script/current.json");
  });
});

describe("countLines", () => {
  it("counts non-empty top-level blocks, skipping the title and empties", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "title", content: [{ type: "text", text: "T" }] },
        { type: "screenplay", content: [{ type: "text", text: "one" }] },
        { type: "screenplay", content: [] }, // empty → not counted
        { type: "screenplay", content: [{ type: "text", text: "two" }] },
      ],
    };
    expect(countLines(doc)).toBe(2);
  });

  it("is 0 for a non-doc / empty input", () => {
    expect(countLines(null)).toBe(0);
    expect(countLines({ type: "paragraph" })).toBe(0);
  });
});

describe("makeDraft / makeProposal", () => {
  it("makeDraft mints an id and timestamps, with sane defaults", () => {
    const d = makeDraft({ title: "T", doc: docWith("x") });
    expect(d.id).toMatch(/^d_/);
    expect(d.name).toBe("Draft 1");
    expect(d.createdAt).toBe(d.updatedAt);
    expect(d.proposal).toBeNull();
  });

  it("makeProposal snapshots base/proposed and coerces optional fields", () => {
    const p = makeProposal({ baseDoc: docWith("a"), proposedDoc: docWith("b"), proposedTitle: 5, note: 7 });
    expect(p.proposedTitle).toBeNull(); // non-string coerced
    expect(p.note).toBeNull();
    expect(p.source).toBe("eve");
    expect(p.createdAt).toBeTruthy();
  });
});

describe("normalizeStore", () => {
  it("keeps a valid v2 store and repairs a dangling pinnedId", () => {
    const store = normalizeStore({
      v: 2,
      pinnedId: "ghost",
      drafts: [{ id: "d1", name: "A", doc: null }],
    });
    expect(store.pinnedId).toBe("d1"); // pin repaired to first draft
    expect(store.drafts[0].name).toBe("A");
  });

  it("wraps a legacy single-doc record as the first draft", () => {
    const store = normalizeStore({ title: "Old", doc: docWith("line") });
    expect(store.v).toBe(2);
    expect(store.drafts).toHaveLength(1);
    expect(store.drafts[0].title).toBe("Old");
    expect(store.pinnedId).toBe(store.drafts[0].id);
  });

  it("produces a fresh blank draft for empty / null input", () => {
    const store = normalizeStore(null);
    expect(store.drafts).toHaveLength(1);
    expect(store.drafts[0].name).toBe("Draft 1");
    expect(pinnedDraft(store)).toBe(store.drafts[0]);
  });
});

describe("draftMeta / metaList", () => {
  it("summarizes a draft with a line count and pin flag", () => {
    const d = { id: "d1", name: "A", createdAt: 1, updatedAt: 2, doc: docWith("x", "y") };
    expect(draftMeta(d, "d1")).toMatchObject({ id: "d1", name: "A", lineCount: 2, pinned: true });
    expect(draftMeta(d, "other").pinned).toBe(false);
  });

  it("metaList marks exactly the pinned draft", () => {
    const store = {
      pinnedId: "d2",
      drafts: [
        { id: "d1", name: "A", doc: null },
        { id: "d2", name: "B", doc: null },
      ],
    };
    expect(metaList(store).map((m) => m.pinned)).toEqual([false, true]);
  });
});

describe("readStore / writeStore", () => {
  it("round-trips through R2 and always returns a normalized store", async () => {
    const env = makeEnv();
    const store = normalizeStore({ title: "Seed", doc: docWith("a") });
    await writeStore(env, "p1", store);
    const read = await readStore(env, "p1");
    expect(read.v).toBe(2);
    expect(pinnedDraft(read).title).toBe("Seed");
  });

  it("returns a fresh blank store when nothing is stored", async () => {
    const env = makeEnv();
    const read = await readStore(env, "p1");
    expect(read.drafts).toHaveLength(1);
  });
});
