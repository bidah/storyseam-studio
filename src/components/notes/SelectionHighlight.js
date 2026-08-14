// A persistent highlight over one controlled range of the screenplay, drawn as a
// ProseMirror decoration rather than relying on the browser's native selection
// (which greys out the moment the editor loses focus — e.g. when the author
// clicks into the "ask the agent" box). Two visual modes:
//
//   "pending"  — the author has a passage selected and the ask box is open.
//   "working"  — the passage was sent to the agent; it's locked and highlighted
//                until the agent comes back with a proposed edit.
//
// The range is driven from React via `setSelectionHighlight({ from, to, mode })`
// / `clearSelectionHighlight()`. It re-maps through doc changes so it stays
// pinned to the same words if the document shifts underneath it.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

export const selectionHighlightKey = new PluginKey("selectionHighlight");

export const SelectionHighlight = Extension.create({
  name: "selectionHighlight",

  addCommands() {
    return {
      // range = { from, to, mode } — or null/omitted to clear.
      setSelectionHighlight:
        (range) =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(selectionHighlightKey, range || null));
          return true;
        },
      clearSelectionHighlight:
        () =>
        ({ tr, dispatch }) => {
          if (dispatch) dispatch(tr.setMeta(selectionHighlightKey, null));
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: selectionHighlightKey,
        state: {
          init: () => null, // { from, to, mode } | null
          apply(tr, value) {
            const meta = tr.getMeta(selectionHighlightKey);
            if (meta !== undefined) return meta; // explicit set (object) or clear (null)
            if (!value) return value;
            // Keep the highlight pinned to the same passage across doc edits.
            const from = tr.mapping.map(value.from);
            const to = tr.mapping.map(value.to);
            if (from >= to) return null;
            return { ...value, from, to };
          },
        },
        props: {
          decorations(state) {
            const v = selectionHighlightKey.getState(state);
            if (!v) return DecorationSet.empty;
            const cls = v.mode === "working" ? "script-sel-working" : "script-sel-pending";
            return DecorationSet.create(state.doc, [
              Decoration.inline(v.from, v.to, { class: cls }),
            ]);
          },
        },
      }),
    ];
  },
});
