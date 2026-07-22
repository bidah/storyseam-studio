import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import type { Api } from "../lib/api.js";

const d = (schema: v.GenericSchema, text: string) =>
  v.pipe(schema, v.description(text));

export const attachStill = (api: Api) =>
  defineTool({
    name: "attach_still",
    description:
      "Attach a generated storyboard STILL to one shot inside an episode bundle by URL. Appends a new take (keeps prior takes) and downloads the image so it shows in the Episode tab's Images mode and on the animatic's picture track. Used after generating a still with the generate-storyboard skill. ALWAYS pass `prompt`, `model` and `refs` — they record how the image was made and prefill the Editor's 'New still…' modal. Returns the take's `file`, which edit_timeline's `replace` op needs to put this still on the timeline.",
    input: v.object({
      bundle: d(v.pipe(v.string(), v.minLength(1)), "Bundle id the shot belongs to, e.g. MS-01."),
      shot: d(v.pipe(v.string(), v.minLength(1)), "Shot id within the bundle, e.g. MS-012."),
      url: d(v.pipe(v.string(), v.url()), "Remote URL of the generated still image (png/jpg/webp)."),
      angle: v.optional(d(v.string(), "Optional short note on the camera angle / variation, e.g. 'low angle CU'.")),
      jobId: v.optional(d(v.string(), "Optional Higgsfield job id for reference.")),
      prompt: v.optional(d(v.string(), "The EXACT prompt text you sent to the image model.")),
      model: v.optional(d(v.string(), "The image model id you actually used, e.g. 'nano_banana_pro'.")),
      refs: v.optional(
        d(
          v.array(
            v.object({
              key: v.optional(d(v.string(), "Reference key, e.g. 'helena' or 'school-clearing'.")),
              role: v.optional(d(v.string(), "What it locks: 'character' or 'location'.")),
              url: v.optional(d(v.string(), "The reference image URL you passed to the model.")),
            }),
          ),
          "The reference images you actually passed as reference media for this generation.",
        ),
      ),
      shotSnapshot: v.optional(
        d(
          v.object({
            location: v.optional(v.string()),
            camera: v.optional(v.string()),
            action: v.optional(v.string()),
            dialogue: v.optional(v.string()),
            dur: v.optional(v.number()),
          }),
          "The shot's data AT generation time — so a later edit can tell whether the shot has changed since.",
        ),
      ),
    }),
    async run({ input, signal }) {
      return await api.post("/api/storyboard/image", input, signal);
    },
  });
