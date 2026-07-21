import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const saveShotlist = (api: Api) =>
  defineTool({
    name: "save_shotlist",
    description:
      "Replace the entire Shot list on the Shot list tab with a new ordered list of shots (the granular per-shot breakdown that auto-packs into <=15s multishot bundles). Writes shotlist.json and OVERWRITES all shots — call get_shotlist first if revising. ALWAYS carry each existing shot's `id` through unchanged: shot ids key generated media that lives elsewhere (storyboard stills, the animatic's picture track), so inventing new ids for existing shots orphans that media. Only omit `id` for a genuinely NEW shot. Each shot's `beat`/`beatTitle` and `location` drive the packing (a bundle never crosses a beat or location and never exceeds 15s), so keep consecutive same-location shots grouped and give a realistic `dur`. `prompt` is the Seedance prompt (fold any 2D-directing intent directly into it). Returns the shot count, how many ids were preserved vs auto-numbered, any warnings, and the resulting <=15s pack preview.",
    input: v.object({
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
                'Characters on screen, e.g. ["Helena","Sara"].',
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
      const { shots, source } = input;
      return await api.post(
        "/api/shotlist",
        { shots, source: source || "agent" },
        signal,
      );
    },
  });
