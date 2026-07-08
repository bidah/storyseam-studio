import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";
import { docToElements } from "../lib/script.js";

// The model sees this as `get_script`.
export default defineTool({
  description:
    "Read the current screenplay from the Script tab. Returns the title and a flat `elements` array of screenplay lines ({ type, text }) where type is one of scene_heading, action, character, dialogue, parenthetical, transition. Use before editing so you know what is already written.",
  inputSchema: z.object({}),
  async execute() {
    const data = await api<{ title?: string; doc?: unknown; updatedAt?: string }>(
      "/api/script",
    );
    const elements = docToElements(data.doc);
    return {
      title: data.title || "",
      elements,
      lineCount: elements.length,
      updatedAt: data.updatedAt ?? null,
    };
  },
});
