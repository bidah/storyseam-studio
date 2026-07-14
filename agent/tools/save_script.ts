import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";
import { elementsToDoc, SCRIPT_ELEMENT_TYPES } from "../lib/script.js";

// The model sees this as `save_script`. Proposes a WHOLE-screenplay replacement —
// read it first with get_script if you only mean to tweak part of it (or use
// append_script to add without overwriting). The edit is staged as a PROPOSAL the
// user reviews on the Script tab; it does not commit until they accept — either by
// hitting Accept on the Script tab (in bulk or per line) or by confirming in chat,
// after which you commit it for them with apply_script_proposal.
export default defineTool({
  description:
    "Propose replacing the entire screenplay on the Script tab with a new title + list of screenplay lines. The edit is STAGED as a proposal against the PINNED draft (the active version; other drafts untouched) and the user reviews a before→after diff and accepts it in bulk or per line — it is NOT committed until they accept. Each element is { type, text } where type is one of scene_heading, action, character, dialogue, parenthetical, transition. This proposes replacing everything — call get_script first if you're revising existing content. To keep the old text as a separate version, create a new draft with new_draft first, then propose into it.",
  inputSchema: z.object({
    title: z
      .string()
      .optional()
      .describe("Script title. Omit to keep the current title unchanged."),
    summary: z
      .string()
      .optional()
      .describe("One short line describing the change, shown to the user in the review header (e.g. 'Rewrote scene 3')."),
    elements: z
      .array(
        z.object({
          type: z.enum(SCRIPT_ELEMENT_TYPES),
          text: z.string().describe("The line's text (may be empty)."),
        }),
      )
      .describe("The full ordered list of screenplay lines, top to bottom."),
  }),
  async execute({ title, summary, elements }) {
    // Preserve the existing title when the caller omits one.
    let nextTitle = title;
    if (nextTitle === undefined) {
      const cur = await api<{ title?: string }>("/api/script");
      nextTitle = cur.title || "";
    }
    const doc = elementsToDoc(elements);
    await api("/api/script/proposal", {
      method: "PUT",
      body: { proposedDoc: doc, title: nextTitle, note: summary || "Rewrote the screenplay" },
    });
    return {
      ok: true,
      proposed: true,
      title: nextTitle,
      lineCount: elements.length,
      hint: "Staged as a proposal — tell the user what you changed and ask if they want it applied. If they confirm, call apply_script_proposal; otherwise they can Accept/Reject (per line) on the Script tab.",
    };
  },
});
