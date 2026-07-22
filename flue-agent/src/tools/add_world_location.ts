import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const addWorldLocation = (api: Api) =>
  defineTool({
    name: "add_world_location",
    description:
      "Add ONE place to the World roster (the World tab's Locations). Use it to register a location that shots reference by `location` slug but that isn't on the roster yet — e.g. the gaps the Animatic's \"locations pass\" flags (a `?` badge = not on the roster) — so each place has a single card you can then attach reference art to, locking a consistent background across its shots. Pass the EXACT slug the shots use so it name-matches (e.g. \"school-clearing\"); `name` defaults to the slug. This is the ONLY safe way to add a location — do NOT use save_world for places (it can't carry them). It does NOT dedupe: call get_world first and skip any slug already on the roster. Mints and returns the location's id. Registering a place does NOT create its art: to generate a location image, use the sheet-generation skill (style preset + the project's location sheet prompt + a MANDATORY reference image — ask the user for one if none exists), never a free-form prompt.",
    input: v.object({
      slug: d(
        v.pipe(v.string(), v.minLength(1)),
        'The location slug exactly as shots reference it, e.g. "school-clearing".',
      ),
      name: v.optional(d(v.string(), "Display name shown on the card. Defaults to the slug.")),
      description: v.optional(
        d(v.string(), "What the place looks like — keep it consistent across scenes."),
      ),
    }),
    async run({ input, signal }) {
      return await api.post(
        "/api/world/location",
        { ...input, name: input.name || input.slug },
        signal,
      );
    },
  });
