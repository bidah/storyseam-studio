import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `select_reference`.
export default defineTool({
  description:
    "Select or deselect a final-selection image as a chosen reference for one episode bundle. `rel` is the image's project-relative path.",
  inputSchema: z.object({
    bundle: z.string().min(1).describe("Bundle id, e.g. MS-01."),
    rel: z.string().min(1).describe("Project-relative path of the image."),
    selected: z.boolean().describe("true to add, false to remove."),
  }),
  async execute({ bundle, rel, selected }) {
    return await api("/api/episode/select", {
      method: "POST",
      body: { bundle, rel, selected },
    });
  },
});
