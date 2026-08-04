import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";

// The canonical casting passage. Every voice in the project is cloned from this
// exact ~15s coverage (calm → excited → questioning) so the reference clip works
// for any line it later voices. The spoken words NEVER vary per character — only
// the voice traits in the parenthetical do. Kept here, not in the model's hands:
// a script-sourced or improvised sample bakes a random mood into the clone.
const CANONICAL_SAMPLE =
  'speaks a single clean take — one voice, no music, no sound effects, no background ambience. They start calm and steady: "I walked the long path this morning, past the old stone, and the woods were quiet as sleep." Then bright and excited: "Then the wind turned — the whole forest woke up with birdsong, all at once, like it knew something!" Then soft, curious questions: "Did you hear it too? What do you think it means?" Let the final word ring out completely, then hold about one second of clean silence before the clip ends.';

export const castingSamplePrompt = () =>
  defineTool({
    name: "casting_sample_prompt",
    description:
      "Build the generate_audio arguments for a character CASTING SAMPLE — the reference clip a new voice is cloned from. MANDATORY whenever you cast, create, or audition a voice: the spoken dialogue of a casting sample is fixed project-wide (calm → excited → questioning, ~15s) and is NOT yours to write — never compose sample dialogue yourself, never lift the character's lines from the script or their World record (that bakes one scene's mood into the clone and ruins every later line). Only the voice TRAITS vary per character. Call this with the character's name + traits, then pass the returned `prompt` and params to generate_audio VERBATIM — if the words you are about to render differ from this tool's output, you are doing it wrong. Returns { prompt, model, format, sample_rate }.",
    input: v.object({
      character: d(
        v.pipe(v.string(), v.minLength(1)),
        'Character name, e.g. "DeShawn".',
      ),
      traits: d(
        v.pipe(v.string(), v.minLength(1)),
        "Voice traits only — age, timbre, accent, pace — from the World record's `voice` field or the user's direction, e.g. \"male, 50s, warm gravelly baritone, unhurried\". Traits, not dialogue: any quoted lines put here are ignored by the renderer's intent and pollute the clone.",
      ),
    }),
    async run({ data: input }) {
      const { character, traits } = input;
      return {
        output: {
          model: "seed_audio",
          format: "wav",
          sample_rate: 48000,
          prompt: `${character} (${traits}) ${CANONICAL_SAMPLE}`,
          note:
            "Pass prompt + params to generate_audio verbatim. Then create_sound({ kind: 'voice', name: '" +
            character +
            " — casting sample' }), attach_sound, like_sound_version, and attach to the speaker (attach_character_voice by id, or cast_radio_voice by name).",
        },
      };
    },
  });
