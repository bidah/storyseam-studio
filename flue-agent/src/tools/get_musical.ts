import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const getMusical = (api: Api) =>
  defineTool({
    name: "get_musical",
    description:
      "Read the Musical tab (the song → audio 'shot bible'): the uploaded song (vocal stem + full mix + total length + any pasted lyrics), the global continuity lock, and every cut segment with its timecodes, playable vocal-only + full-mix URLs, and whatever lyric/prompt has been authored so far. Call this before authoring so you write against the ACTUAL cut boundaries and the author's pasted lyrics. A segment with an empty `lyric`/`prompt` still needs authoring.",
    async run({ signal }) {
      return { output: await api.get("/api/musical", signal) };
    },
  });
