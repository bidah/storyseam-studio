import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const editSoundVersion = (api: Api) =>
  defineTool({
    name: "edit_sound_version",
    description:
      "Edit an existing version's prompt and/or name IN PLACE without creating a new version. Use for a typo or wording tweak before rendering. To create a fresh take instead, use add_sound_version.",
    input: v.object({
      id: d(v.pipe(v.string(), v.minLength(1)), "Track id, e.g. trk_2."),
      v: d(v.pipe(v.number(), v.integer(), v.minValue(1)), "Version number to edit."),
      prompt: v.optional(v.string()),
      name: v.optional(v.string()),
    }),
    async run({ input, signal }) {
      const { id, v, prompt, name } = input;
      return await api.req(
        `/api/sounds/${encodeURIComponent(String(id))}/version/${v}`,
        "PATCH",
        { prompt, name },
        signal,
      );
    },
  });
