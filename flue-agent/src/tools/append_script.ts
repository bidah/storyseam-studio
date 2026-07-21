import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";
import {
  docToElements,
  elementsToDoc,
  SCRIPT_ELEMENT_TYPES,
} from "../lib/script.js";
import type { ScriptElement } from "../lib/script.js";

export const appendScript = (api: Api) =>
  defineTool({
    name: "append_script",
    description:
      "Propose appending screenplay lines to the END of the current script without overwriting existing content. Staged as a proposal against the PINNED draft (the active version) — the user reviews the diff and accepts (in bulk or per line) before it commits. Each element is { type, text } (scene_heading, action, character, dialogue, parenthetical, transition). Use this to continue writing; use save_script only when you intend to replace the whole document.",
    input: v.object({
      summary: v.optional(
        d(
          v.string(),
          "One short line describing what you added, shown in the review header (e.g. 'Added the bridge scene').",
        ),
      ),
      elements: d(
        v.pipe(
          v.array(
            v.object({
              type: v.picklist(SCRIPT_ELEMENT_TYPES),
              text: v.string(),
            }),
          ),
          v.minLength(1),
        ),
        "Ordered screenplay lines to add after the current last line.",
      ),
    }),
    async run({ input, signal }) {
      const { summary, elements } = input as {
        summary?: string;
        elements: ScriptElement[];
      };
      const cur = (await api.get("/api/script", signal)) as unknown as {
        title?: string;
        doc?: unknown;
        proposal?: { proposedDoc?: unknown } | null;
      };
      // Build on top of any still-pending proposal so successive appends stack; the
      // diff the user sees is always against the committed doc (the server snapshots
      // that as the proposal's baseDoc).
      const base = cur.proposal?.proposedDoc ?? cur.doc;
      const combined = [...docToElements(base), ...elements];
      await api.req(
        "/api/script/proposal",
        "PUT",
        {
          proposedDoc: elementsToDoc(combined),
          title: cur.title || "",
          note:
            summary ||
            `Added ${elements.length} line${elements.length === 1 ? "" : "s"}`,
        },
        signal,
      );
      return {
        ok: true,
        proposed: true,
        added: elements.length,
        lineCount: combined.length,
        hint: "Staged as a proposal — tell the user what you added and ask if they want it applied. If they confirm, call apply_script_proposal; otherwise they can Accept/Reject (per line) on the Script tab.",
      };
    },
  });
