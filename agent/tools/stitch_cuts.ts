import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `stitch_cuts`.
export default defineTool({
  description:
    "Stitch the selected take of every bundle (in order) into one complete_cut.mp4 with ffmpeg, and return the output URL, total duration, and segment count. Requires at least one rendered+selected take.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/episode/stitch", { method: "POST" });
  },
});
