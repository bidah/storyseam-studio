import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `load_cut_into_editor`.
export default defineTool({
  description:
    "Load a complete cut into the video editor timeline — its ordered video clips plus the music bed, exactly as the cut was assembled. Replaces whatever timeline was loaded before. Use when the user wants to 'edit the complete cut', 'open the cut in the editor', or start editing a specific version. `v` picks the cut generation (see get_timeline's `cuts` list); omit `v` to load the latest generation. Returns { ok, timeline }.",
  inputSchema: z.object({
    v: z
      .number()
      .int()
      .optional()
      .describe("Cut generation version to load (from get_timeline's `cuts`). Omit for the latest."),
  }),
  async execute({ v }) {
    return await api("/api/timeline/from-cut", { method: "POST", body: { v } });
  },
});
