import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";
import { docToElements, elementsToDoc, SCRIPT_ELEMENT_TYPES } from "../lib/script.js";

// The model sees this as `append_script`. Adds lines to the end of the current
// screenplay without touching what's already there — the safe way to keep
// writing (e.g. "add the next scene").
export default defineTool({
  description:
    "Append screenplay lines to the END of the current script without overwriting existing content. Adds to the PINNED draft only — the active version. Each element is { type, text } (scene_heading, action, character, dialogue, parenthetical, transition). Use this to continue writing; use save_script only when you intend to replace the whole document. Autosaves; appears when the editor reloads.",
  inputSchema: z.object({
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
  async execute({ elements }) {
    const cur = await api<{ title?: string; doc?: unknown }>("/api/script");
    const combined = [...docToElements(cur.doc), ...elements];
    await api("/api/script", {
      method: "PUT",
      body: { title: cur.title || "", doc: elementsToDoc(combined) },
    });
    return { ok: true, added: elements.length, lineCount: combined.length };
  },
});
