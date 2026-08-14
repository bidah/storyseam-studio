// TipTap schema for the Script tab — a Notion-style page (title + body) whose
// body understands screenplay elements. The page title and its body live in ONE
// ProseMirror document: the first node is a dedicated `title` node, the rest is
// the body. Keeping them in one contenteditable is what makes the title→body
// flow feel native (Enter at the end of the title drops into the body, arrows
// cross the boundary) without the focus-handoff races a separate <input> title
// would introduce.
//
// The novel bit here (which the reference note editor does NOT have) is the
// `Screenplay` node: a single block node carrying a `spType` attribute
// (scene_heading | action | character | dialogue | parenthetical | transition).
// It is what the "/" menu inserts, and its keyboard shortcuts make inline text
// follow screenplay rules — Enter after a Character cue drops into Dialogue,
// Tab cycles the element type, etc. — the conventional Final Draft flow.

import { Node, mergeAttributes } from "@tiptap/core";
import { Slice } from "@tiptap/pm/model";

/* ---------------------------------------------------------------- *
 * Screenplay element vocabulary                                    *
 * ---------------------------------------------------------------- */

export const SP_TYPES = [
  "scene_heading",
  "action",
  "character",
  "dialogue",
  "parenthetical",
  "transition",
];

export const SP_LABELS = {
  scene_heading: "Scene Heading",
  action: "Action",
  character: "Character",
  dialogue: "Dialogue",
  parenthetical: "Parenthetical",
  transition: "Transition",
};

// What pressing Enter at the end of an element creates next — the conventional
// Final Draft flow (a character cue is followed by dialogue, a scene heading by
// action, dialogue continues as dialogue, and so on).
export const SP_NEXT_ON_ENTER = {
  scene_heading: "action",
  action: "action",
  character: "dialogue",
  dialogue: "dialogue",
  parenthetical: "dialogue",
  transition: "scene_heading",
};

export const SP_PLACEHOLDERS = {
  scene_heading: "INT. LOCATION - DAY",
  action: "Describe the action…",
  character: "CHARACTER",
  dialogue: "What they say…",
  parenthetical: "(beat)",
  transition: "CUT TO:",
};

// CSS class suffix (scene_heading → scene-heading) so styling stays readable.
const cls = (t) => `sp sp-${t.replace(/_/g, "-")}`;

/* ---------------------------------------------------------------- *
 * Clipboard — keeping the element type through a copy/paste        *
 * ---------------------------------------------------------------- */

// ProseMirror tries the parse rules of the WHOLE schema in one priority-ordered
// list, and TipTap's Paragraph registers a bare `p` rule at extension priority
// 1000 — so at the default rule priority (50) a copied `<p data-sp-type="…">`
// hit the paragraph rule FIRST and came back as an unformatted paragraph. Nothing
// else notices: the stored draft, the Fountain import and the agent all seed the
// doc from JSON, which never goes through the DOM parser. Only the clipboard does
// — which is why cutting a character cue and pasting it elsewhere lost its type.
// Ranking these rules above 50 puts them ahead of the paragraph catch-all.
const SP_PARSE_PRIORITY = 60;

// A `data-sp-type` we don't recognise is not a screenplay element — decline the
// rule so the paragraph one takes it, rather than minting a block whose type has
// no keyboard flow and no `sp-*` styling.
const spTypeAttrs = (el) => {
  const spType = el.getAttribute("data-sp-type");
  return SP_TYPES.includes(spType) ? { spType } : false;
};

/**
 * `editorProps.transformCopied` for the Script editor — see `Screenplay` below
 * for the other half of "a copy keeps its formatting".
 *
 * The parse rules get the element type onto the clipboard and back; this decides
 * whether the pasted content lands as BLOCKS or as loose inline text. A
 * drag-selection is always an OPEN slice — ProseMirror opens a TextSelection
 * down to its textblocks — and an open end merges into whatever block it is
 * dropped into. So copying a CHARACTER cue plus its DIALOGUE and pasting it on a
 * fresh line still produced an ACTION line followed by dialogue: the first,
 * "open", block took the target's type instead of its own.
 *
 * When the selection spans more than one block and starts (ends) exactly on a
 * block boundary, those lines were copied WHOLE — so close that end and the
 * paste inserts real blocks, element types intact. A selection inside a single
 * block is left open on purpose: pasting half a line must stay inline text and
 * must not retype the line it lands in.
 */
export function transformCopiedScreenplay(slice, view) {
  const { $from, $to } = view.state.selection;
  if ($from.sameParent($to)) return slice;
  // Only the flat, one-block-deep ends are ours to close; anything deeper (a
  // selection reaching into a list item) is left exactly as ProseMirror built it.
  const openStart = slice.openStart === 1 && $from.parentOffset === 0 ? 0 : slice.openStart;
  const openEnd =
    slice.openEnd === 1 && $to.parentOffset === $to.parent.content.size ? 0 : slice.openEnd;
  if (openStart === slice.openStart && openEnd === slice.openEnd) return slice;
  return new Slice(slice.content, openStart, openEnd);
}

