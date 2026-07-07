import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `list_shots`.
export default defineTool({
  description:
    "List every shot (shot01, shot02, …) with its Seedance video prompt text, seed-audio prompt text, which media takes exist on disk (speech/vfx/video), and the audio segment it maps to. Use to inspect the per-shot pipeline.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/shots");
  },
});
