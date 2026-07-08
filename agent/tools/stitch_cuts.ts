import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `stitch_cuts`.
export default defineTool({
  description:
    "Stitch the selected take of every bundle (in order) into a NEW versioned complete-cut mp4 (complete_cut_vN.mp4) with ffmpeg — never overwrites a prior version, so the browser can't show a stale cached cut. If background music was added before, the fresh cut is automatically re-scored so the newest version keeps its music (carriedMusic=true). Returns { url, file, version, kind, carriedMusic, totalDuration, count }. Requires at least one rendered+selected take.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/episode/stitch", { method: "POST" });
  },
});
