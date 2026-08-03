import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";
import { elementsToDoc, SCRIPT_ELEMENT_TYPES } from "../lib/script.js";
import type { ScriptElement } from "../lib/script.js";

export const saveScript = (api: Api) =>
  defineTool({
    name: "save_script",
    description:
      "Propose replacing the entire screenplay on the Script tab with a new title + list of screenplay lines. The edit is STAGED as a proposal against the PINNED draft (the active version; other drafts untouched) and the user reviews a before→after diff and accepts it in bulk or per line — it is NOT committed until they accept. Each element is { type, text } where type is one of scene_heading, action, character, dialogue, parenthetical, transition. This proposes replacing everything — call get_script first if you're revising existing content. To keep the old text as a separate version, create a new draft with new_draft first, then propose into it." +
      " NEVER send a long script in one call: a single huge call can blow past the model turn's output limit and fail the whole turn. For anything beyond ~40 lines, send the FIRST ~40 lines here, then stream the rest with append_script, one ~40-line chunk per call, in order — successive appends stack onto this same pending proposal.",
    input: v.object({
      title: v.optional(
        d(v.string(), "Script title. Omit to keep the current title unchanged."),
      ),
      summary: v.optional(
        d(
          v.string(),
          "One short line describing the change, shown to the user in the review header (e.g. 'Rewrote scene 3').",
        ),
      ),
      elements: d(
        v.array(
          v.object({
            type: v.picklist(SCRIPT_ELEMENT_TYPES),
            text: d(v.string(), "The line's text (may be empty)."),
          }),
        ),
        "The full ordered list of screenplay lines, top to bottom.",
      ),
    }),
    async run({ data: input, signal }) {
      const { title, summary, elements } = input as {
        title?: string;
        summary?: string;
        elements: ScriptElement[];
      };
      // Preserve the existing title when the caller omits one.
      let nextTitle = title;
      if (nextTitle === undefined) {
        const cur = (await api.get("/api/script", signal)) as unknown as {
          title?: string;
        };
        nextTitle = cur.title || "";
      }
      const doc = elementsToDoc(elements);
      await api.req(
        "/api/script/proposal",
        "PUT",
        {
          proposedDoc: doc,
          title: nextTitle,
          note: summary || "Rewrote the screenplay",
        },
        signal,
      );
      return {
        output: {
          ok: true,
          proposed: true,
          title: nextTitle,
          lineCount: elements.length,
          hint: "Staged as a proposal — tell the user what you changed and ask if they want it applied. If they confirm, call apply_script_proposal; otherwise they can Accept/Reject (per line) on the Script tab.",
        },
      };
    },
  });
