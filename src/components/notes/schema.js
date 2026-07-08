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
        parseHTML: (el) => el.getAttribute("data-sp-type") || "action",
        renderHTML: (attrs) => ({ "data-sp-type": attrs.spType }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "p[data-sp-type]" }];
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
