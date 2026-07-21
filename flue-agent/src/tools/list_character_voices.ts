import { defineTool } from "@flue/runtime";
import type { Api, Json } from "../lib/api.js";
import { attachableVoices } from "../lib/voices.js";

export const listCharacterVoices = (api: Api) =>
  defineTool({
    name: "list_character_voices",
    description:
      "List the liked Sound Studio voice takes that can be attached to a World character with attach_character_voice. Returns { voices: [{ trackId, v, name, url }] } where `url` is a playable /sound-media link — share it (or link it) so the user can hear a voice before choosing. Only voice-kind tracks with a liked, rendered take appear; if it's empty, the user needs to like a voice take on the Sounds tab first.",
    async run({ signal }) {
      const sounds = await api.get<{ tracks?: any[] }>("/api/sounds", signal);
      return { voices: attachableVoices(sounds?.tracks || []) } as Json;
    },
  });
