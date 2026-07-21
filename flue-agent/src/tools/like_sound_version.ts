import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const likeSoundVersion = (api: Api) =>
  defineTool({
    name: "like_sound_version",
    description: "Toggle the 'like' star on a specific sound version (marks a favourite take).",
    input: v.object({
      id: d(v.pipe(v.string(), v.minLength(1)), "Track id, e.g. trk_2."),
      v: d(v.pipe(v.number(), v.integer(), v.minValue(1)), "Version number."),
    }),
    async run({ input, signal }) {
      const { id, v } = input;
      return await api.post(
        `/api/sounds/${encodeURIComponent(String(id))}/version/${v}/like`,
        undefined,
        signal,
      );
    },
  });
