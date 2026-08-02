import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const getMultishot = (api: Api) =>
  defineTool({
    name: "get_multishot",
    description:
      "Get the multishot experiment manifest (shots 1–4 combined clip experiment) with any generated media URLs.",
    async run({ signal }) {
      return { output: await api.get("/api/multishot", signal) };
    },
  });
