import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const getEpisode = (api: Api) =>
  defineTool({
    name: "get_episode",
    description:
      "Get the full episode plan: the multishot bundles (MS-01 …), their rendered video generations, per-bundle prompt overrides, and sign-off state. Use to inspect episode assembly progress.",
    async run({ signal }) {
      return await api.get("/api/episode", signal);
    },
  });
