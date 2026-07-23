import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const autoAssignRefs = (api: Api) =>
  defineTool({
    name: "auto_assign_refs",
    description:
      "Auto-assign selected Library images to episode bundles by classifying each image (character/location/etc.) and matching bundle role requirements, and pick one voice reference per bundle. With no arguments it overwrites the image + audio picks of EVERY bundle; pass `beat` (e.g. \"B1\") to re-assign only that beat's bundles and leave the rest untouched. Returns a summary of how many images each bundle got.",
    input: v.object({
      beat: v.optional(
        d(
          v.pipe(v.string(), v.minLength(1)),
          "Beat id, e.g. B1. Scopes the run to that beat's bundles.",
        ),
      ),
    }),
    async run({ input, signal }) {
      const beat = input.beat ? String(input.beat).trim() : undefined;
      return await api.post(
        "/api/episode/auto-assign",
        beat ? { beat } : undefined,
        signal,
      );
    },
  });
