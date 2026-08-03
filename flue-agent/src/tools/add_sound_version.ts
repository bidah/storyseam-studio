import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const addSoundVersion = (api: Api) =>
  defineTool({
    name: "add_sound_version",
    description:
      "Add a NEW version to an existing Sound Studio track from an edited prompt. Bumps the version number and starts it 'pending'. Use when iterating on a sound while keeping prior takes. For a small fix that should NOT create a new take, use edit_sound_version instead.",
    input: v.object({
      id: d(v.pipe(v.string(), v.minLength(1)), "Track id, e.g. trk_2."),
      prompt: d(v.pipe(v.string(), v.minLength(1)), "The new/edited Seed Audio prompt."),
      name: v.optional(d(v.string(), "Optional name for this version.")),
      params: v.optional(v.record(v.string(), v.unknown())),
    }),
    async run({ data: input, signal }) {
      const { id, prompt, name, params } = input;
      return {
        output: await api.post(
          `/api/sounds/${encodeURIComponent(String(id))}/version`,
          { prompt, name, params },
          signal,
        ),
      };
    },
  });
