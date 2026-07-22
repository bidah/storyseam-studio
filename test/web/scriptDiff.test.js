import { describe, it, expect } from "vitest";
import {
  docLines,
  linesToDoc,
  diffRows,
  buildSegments,
  resolveLines,
  diffWords,
  diffStats,
} from "@/lib/scriptDiff";

const spDoc = (nodes) => ({ type: "doc", content: nodes });
const sp = (spType, text) => ({
  type: "screenplay",
  attrs: { spType },
  content: text ? [{ type: "text", text }] : [],
});

describe("docLines", () => {
  it("flattens screenplay blocks to {type,text}, trimming and dropping empties", () => {
    const doc = spDoc([
      sp("scene_heading", "INT. HOUSE - DAY"),
      sp("action", "  Sara enters.  "),
      sp("dialogue", ""),
    ]);
    expect(docLines(doc)).toEqual([
      { type: "scene_heading", text: "INT. HOUSE - DAY" },
      { type: "action", text: "Sara enters." },
    ]);
  });

  it("drops the title node and defaults unknown block types to action", () => {
    const doc = spDoc([
      { type: "title", content: [{ type: "text", text: "My Script" }] },
      { type: "paragraph", content: [{ type: "text", text: "loose line" }] },
      sp("bogus", "still text"), // spType not in SP_TYPES → action
    ]);
    expect(docLines(doc)).toEqual([
      { type: "action", text: "loose line" },
      { type: "action", text: "still text" },
    ]);
  });

  it("returns [] for a non-doc input", () => {
    expect(docLines(null)).toEqual([]);
    expect(docLines({ type: "paragraph" })).toEqual([]);
  });
});

describe("linesToDoc", () => {
  it("round-trips lines back into a screenplay doc", () => {
    const lines = [{ type: "character", text: "SARA" }, { type: "dialogue", text: "Hi." }];
    const doc = linesToDoc(lines);
    expect(doc.type).toBe("doc");
    expect(doc.content[0]).toMatchObject({ type: "screenplay", attrs: { spType: "character" } });
    expect(docLines(doc)).toEqual(lines);
  });

  it("coerces unknown types to action and empties to an empty node", () => {
    const doc = linesToDoc([{ type: "weird", text: "" }]);
    expect(doc.content[0].attrs.spType).toBe("action");
    expect(doc.content[0].content).toEqual([]); // no text node for empty text
  });

  it("never emits an empty doc — falls back to one paragraph", () => {
    expect(linesToDoc([]).content).toEqual([{ type: "paragraph" }]);
    expect(linesToDoc(null).content).toEqual([{ type: "paragraph" }]);
  });
});

describe("diffRows", () => {
  const L = (t) => ({ type: "action", text: t });

  it("marks unchanged lines equal", () => {
    const rows = diffRows([L("a"), L("b")], [L("a"), L("b")]);
    expect(rows.map((r) => r.tag)).toEqual(["equal", "equal"]);
  });

  it("detects a pure insertion", () => {
    const rows = diffRows([L("a"), L("c")], [L("a"), L("b"), L("c")]);
    expect(rows.map((r) => r.tag)).toEqual(["equal", "ins", "equal"]);
    expect(rows[1].after.text).toBe("b");
  });

  it("detects a pure deletion", () => {
    const rows = diffRows([L("a"), L("b"), L("c")], [L("a"), L("c")]);
    expect(rows.map((r) => r.tag)).toEqual(["equal", "del", "equal"]);
    expect(rows[1].before.text).toBe("b");
  });

  it("a changed line is a del followed by an ins (line signature differs)", () => {
    const rows = diffRows([L("hello")], [L("goodbye")]);
    expect(rows.map((r) => r.tag)).toEqual(["del", "ins"]);
  });

  it("a type change on the same text is a del+ins (type is part of the signature)", () => {
    const rows = diffRows([{ type: "action", text: "X" }], [{ type: "scene_heading", text: "X" }]);
    expect(rows.map((r) => r.tag)).toEqual(["del", "ins"]);
  });
});

describe("buildSegments + resolveLines + diffStats", () => {
  const before = [
    { type: "action", text: "keep 1" },
    { type: "action", text: "old" },
    { type: "action", text: "keep 2" },
  ];
  const after = [
    { type: "action", text: "keep 1" },
    { type: "action", text: "new" },
    { type: "action", text: "keep 2" },
  ];

  it("groups rows into equal runs and change hunks with stable ids", () => {
    const segs = buildSegments(diffRows(before, after));
    expect(segs.map((s) => s.kind)).toEqual(["equal", "change", "equal"]);
    const hunk = segs[1];
    expect(hunk.id).toBe("h0");
    expect(hunk.removed).toEqual([{ type: "action", text: "old" }]);
    expect(hunk.added).toEqual([{ type: "action", text: "new" }]);
  });

  it("resolveLines defaults to accepting (uses the added lines)", () => {
    const segs = buildSegments(diffRows(before, after));
    expect(resolveLines(segs, {}).map((l) => l.text)).toEqual(["keep 1", "new", "keep 2"]);
  });

  it("resolveLines honors a per-hunk reject (keeps the original)", () => {
    const segs = buildSegments(diffRows(before, after));
    expect(resolveLines(segs, { h0: "reject" }).map((l) => l.text)).toEqual([
      "keep 1",
      "old",
      "keep 2",
    ]);
  });

  it("diffStats counts added/removed lines and hunks", () => {
    const segs = buildSegments(diffRows(before, after));
    expect(diffStats(segs)).toEqual({ added: 1, removed: 1, hunks: 1 });
  });

  it("no changes → zero stats", () => {
    const segs = buildSegments(diffRows(before, before));
    expect(diffStats(segs)).toEqual({ added: 0, removed: 0, hunks: 0 });
  });
});

describe("diffWords", () => {
  it("tags shared words eq and differing words del/ins in reading order", () => {
    const toks = diffWords("the quick fox", "the slow fox");
    const nonspace = toks.filter((t) => t.v.trim() !== "");
    expect(nonspace).toEqual([
      { tag: "eq", v: "the" },
      { tag: "del", v: "quick" },
      { tag: "ins", v: "slow" },
      { tag: "eq", v: "fox" },
    ]);
  });

  it("handles a pure append", () => {
    const toks = diffWords("hello", "hello world").filter((t) => t.v.trim() !== "");
    expect(toks).toEqual([
      { tag: "eq", v: "hello" },
      { tag: "ins", v: "world" },
    ]);
  });

  it("tolerates empty strings", () => {
    expect(diffWords("", "")).toEqual([]);
    expect(diffWords("a", "").filter((t) => t.v.trim())).toEqual([{ tag: "del", v: "a" }]);
  });
});
