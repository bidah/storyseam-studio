import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

// The model sees this as `save_world`. Replaces the WHOLE world bible — call
// get_world first if you only mean to extend or tweak part of it, then re-send
// the complete object.
export default defineTool({
  description:
    "Write the World bible shown on the World tab (the series' foundational world). OVERWRITES the whole world — call get_world first if a world already exists so you don't drop fields. Fill in what you learned from interviewing the author: the story map (the 5 shaping questions), the story-depth core elements, and the character roster with type breakdowns. Leave a field as an empty string if genuinely unknown. Returns the saved world.",
  inputSchema: z.object({
    title: z.string().optional().describe("The series / world title."),
    logline: z.string().optional().describe("One sentence that captures the series."),
    map: z
      .object({
        world: z.string().optional().describe("Q1: What is the world of your story? Where does it take place?"),
        protagonist: z.string().optional().describe("Q2: Who is the protagonist? What is their main goal?"),
        antagonist: z.string().optional().describe("Q3: Who or what is the antagonist?"),
        stakes: z.string().optional().describe("Q4: What is the stake if they fail?"),
        theme: z.string().optional().describe("Q5: What theme or message is driving the story?"),
      })
      .optional()
      .describe("The story map — the 5 questions that shape the story."),
    depth: z
      .object({
        premise: z.string().optional().describe("What the story is really about beneath the plot — the deeper message."),
        wantVsNeed: z.string().optional().describe("Character development: what they want vs. what they need."),
        conflict: z.string().optional().describe("The conflict & stakes — why the audience should care."),
        obstacles: z.string().optional().describe("The obstacles the protagonist faces and the consequences of failure."),
        structure: z.string().optional().describe("How the story is shaped — the arc / structure."),
      })
      .optional()
      .describe("Story depth — the core elements that make us understand the story."),
    characters: z
      .array(
        z.object({
          id: z.string().optional().describe("Existing character id (from get_world). Omit for a new character."),
          name: z.string().describe("Character name."),
          archetype: z.string().optional().describe("Type / archetype, e.g. \"Protagonist\", \"Mentor\", \"Foil\"."),
          role: z.string().optional().describe("Their role in the story."),
          want: z.string().optional().describe("Their conscious goal (what they want)."),
          need: z.string().optional().describe("What they actually need (the deeper lesson)."),
          traits: z.string().optional().describe("Personality / traits."),
          arc: z.string().optional().describe("How they change over the story."),
          voice: z.string().optional().describe("How they speak."),
          appearance: z.string().optional().describe("Look / design notes."),
          sheetImage: z
            .object({
              rel: z.string().optional(),
              url: z.string().optional(),
              thumb: z.string().optional(),
              name: z.string().optional(),
            })
            .nullable()
            .optional()
            .describe(
              "Linked character-sheet image. PRESERVE whatever get_world returned (pass it back unchanged) so a full-world save doesn't wipe it; use attach_character_sheet to set/change it, or null to unlink.",
            ),
          voiceRef: z
            .object({
              trackId: z.string().optional(),
              v: z.number().nullable().optional(),
              name: z.string().optional(),
              url: z.string().optional(),
            })
            .nullable()
            .optional()
            .describe(
              "Attached voice take. PRESERVE whatever get_world returned (pass it back unchanged) so a full-world save doesn't wipe it; use attach_character_voice to set/change it, or null to unlink.",
            ),
        }),
      )
      .optional()
      .describe("The character roster with type breakdowns."),
    source: z.string().optional().describe("Provenance tag. Defaults to \"agent\"."),
  }),
  async execute({ title, logline, map, depth, characters, source }) {
    return await api("/api/world", {
      method: "POST",
      body: { title, logline, map, depth, characters, source: source || "agent" },
    });
  },
});
