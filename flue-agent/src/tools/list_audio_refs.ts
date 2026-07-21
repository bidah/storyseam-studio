import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const listAudioRefs = (api: Api) =>
  defineTool({
    name: "list_audio_refs",
    description:
      "List the available voice/sound reference files (with their `rel` paths and URLs) and the current per-bundle audio picks. Use before select_audio_ref.",
    async run({ signal }) {
      return await api.get("/api/audio", signal);
    },
  });
