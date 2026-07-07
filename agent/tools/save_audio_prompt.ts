import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `save_audio_prompt`.
export default defineTool({
  description:
    "Save the seed-audio prompt text for one shot. Writes that shot's per-shot audio prompt (falling back to the shared SEGMENT block when the shot has no own block).",
  inputSchema: z.object({
    id: z.string().min(1).describe("Shot id, e.g. shot03."),
    text: z.string().describe("The full replacement seed-audio prompt text for this shot."),
  }),
  async execute({ id, text }) {
    return await api(`/api/shots/${encodeURIComponent(id)}/audio`, {
      method: "PUT",
      body: { text },
    });
  },
});
