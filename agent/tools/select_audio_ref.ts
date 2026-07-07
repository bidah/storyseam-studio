import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `select_audio_ref`.
export default defineTool({
  description:
    "Select or deselect a voice/sound reference for one episode bundle. Use list_audio_refs to see available references and their `rel` paths.",
  inputSchema: z.object({
    bundle: z.string().min(1).describe("Bundle id, e.g. MS-01."),
    rel: z.string().min(1).describe("Project-relative path of the voice reference."),
    selected: z.boolean().describe("true to add, false to remove."),
  }),
  async execute({ bundle, rel, selected }) {
    return await api("/api/episode/audio-select", {
      method: "POST",
      body: { bundle, rel, selected },
    });
  },
});
