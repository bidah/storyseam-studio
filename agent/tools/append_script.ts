import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";
import { docToElements, elementsToDoc, SCRIPT_ELEMENT_TYPES } from "../lib/script.js";

// The model sees this as `append_script`. Proposes adding lines to the end of the
// current screenplay without touching what's already there — the safe way to keep
// writing (e.g. "add the next scene"). Staged as a PROPOSAL the user reviews on the
// Script tab; commit it with apply_script_proposal once the user confirms in chat.
export default defineTool({
  description:
    "Propose appending screenplay lines to the END of the current script without overwriting existing content. Staged as a proposal against the PINNED draft (the active version) — the user reviews the diff and accepts (in bulk or per line) before it commits. Each element is { type, text } (scene_heading, action, character, dialogue, parenthetical, transition). Use this to continue writing; use save_script only when you intend to replace the whole document.",
  inputSchema: z.object({
    summary: z
      .string()
      .optional()
      .describe("One short line describing what you added, shown in the review header (e.g. 'Added the bridge scene')."),
    elements: z
      .array(
        z.object({
          type: z.enum(SCRIPT_ELEMENT_TYPES),
          text: z.string(),
        }),
      )
      .min(1)
      .describe("Ordered screenplay lines to add after the current last line."),
  }),
  async execute({ summary, elements }) {
    const cur = await api<{ title?: string; doc?: unknown; proposal?: { proposedDoc?: unknown } | null }>("/api/script");
    // Build on top of any still-pending proposal so successive appends stack; the
    // diff the user sees is always against the committed doc (the server snapshots
    // that as the proposal's baseDoc).
    const base = cur.proposal?.proposedDoc ?? cur.doc;
    const combined = [...docToElements(base), ...elements];
    await api("/api/script/proposal", {
      method: "PUT",
      body: {
        proposedDoc: elementsToDoc(combined),
        title: cur.title || "",
        note: summary || `Added ${elements.length} line${elements.length === 1 ? "" : "s"}`,
      },
    });
    return {
      ok: true,
      proposed: true,
      added: elements.length,
      lineCount: combined.length,
      hint: "Staged as a proposal — tell the user what you added and ask if they want it applied. If they confirm, call apply_script_proposal; otherwise they can Accept/Reject (per line) on the Script tab.",
    };
  },
});
