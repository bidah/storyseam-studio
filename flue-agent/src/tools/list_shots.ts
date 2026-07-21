import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const listShots = (api: Api) =>
  defineTool({
    name: "list_shots",
    description:
      "List every shot (shot01, shot02, …) with its Seedance video prompt text, seed-audio prompt text, which media takes exist on disk (speech/vfx/video), and the audio segment it maps to. Use to inspect the per-shot pipeline.",
    async run({ signal }) {
      return await api.get("/api/shots", signal);
    },
  });
