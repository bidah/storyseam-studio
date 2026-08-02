import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const toggleLibrary = (api: Api) =>
  defineTool({
    name: "toggle_library",
    description:
      "Select or deselect a library image by its `rel` path. Selecting copies it into final_selection/ (making it available as an episode reference); deselecting removes it and drops it from any bundle picks. Toggles based on current state.",
    input: v.object({
      rel: d(
        v.pipe(v.string(), v.minLength(1)),
        "The image's `rel` field EXACTLY as returned by list_library (e.g. \"characters/helena_v2.png\") — NOT its `url`, `thumb`, or `refUrl`, and not URL-encoded. If you don't have the rel, call list_library first.",
      ),
    }),
    async run({ data: input, signal }) {
      const { rel } = input;
      return { output: await api.post("/api/library/toggle", { rel }, signal) };
    },
  });
