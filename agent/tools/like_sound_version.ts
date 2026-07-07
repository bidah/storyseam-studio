import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `like_sound_version`.
export default defineTool({
  description: "Toggle the 'like' star on a specific sound version (marks a favourite take).",
  inputSchema: z.object({
    id: z.string().min(1).describe("Track id, e.g. trk_2."),
    v: z.number().int().positive().describe("Version number."),
  }),
  async execute({ id, v }) {
    return await api(`/api/sounds/${encodeURIComponent(id)}/version/${v}/like`, { method: "POST" });
  },
});
