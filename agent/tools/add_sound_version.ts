import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `add_sound_version`.
export default defineTool({
  description:
    "Add a NEW version to an existing Sound Studio track from an edited prompt. Bumps the version number and starts it 'pending'. Use when iterating on a sound while keeping prior takes. For a small fix that should NOT create a new take, use edit_sound_version instead.",
  inputSchema: z.object({
    id: z.string().min(1).describe("Track id, e.g. trk_2."),
    prompt: z.string().min(1).describe("The new/edited Seed Audio prompt."),
    name: z.string().optional().describe("Optional name for this version."),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  async execute({ id, prompt, name, params }) {
    return await api(`/api/sounds/${encodeURIComponent(id)}/version`, {
      method: "POST",
      body: { prompt, name, params },
    });
  },
});
