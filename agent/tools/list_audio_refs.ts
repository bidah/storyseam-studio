import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `list_audio_refs`.
export default defineTool({
  description:
    "List the available voice/sound reference files (with their `rel` paths and URLs) and the current per-bundle audio picks. Use before select_audio_ref.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/audio");
  },
});
