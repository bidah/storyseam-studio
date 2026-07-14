import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";
import { attachableVoices } from "../lib/voices.js";

// The model sees this as `list_character_voices`.
export default defineTool({
  description:
    "List the liked Sound Studio voice takes that can be attached to a World character with attach_character_voice. Returns { voices: [{ trackId, v, name, url }] } where `url` is a playable /sound-media link — share it (or link it) so the user can hear a voice before choosing. Only voice-kind tracks with a liked, rendered take appear; if it's empty, the user needs to like a voice take on the Sounds tab first.",
  inputSchema: z.object({}),
  async execute() {
    const sounds = await api<{ tracks?: any[] }>("/api/sounds");
    return { voices: attachableVoices(sounds?.tracks || []) };
  },
});
