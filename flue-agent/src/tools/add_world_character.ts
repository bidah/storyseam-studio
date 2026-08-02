import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const addWorldCharacter = (api: Api) =>
  defineTool({
    name: "add_world_character",
    description:
      "Add ONE new character to the World roster (the World tab). Use it to PROMOTE a shot-list speaker who isn't on the roster yet — e.g. one surfaced in save_shotlist's `newSpeakers` — into a stub World character, so casting has a single source of truth and attach_character_voice can reach them. Pass the EXACT `name` the shot list uses (so casting name-matches), and a one-line `role` that says who they are and which shots they appear in. Leave want/need/arc for the user to fill in later. Mints and returns the character's id. It does NOT dedupe: call get_world first and skip any name already on the roster. Don't promote genuine one-off bit-parts (a single line) — leave those off the roster; they stay castable from the Radio rail via cast_radio_voice.",
    input: v.object({
      name: d(
        v.pipe(v.string(), v.minLength(1)),
        "Character name — copy the shot list's exact spelling so casting matches (e.g. \"Store Owner\").",
      ),
      role: v.optional(
        d(
          v.string(),
          'One-line role + where they appear, e.g. "Shopkeeper Miles buys the burner from — shots 44-46 (beat B7)."',
        ),
      ),
      archetype: v.optional(d(v.string(), "Optional archetype, if obvious from the script.")),
      traits: v.optional(d(v.string(), "Optional short trait note.")),
      voice: v.optional(d(v.string(), "Optional voice description (tone/accent) to guide casting.")),
      appearance: v.optional(d(v.string(), "Optional appearance note.")),
    }),
    async run({ data: input, signal }) {
      return { output: await api.post("/api/world/character", input, signal) };
    },
  });
