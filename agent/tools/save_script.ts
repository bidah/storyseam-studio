import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";
import { elementsToDoc, SCRIPT_ELEMENT_TYPES } from "../lib/script.js";

// The model sees this as `save_script`. Replaces the WHOLE screenplay — read it
// first with get_script if you only mean to tweak part of it (or use
// append_script to add without overwriting).
export default defineTool({
  description:
    "Replace the entire screenplay on the Script tab with a new title + list of screenplay lines. Each element is { type, text } where type is one of scene_heading, action, character, dialogue, parenthetical, transition. This OVERWRITES the current script — call get_script first if you're revising existing content. The change autosaves and appears when the user's editor reloads.",
  inputSchema: z.object({
    title: z
      .string()
      .optional()
      .describe("Script title. Omit to keep the current title unchanged."),
    elements: z
      .array(
        z.object({
          type: z.enum(SCRIPT_ELEMENT_TYPES),
          text: z.string().describe("The line's text (may be empty)."),
        }),
      )
      .describe("The full ordered list of screenplay lines, top to bottom."),
  }),
  async execute({ title, elements }) {
    // Preserve the existing title when the caller omits one.
    let nextTitle = title;
    if (nextTitle === undefined) {
      const cur = await api<{ title?: string }>("/api/script");
      nextTitle = cur.title || "";
    }
    const doc = elementsToDoc(elements);
    await api("/api/script", {
      method: "PUT",
      body: { title: nextTitle, doc },
    });
    return { ok: true, title: nextTitle, lineCount: elements.length };
  },
});
