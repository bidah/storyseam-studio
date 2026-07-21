import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const getCuts = (api: Api) =>
  defineTool({
    name: "get_cuts",
    description:
      "Get the ordered stitch plan: the selected take of each bundle in order, with per-segment durations and the current complete-cut output (if any). Use before stitch_cuts to preview what will be assembled.",
    async run({ signal }) {
      return await api.get("/api/episode/cuts", signal);
    },
  });
