import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const deleteSoundVersion = (api: Api) =>
  defineTool({
    name: "delete_sound_version",
    description:
      "Delete a single sound version and its media file. If it was the track's last version, the whole track is removed. Destructive — confirm with the user first.",
    input: v.object({
      id: d(v.pipe(v.string(), v.minLength(1)), "Track id, e.g. trk_2."),
      v: d(v.pipe(v.number(), v.integer(), v.minValue(1)), "Version number to delete."),
    }),
    async run({ input, signal }) {
      const { id, v } = input;
      return await api.req(
        `/api/sounds/${encodeURIComponent(String(id))}/version/${v}`,
        "DELETE",
        undefined,
        signal,
      );
    },
  });
