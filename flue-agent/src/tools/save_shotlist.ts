import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const saveShotlist = (api: Api) =>
  defineTool({
    name: "save_shotlist",
    description:
      'Write the Shot list on the Shot list tab (the granular per-shot breakdown that auto-packs into <=15s multishot bundles). Two modes via `mode`: "replace" (default) OVERWRITES all shots; "append" adds `shots` to the END of the current list. For a full episode, DO NOT emit the whole list in one "replace" call — that single tool call can exceed the model output limit and fail the turn. Instead build it beat by beat: call once with mode "replace" carrying only the FIRST beat, then call again with mode "append" for each subsequent beat. Each call is bounded and the list is durably saved after every batch (a crash mid-generation leaves resumable partial progress). ALWAYS carry each existing shot\'s `id` through unchanged: shot ids key generated media that lives elsewhere (storyboard stills, the animatic\'s picture track), so inventing new ids for existing shots orphans that media. Only omit `id` for a genuinely NEW shot. Each shot\'s `beat`/`beatTitle` and `location` drive the packing (a bundle never crosses a beat or location and never exceeds 15s), so keep consecutive same-location shots grouped and give a realistic `dur`. `prompt` is the Seedance prompt (fold any 2D-directing intent directly into it). Returns the shot count (running total), the write mode, how many ids were preserved vs auto-numbered (replace only), any warnings, `newSpeakers` (speaking characters in the shot list with NO World roster record yet — each with its line count and the shots/beats it appears in, so you can offer to promote the recurring ones into the World with add_world_character and leave one-off bit-parts off), and the resulting <=15s pack preview.',
    input: v.object({
      mode: v.optional(
        d(
          v.picklist(["replace", "append"]),
          'Write mode. "replace" (default) overwrites the whole list. "append" adds these shots to the end — use it to build a long shot list one beat at a time so no single call carries the whole episode. Regenerate by calling "replace" with the first beat, then "append" for each later beat.',
        ),
      ),
      shots: d(
        v.array(
          v.object({
            id: v.optional(
              d(
                v.string(),
                'Shot id, e.g. "MS-012". REQUIRED for any shot that already exists — copy it verbatim from get_shotlist. It keys this shot\'s storyboard stills; changing it orphans them. Omit ONLY for a brand-new shot (it will be auto-numbered).',
              ),
            ),
            beat: d(v.string(), 'Beat code, e.g. "B1" — packing boundary.'),
            beatTitle: v.optional(
              d(v.string(), 'Human beat title, e.g. "Beat 1 — School clearing".'),
            ),
            dur: d(
              v.number(),
              "Estimated shot length in seconds (drives the <=15s packing).",
            ),
            location: d(
              v.string(),
              'Location slug, e.g. "school-clearing" — a bundle never crosses locations.',
            ),
            characters: v.optional(
              d(
                v.array(v.string()),
                'Characters on screen, using the EXACT canonical name from the World roster (get_world) for each — e.g. ["Kai Morales","Darius Cole"], never a short form like ["Kai","Darius"]. Casting matches a character to a voice by this exact name, so a variant gets the same person cast twice. Only genuinely off-roster background roles get an ad-hoc label ("Store Owner"). The server also snaps an unambiguous short name back to its full roster name and warns.',
              ),
            ),
            camera: v.optional(d(v.string(), "Camera/framing + move.")),
            action: d(v.string(), "What happens in the shot."),
            dialogue: v.optional(
              d(v.string(), 'Spoken line(s), or "(no dialogue)".'),
            ),
            audioSync: v.optional(
              d(v.string(), "Audio-sync note (the line/SFX this shot lands on)."),
            ),
            prompt: d(v.string(), "The Seedance prompt for this shot."),
          }),
        ),
        "The full ordered shot list, top to bottom.",
      ),
      source: v.optional(
        d(v.string(), 'Provenance tag, e.g. "agent". Defaults to "agent".'),
      ),
    }),
    async run({ input, signal }) {
      const { shots, source, mode } = input;
      return await api.post(
        "/api/shotlist",
        { shots, source: source || "agent", mode: mode || "replace" },
        signal,
      );
    },
  });
