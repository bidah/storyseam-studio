import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `trim_video`.
export default defineTool({
  description:
    "Trim a rendered episode take to a sub-range [from,to] seconds with ffmpeg, saving the result as a NEW 'trim' version ALONGSIDE the original (the source take is never overwritten — it stays in history and stays selectable). The trim appears as an extra selectable card in the bundle's video carousel with a TRIM VERSION badge, and can be picked for stitching like any other take. Returns { url, file, name, kind, trim, count }.",
  inputSchema: z.object({
    bundle: z.string().describe("Bundle id, e.g. MS-01"),
    sourceFile: z
      .string()
      .describe("The `file` of the take to trim, e.g. MS-01_gen2.mp4 (from get_cuts / the episode video list)"),
    from: z.number().min(0).describe("Trim start in seconds (clamped to the clip)"),
    to: z.number().positive().describe("Trim end in seconds; must be at least 0.1s after `from`"),
  }),
  async execute({ bundle, sourceFile, from, to }) {
    return await api("/api/episode/trim", { method: "POST", body: { bundle, sourceFile, from, to } });
  },
});
