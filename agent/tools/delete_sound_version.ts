import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `delete_sound_version`.
export default defineTool({
  description:
    "Delete a single sound version and its media file. If it was the track's last version, the whole track is removed. Destructive — confirm with the user first.",
  inputSchema: z.object({
    id: z.string().min(1).describe("Track id, e.g. trk_2."),
    v: z.number().int().positive().describe("Version number to delete."),
  }),
  async execute({ id, v }) {
    return await api(`/api/sounds/${encodeURIComponent(id)}/version/${v}`, { method: "DELETE" });
  },
});
