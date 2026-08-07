import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const saveMusicalSegments = (api: Api) =>
  defineTool({
    name: "save_musical_segments",
    description:
      "Author the creative layer of the Musical shot bible: the sung lyric and the Seedance/Kling director prompt for each already-cut segment, matched by `label` (from get_musical / split_song — never invent labels), plus the one global continuity lock. This ONLY writes text; the audio cuts and timecodes are set by split_song and are never touched, so you can re-save to revise a prompt without recutting. Each prompt MUST quote the exact sung lyric for that shot and say the mouth movements match it in Audio 1, and the SAME continuity lock (character, wardrobe, set, mic hand) belongs in every shot. Send only the segments you're authoring; unlisted ones are left as-is. Returns how many segments were updated.",
    input: v.object({
      segments: d(
        v.array(
          v.object({
            label: d(v.string(), "The segment label to author, copied verbatim from get_musical/split_song (e.g. \"01\", \"07A\")."),
            lyric: d(v.optional(v.string()), "The EXACT words sung in this shot (strip parenthetical stage directions). Use ' / ' to separate lines."),
            prompt: d(v.optional(v.string()), "The director prompt: duration+format line, framing, the quoted sung lyric + 'Her mouth movements match these exact words in Audio 1', action beats tied to specific lyrics, camera blocking, aesthetics, and a described final frame."),
            sec: d(v.optional(v.string()), "Optional short section label, e.g. \"Chorus, part 1\" or \"Bridge\"."),
          }),
        ),
        "The segments to author, matched by label.",
      ),
      continuity: d(v.optional(v.string()), "The global continuity lock pasted into every prompt (same character, wardrobe, set, mic hand; lip-sync to Audio 1). Saved once on the doc."),
    }),
    async run({ data: input, signal }) {
      return { output: await api.post("/api/musical/segments", input, signal) };
    },
  });
