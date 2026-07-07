import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `save_episode_prompt`.
export default defineTool({
  description:
    "Save (or clear) the per-bundle skill-prompt override for one episode bundle. Pass empty/omitted text to clear the override so the bundle falls back to the live-composed prompt.",
  inputSchema: z.object({
    bundle: z.string().min(1).describe("Bundle id, e.g. MS-01."),
    text: z.string().optional().describe("Override prompt text; omit or empty to clear."),
  }),
  async execute({ bundle, text }) {
    return await api("/api/episode/prompt", { method: "POST", body: { bundle, text } });
  },
});
