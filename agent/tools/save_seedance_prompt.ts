import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `save_seedance_prompt`.
export default defineTool({
  description:
    "Overwrite the Seedance (video) prompt block for one shot in the shotlist file. Rewrites ONLY that shot's SHOT: NN block, preserving the rest of the file.",
  inputSchema: z.object({
    id: z.string().min(1).describe("Shot id, e.g. shot03."),
    text: z.string().describe("The full replacement Seedance prompt text for this shot."),
  }),
  async execute({ id, text }) {
    return await api(`/api/shots/${encodeURIComponent(id)}/seedance`, {
      method: "PUT",
      body: { text },
    });
  },
});
