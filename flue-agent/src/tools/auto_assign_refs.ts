import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const autoAssignRefs = (api: Api) =>
  defineTool({
    name: "auto_assign_refs",
    description:
      "Auto-assign each episode bundle's reference picks from the WORLD ROSTER (the single source of truth): every on-screen character's linked sheet image, each shot location's linked location sheet, and each speaker's linked voice. With no arguments it overwrites the image + audio picks of EVERY bundle; pass `beat` (e.g. \"B1\") to re-assign only that beat's bundles and leave the rest untouched. If the result is `ok: false` with a `validation` object, some characters aren't linked in the World yet — STOP and show the user the returned `message` as a validation notice. Do NOT look for substitute references in the Sound Studio, the asset library, or another project; the only fix is linking each character's sheet and voice (attach_character_sheet / attach_character_voice or the World tab), then re-running.",
    input: v.object({
      beat: v.optional(
        d(
          v.pipe(v.string(), v.minLength(1)),
          "Beat id, e.g. B1. Scopes the run to that beat's bundles.",
        ),
      ),
    }),
    async run({ data: input, signal }) {
      const beat = input.beat ? String(input.beat).trim() : undefined;
      return {
        output: await api.post(
          "/api/episode/auto-assign",
          beat ? { beat } : undefined,
          signal,
        ),
      };
    },
  });
