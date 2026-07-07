import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `select_video`.
export default defineTool({
  description:
    "Mark one rendered generation of a bundle as selected (or not) for the final stitch. Only selected takes are included by stitch_cuts. `file` is the generation's file name from get_episode.",
  inputSchema: z.object({
    bundle: z.string().min(1).describe("Bundle id, e.g. MS-01."),
    file: z.string().min(1).describe("Generation file name, e.g. MS-01_gen2.mp4."),
    selected: z.boolean(),
  }),
  async execute({ bundle, file, selected }) {
    return await api("/api/episode/video-select", {
      method: "POST",
      body: { bundle, file, selected },
    });
  },
});
