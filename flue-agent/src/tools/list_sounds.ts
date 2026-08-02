import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const listSounds = (api: Api) =>
  defineTool({
    name: "list_sounds",
    description:
      "List every Sound Studio track (newest first) with its versions, each version's prompt, status (pending|ready), like flag, and media URL. Use to see what audio exists before creating or rendering.",
    async run({ signal }) {
      return { output: await api.get("/api/sounds", signal) };
    },
  });
