import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `get_cuts`.
export default defineTool({
  description:
    "Get the ordered stitch plan: the selected take of each bundle in order, with per-segment durations and the current complete-cut output (if any). Use before stitch_cuts to preview what will be assembled.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/episode/cuts");
  },
});
