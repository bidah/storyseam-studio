import { describe, it, expect } from "vitest";
import { getSchema } from "@tiptap/core";
import { DOMParser as PMDOMParser, DOMSerializer, Slice } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import {
  SP_TYPES,
  SP_LABELS,
  SP_NEXT_ON_ENTER,
  SP_PLACEHOLDERS,
  Screenplay,
  buildInitialContent,
  elementsToDoc,
  transformCopiedScreenplay,
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

/* ---------------------------------------------------------------- *
 * Clipboard round-trip                                             *
 * ---------------------------------------------------------------- */

// A paste is the ONE path that rebuilds the doc from HTML instead of JSON, so it
// is the only place the parse rules are exercised — and the only place a rule
// ordering regression shows up. TipTap's Paragraph is registered at extension
// priority 1000 with a bare `p` rule, which outranked `p[data-sp-type]` at the
// default rule priority and turned every copied screenplay element back into a
// plain paragraph. These tests lock that ordering in.
describe("screenplay clipboard round-trip", () => {
  // The same extension list the Script editor (and the read-only share view)
  // mounts — Paragraph, the rule that used to win, comes in via StarterKit.
  const schema = getSchema([
    Screenplay,
    StarterKit,
    TextStyle,
    Color,
    TaskList,
    TaskItem.configure({ nested: true }),
  ]);

  // doc JSON → clipboard HTML → doc JSON, exactly what copy + paste does.
  const roundTrip = (json) => {
    const node = schema.nodeFromJSON(json);
    const dom = DOMSerializer.fromSchema(schema).serializeFragment(node.content, {
      document,
    });
    const host = document.createElement("div");
    host.appendChild(dom);
    return PMDOMParser.fromSchema(schema).parse(host).toJSON();
  };

  it("keeps every element type through a copy/paste", () => {
    const source = elementsToDoc(
      SP_TYPES.map((type) => ({ type, text: `${type} line` })),
    );
    const pasted = roundTrip(source);
    expect(pasted.content.map((n) => n.type)).toEqual(SP_TYPES.map(() => "screenplay"));
    expect(pasted.content.map((n) => n.attrs.spType)).toEqual(SP_TYPES);
    expect(pasted.content.map((n) => n.content[0].text)).toEqual(
      SP_TYPES.map((t) => `${t} line`),
    );
  });

  it("still parses an ordinary paragraph as a paragraph", () => {
    const pasted = roundTrip({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "prose" }] }],
    });
    expect(pasted.content[0].type).toBe("paragraph");
  });

  it("declines an unknown data-sp-type rather than minting an unstyled element", () => {
    const host = document.createElement("div");
    host.innerHTML = '<p data-sp-type="montage">MONTAGE</p>';
    const pasted = PMDOMParser.fromSchema(schema).parse(host).toJSON();
    expect(pasted.content[0].type).toBe("paragraph");
  });

  /* -------------------------------------------------------------- *
   * The whole copy → paste trip, as the editor runs it              *
   * -------------------------------------------------------------- */

  const SCENE = [
    { type: "scene_heading", text: "INT. CABIN - NIGHT" },
    { type: "character", text: "SARA" },
    { type: "dialogue", text: "You came back." },
    { type: "action", text: "" }, // the empty line you paste onto
  ];
  const scene = () => schema.nodeFromJSON(elementsToDoc(SCENE));
  // Where each block starts/ends, so the cases below can talk in line numbers.
  const blocks = [];
  scene().forEach((n, offset) => blocks.push({ from: offset + 1, to: offset + n.nodeSize - 1 }));

  // Select [from,to], copy it to clipboard HTML, drop the caret at `target` and
  // paste — the same serialize → parse → replaceSelection trip prosemirror-view
  // makes on Cmd+C / Cmd+V. Returns "<type>: <text>" per resulting line.
  const copyPaste = ({ from, to, target }) => {
    let state = EditorState.create({ schema, doc: scene() });
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));

    // — copy —
    const copied = transformCopiedScreenplay(state.selection.content(), { state });
    const host = document.createElement("div");
    host.appendChild(
      DOMSerializer.fromSchema(schema).serializeFragment(copied.content, { document }),
    );
    host.firstElementChild.setAttribute("data-pm-slice", `${copied.openStart} ${copied.openEnd} []`);
    const html = host.innerHTML;

    // — paste —
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, target)));
    const back = document.createElement("div");
    back.innerHTML = html;
    const [, openStart, openEnd] = /^(\d+) (\d+)/.exec(
      back.querySelector("[data-pm-slice]").getAttribute("data-pm-slice"),
    );
    const parsed = PMDOMParser.fromSchema(schema).parseSlice(back, {
      preserveWhitespace: true,
      context: state.selection.$from,
    });
    state = state.apply(
      state.tr.replaceSelection(new Slice(parsed.content, +openStart, +openEnd)),
    );

    return state.doc.toJSON().content.map(
      (n) => `${n.attrs?.spType ?? n.type}: ${(n.content || []).map((c) => c.text).join("")}`,
    );
  };

  it("pastes whole copied lines onto an empty line as those same elements", () => {
    // CHARACTER + DIALOGUE, selected end to end, pasted on the trailing blank line.
    expect(
      copyPaste({ from: blocks[1].from, to: blocks[2].to, target: blocks[3].from }),
    ).toEqual([
      "scene_heading: INT. CABIN - NIGHT",
      "character: SARA",
      "dialogue: You came back.",
      "character: SARA",       // used to arrive as "action: SARA"
      "dialogue: You came back.",
    ]);
  });

  it("splits the target line when whole lines are pasted mid-line", () => {
    expect(
      copyPaste({ from: blocks[1].from, to: blocks[2].to, target: blocks[0].from + 5 }),
    ).toEqual([
      "scene_heading: INT. ",
      "character: SARA",
      "dialogue: You came back.",
      "scene_heading: CABIN - NIGHT",
      "character: SARA",
      "dialogue: You came back.",
      "action: ",
    ]);
  });

  it("keeps a part-of-one-line copy inline — it must not retype where it lands", () => {
    // "came" out of the dialogue, dropped into the scene heading: plain text.
    expect(
      copyPaste({
        from: blocks[2].from + 4,
        to: blocks[2].from + 8,
        target: blocks[0].from + 5,
      }),
    ).toEqual([
      "scene_heading: INT. cameCABIN - NIGHT",
      "character: SARA",
      "dialogue: You came back.",
      "action: ",
    ]);
  });
});
