import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const listAudioRefs = (api: Api) =>
  defineTool({
    name: "list_audio_refs",
    description:
      "List the available voice/sound references and the current per-bundle audio picks. The pool is the World roster's linked character voices (rel `world-voice:<charId>`, with an agent-fetchable `refUrl`) plus any legacy loose reference files that exist in THIS project. If a character's voice is missing here, it must be linked on the World roster (attach_character_voice) — do not import files from the Sound Studio as substitutes. Use before select_audio_ref.",
    async run({ signal }) {
      return await api.get("/api/audio", signal);
    },
  });
