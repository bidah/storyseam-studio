import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `get_radio`.
export default defineTool({
  description:
    "Read the Radio version — the audio-only dialogue pass derived from the Shot list. Returns { scenes, casting, totalLines, readyLines }. Each scene has { beat, beatTitle, lines: [{ id, shotId, shotN, character, text, voiceRef, take }] } where `id` is the line id (pass it to attach_radio_take), `voiceRef` is the character's cast voice ({ trackId, v, name, url, refUrl } or null — `refUrl` is an ABSOLUTE, publicly-fetchable URL of the reference clip; download it directly to voice the line with. `url` is the project-scoped /sound-media path), and `take` is the rendered voice take ({ trackId, v, status, url, ready } or null). `casting` lists each speaking character and its voice. Use before rendering a scene so you voice each line with the right reference clip.",
  inputSchema: z.object({}),
  async execute() {
    return await api("/api/radio");
  },
});
