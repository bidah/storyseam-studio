import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `edit_sound_version`.
export default defineTool({
  description:
    "Edit an existing version's prompt and/or name IN PLACE without creating a new version. Use for a typo or wording tweak before rendering. To create a fresh take instead, use add_sound_version.",
  inputSchema: z.object({
    id: z.string().min(1).describe("Track id, e.g. trk_2."),
    v: z.number().int().positive().describe("Version number to edit."),
    prompt: z.string().optional(),
    name: z.string().optional(),
  }),
  async execute({ id, v, prompt, name }) {
    return await api(`/api/sounds/${encodeURIComponent(id)}/version/${v}`, {
      method: "PATCH",
      body: { prompt, name },
    });
  },
});
