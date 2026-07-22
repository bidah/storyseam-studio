import { describe, it, expect } from "vitest";
import {
  SP_TYPES,
  SP_LABELS,
  SP_NEXT_ON_ENTER,
  SP_PLACEHOLDERS,
  buildInitialContent,
} from "@/components/notes/schema";

describe("screenplay vocabulary", () => {
  it("covers the six Final Draft element types", () => {
    expect(SP_TYPES).toEqual([
      "scene_heading",
      "action",
      "character",
      "dialogue",
      "parenthetical",
      "transition",
    ]);
  });

  it("has a label, an on-Enter successor, and a placeholder for every type", () => {
    for (const t of SP_TYPES) {
      expect(SP_LABELS[t]).toBeTruthy();
      expect(SP_PLACEHOLDERS[t]).toBeTruthy();
      expect(SP_TYPES).toContain(SP_NEXT_ON_ENTER[t]);
    }
  });

  it("encodes the conventional flow: character → dialogue, scene_heading → action", () => {
    expect(SP_NEXT_ON_ENTER.character).toBe("dialogue");
    expect(SP_NEXT_ON_ENTER.scene_heading).toBe("action");
    expect(SP_NEXT_ON_ENTER.transition).toBe("scene_heading");
  });
});

describe("buildInitialContent", () => {
  it("splits an external title from the body blocks", () => {
    const { title, doc } = buildInitialContent({
      title: "Whistlewood",
      doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "body" }] }] },
    });
    expect(title).toBe("Whistlewood");
    expect(doc.content).toHaveLength(1);
    expect(doc.content[0].type).toBe("paragraph");
  });

  it("migrates a legacy in-document title node out into the title string", () => {
    const { title, doc } = buildInitialContent({
      doc: {
        type: "doc",
        content: [
          { type: "title", content: [{ type: "text", text: "Legacy Title" }] },
          { type: "paragraph", content: [{ type: "text", text: "kept" }] },
        ],
      },
    });
    expect(title).toBe("Legacy Title");
    expect(doc.content.every((n) => n.type !== "title")).toBe(true);
    expect(doc.content).toHaveLength(1);
  });

  it("prefers an explicit title over a legacy in-doc title", () => {
    const { title } = buildInitialContent({
      title: "Explicit",
      doc: { type: "doc", content: [{ type: "title", content: [{ type: "text", text: "Legacy" }] }] },
    });
    expect(title).toBe("Explicit");
  });

  it("guarantees a non-empty body (one paragraph) and empty title for junk input", () => {
    const { title, doc } = buildInitialContent(null);
    expect(title).toBe("");
    expect(doc.content).toEqual([{ type: "paragraph" }]);
  });
});
