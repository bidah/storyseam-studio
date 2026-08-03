import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const createSound = (api: Api) =>
  defineTool({
    name: "create_sound",
    description:
      "Create a new Sound Studio track with an initial version 1 from a Seed Audio prompt. The version starts status 'pending' — render it with the seed-audio skill, then attach_sound to mark it ready. Returns the created track (with its id, e.g. trk_3).",
    input: v.object({
      prompt: d(v.pipe(v.string(), v.minLength(1)), "The Seed Audio text prompt for this sound."),
      name: v.optional(d(v.string(), "Optional display name for the track.")),
      kind: d(
        v.picklist(["music", "sfx", "voice"]),
        "Which Sound Studio tab the track belongs to: 'music' (background music), 'sfx' (sound effect), or 'voice' (voice-acting line).",
      ),
      params: v.optional(
        d(
          v.record(v.string(), v.unknown()),
          "Optional Seed Audio params (duration, etc.); defaults are used if omitted.",
        ),
      ),
    }),
    async run({ data: input, signal }) {
      const { prompt, name, kind, params } = input;
      return { output: await api.post("/api/sounds", { prompt, name, kind, params }, signal) };
    },
  });