/* ---------------------------------------------------------------- *
 * Initial content                                                  *
 * ---------------------------------------------------------------- */

// The title lives OUTSIDE the editor (a separate click-to-edit field), so the
// body document is plain blocks (StarterKit's default `block+`). This splits a
// stored payload into { title, doc } and migrates any legacy in-document title
// node (from the earlier one-doc design) out into the separate title string.
export function buildInitialContent(stored) {
  const doc = stored?.doc;
  const content =
    doc && doc.type === "doc" && Array.isArray(doc.content) ? doc.content : [];

  const legacyTitle = content.find((n) => n.type === "title");
  const legacyTitleText =
    (legacyTitle?.content || []).map((n) => n.text || "").join("") || "";
  const body = content.filter((n) => n.type !== "title");

  const title =
    (typeof stored?.title === "string" && stored.title) || legacyTitleText || "";

  return {
    title,
    doc: { type: "doc", content: body.length ? body : [{ type: "paragraph" }] },
  };
}

// A flat screenplay `{ type, text }[]` → the ProseMirror doc of `screenplay`
// nodes the editor renders. Mirrors the agent-side elementsToDoc
// (flue-agent/src/lib/script.ts) so importers (see src/lib/fountain.js) can seed
// a draft with the exact shape /api/script stores. Unknown types fall back to
// "action"; an empty result gets one paragraph (the schema needs ≥1 block).
export function elementsToDoc(elements) {
  const content = (elements || [])
    .filter((el) => el && typeof el.text === "string")
    .map((el) => {
      const spType = SP_TYPES.includes(el.type) ? el.type : "action";
      const text = el.text ?? "";
      return {
        type: "screenplay",
        attrs: { spType },
        content: text ? [{ type: "text", text }] : [],
      };
    });
  if (content.length === 0) content.push({ type: "paragraph" });
  return { type: "doc", content };
}

/* ---------------------------------------------------------------- *
 * Screenplay block                                                 *
 * ---------------------------------------------------------------- */

export const Screenplay = Node.create({
  name: "screenplay",
  group: "block",
  content: "inline*",

  addAttributes() {
    return {
      spType: {
        default: "action",
        parseHTML: (el) => {
          const spType = el.getAttribute("data-sp-type");
          return SP_TYPES.includes(spType) ? spType : "action";
        },
        renderHTML: (attrs) => ({ "data-sp-type": attrs.spType }),
      },
    };
  },

  // Both tags carry `data-sp-type`: `p` is what renderHTML emits (so this is the
  // rule that survives a copy/paste), `div` is the shape a clipboard that has
  // been through another app tends to hand back.
  parseHTML() {
    return [
      { tag: "p[data-sp-type]", priority: SP_PARSE_PRIORITY, getAttrs: spTypeAttrs },
      { tag: "div[data-sp-type]", priority: SP_PARSE_PRIORITY, getAttrs: spTypeAttrs },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "p",
      mergeAttributes(HTMLAttributes, { class: cls(node.attrs.spType) }),
      0,
    ];
  },

  addCommands() {
    const name = this.name;
    return {
      // Convert the current block into a screenplay element of `spType`.
      setScreenplay:
        (spType) =>
        ({ commands }) =>
          commands.setNode(name, { spType }),
      // Retype the block the selection is in (used by Tab / the toolbar select).
      setScreenplayType:
        (spType) =>
        ({ commands }) =>
          commands.updateAttributes(name, { spType }),
    };
  },

  addKeyboardShortcuts() {
    const name = this.name;
    const current = () => {
      const { $from } = this.editor.state.selection;
      return $from.parent.type.name === name ? $from.parent : null;
    };
    const cycle = (dir) => {
      const node = current();
      if (!node) return false;
      const i = SP_TYPES.indexOf(node.attrs.spType);
      const next = SP_TYPES[(i + dir + SP_TYPES.length) % SP_TYPES.length];
      return this.editor.commands.updateAttributes(name, { spType: next });
    };
    return {
      Enter: () => {
        const { state } = this.editor;
        const { $from } = state.selection;
        const node = $from.parent;
        if (node.type.name !== name) return false;
        const next = SP_NEXT_ON_ENTER[node.attrs.spType] || "action";
        const type = state.schema.nodes[name];
        // Split the current block; whatever follows the caret becomes a new
        // block of the NEXT screenplay type (empty at end-of-line, or the tail
        // text mid-line). `tr.split` with an explicit typesAfter creates exactly
        // one node — no stray trailing paragraph the way splitBlock can.
        return this.editor.commands.command(({ tr, dispatch }) => {
          if (dispatch) {
            tr.split($from.pos, 1, [{ type, attrs: { spType: next } }]);
            dispatch(tr.scrollIntoView());
          }
          return true;
        });
      },
      Tab: () => cycle(+1),
      "Shift-Tab": () => cycle(-1),
    };
  },
});
