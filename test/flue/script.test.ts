import { describe, it, expect } from "vitest";
import {
  SCRIPT_ELEMENT_TYPES,
  elementsToDoc,
  docToElements,
  type ScriptElement,
} from "../../flue-agent/src/lib/script";

describe("elementsToDoc", () => {
  it("maps elements to screenplay nodes with the right spType", () => {
    const els: ScriptElement[] = [
      { type: "scene_heading", text: "INT. HOUSE - DAY" },
      { type: "dialogue", text: "Hi." },
    ];
    const doc = elementsToDoc(els);
    expect(doc.type).toBe("doc");
    expect(doc.content[0]).toMatchObject({ type: "screenplay", attrs: { spType: "scene_heading" } });
    expect(doc.content[0].content).toEqual([{ type: "text", text: "INT. HOUSE - DAY" }]);
  });

  it("coerces an unknown type to action and drops the text node for empty text", () => {
    const doc = elementsToDoc([{ type: "weird" as any, text: "" }]);
    expect(doc.content[0].attrs!.spType).toBe("action");
    expect(doc.content[0].content).toEqual([]); // empty text → no inline text node
  });

  it("never persists an empty doc — falls back to one paragraph", () => {
    expect(elementsToDoc([]).content).toEqual([{ type: "paragraph" }]);
    expect(elementsToDoc(null as any).content).toEqual([{ type: "paragraph" }]);
  });
});

describe("docToElements", () => {
  it("flattens a screenplay doc to trimmed elements, dropping empties + title", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "title", content: [{ type: "text", text: "ignored" }] },
        { type: "screenplay", attrs: { spType: "action" }, content: [{ type: "text", text: "  hi  " }] },
        { type: "screenplay", attrs: { spType: "dialogue" }, content: [] }, // empty → dropped
      ],
    };
    expect(docToElements(doc)).toEqual([{ type: "action", text: "hi" }]);
  });

  it("defaults a non-screenplay block to action", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "loose" }] }],
    };
    expect(docToElements(doc)).toEqual([{ type: "action", text: "loose" }]);
  });

  it("returns [] for a non-doc input", () => {
    expect(docToElements(null)).toEqual([]);
    expect(docToElements({ type: "paragraph" })).toEqual([]);
  });

  it("round-trips elements → doc → elements", () => {
    const els: ScriptElement[] = SCRIPT_ELEMENT_TYPES.map((t, i) => ({ type: t, text: `line ${i}` }));
    expect(docToElements(elementsToDoc(els))).toEqual(els);
  });
});
