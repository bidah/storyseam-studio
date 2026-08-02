import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const saveAudioPrompt = (api: Api) =>
  defineTool({
    name: "save_audio_prompt",
    description:
      "Save the seed-audio prompt text for one shot. Writes that shot's per-shot audio prompt (falling back to the shared SEGMENT block when the shot has no own block).",
    input: v.object({
      id: d(v.pipe(v.string(), v.minLength(1)), "Shot id, e.g. shot03."),
      text: d(v.string(), "The full replacement seed-audio prompt text for this shot."),
    }),
    async run({ data: input, signal }) {
      const { id, text } = input;
      return {
        output: await api.req(
          `/api/shots/${encodeURIComponent(String(id))}/audio`,
          "PUT",
          { text },
          signal,
        ),
      };
    },
  });
