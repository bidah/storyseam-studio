import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Api } from "../lib/api.js";

const d = (schema: v.GenericSchema, text: string) =>
  v.pipe(schema, v.description(text));

export const saveWorld = (api: Api) =>
  defineTool({
    name: "save_world",
    description:
      "Fill in the World bible shown on the World tab (the series' foundational world): the story map (the 5 shaping questions), the story-depth core elements, and the character roster. This MERGES — send only what you actually learned from interviewing the author, and everything you omit keeps its stored value. NEVER send an empty string or invented filler to 'reset' a field: an empty value is ignored, and the way to clear something is for the author to clear it on the World tab. Characters match on id (from get_world) or on name, and a character you don't mention is left alone — remove one only when the author asks. It does NOT touch LOCATIONS; add a place with `add_world_location`, never here. Returns the saved world.",
    input: v.object({
      title: v.optional(d(v.string(), "The series / world title.")),
      logline: v.optional(d(v.string(), "One sentence that captures the series.")),
      map: v.optional(
        v.object({
          world: v.optional(d(v.string(), "Q1: What is the world of your story? Where does it take place?")),
          protagonist: v.optional(d(v.string(), "Q2: Who is the protagonist? What is their main goal?")),
          antagonist: v.optional(d(v.string(), "Q3: Who or what is the antagonist?")),
          stakes: v.optional(d(v.string(), "Q4: What is the stake if they fail?")),
          theme: v.optional(d(v.string(), "Q5: What theme or message is driving the story?")),
        }),
      ),
      depth: v.optional(
        v.object({
          premise: v.optional(d(v.string(), "What the story is really about beneath the plot.")),
          wantVsNeed: v.optional(d(v.string(), "Character development: what they want vs. what they need.")),
          conflict: v.optional(d(v.string(), "The conflict & stakes — why the audience should care.")),
          obstacles: v.optional(d(v.string(), "The obstacles the protagonist faces and the consequences of failure.")),
          structure: v.optional(d(v.string(), "How the story is shaped — the arc / structure.")),
        }),
      ),
      characters: v.optional(
        v.array(
          v.object({
            id: v.optional(d(v.string(), "Existing character id (from get_world). Omit for a new character.")),
            name: d(v.string(), "Character name."),
            archetype: v.optional(d(v.string(), 'Type / archetype, e.g. "Protagonist", "Mentor", "Foil".')),
            role: v.optional(d(v.string(), "Their role in the story.")),
            want: v.optional(d(v.string(), "Their conscious goal (what they want).")),
            need: v.optional(d(v.string(), "What they actually need (the deeper lesson).")),
            traits: v.optional(d(v.string(), "Personality / traits.")),
            arc: v.optional(d(v.string(), "How they change over the story.")),
            voice: v.optional(d(v.string(), "How they speak.")),
            appearance: v.optional(d(v.string(), "Look / design notes.")),
            sheetImage: v.optional(
              v.nullable(
                d(
                  v.object({
                    rel: v.optional(v.string()),
                    url: v.optional(v.string()),
                    thumb: v.optional(v.string()),
                    name: v.optional(v.string()),
                  }),
                  "Linked character-sheet image. PRESERVE whatever get_world returned (pass it back unchanged), or null to unlink.",
                ),
              ),
            ),
            voiceRef: v.optional(
              v.nullable(
                d(
                  v.object({
                    trackId: v.optional(v.string()),
                    v: v.optional(v.nullable(v.number())),
                    name: v.optional(v.string()),
                    url: v.optional(v.string()),
                  }),
                  "Attached voice take. PRESERVE whatever get_world returned (pass it back unchanged), or null to unlink.",
                ),
              ),
            ),
          }),
        ),
      ),
      source: v.optional(d(v.string(), 'Provenance tag. Defaults to "agent".')),
    }),
    async run({ data: input, signal }) {
      const { title, logline, map, depth, characters, source } = input;
      return {
        output: await api.post(
          "/api/world",
          { title, logline, map, depth, characters, source: source || "agent" },
          signal,
        ),
      };
    },
  });
