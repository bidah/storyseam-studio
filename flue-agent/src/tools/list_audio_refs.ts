import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const listAudioRefs = (api: Api) =>
  defineTool({
    name: "list_audio_refs",
    description:
      "List the available voice/sound references and the current per-bundle audio picks. The pool is the World roster's linked character voices (rel `world-voice:<charId>`), any legacy loose reference files that exist in THIS project, and every rendered Sound Studio take that is not cast to a character (rel `sound:<trackId>:v<n>`, `kind` voice/sfx/music). Each entry carries an agent-fetchable `refUrl`. Prefer a cast voice: it is matched to its speaker automatically, and a character's voice belongs on the World roster (attach_character_voice). A picked `sound:` take covers a speaker only once link_reference ties it to that speaker's `voice:<Name>` need. Use before select_audio_ref.",
    async run({ signal }) {
      return { output: await api.get("/api/audio", signal) };
    },
  });
