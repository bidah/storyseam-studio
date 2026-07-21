import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const selectAudioRef = (api: Api) =>
  defineTool({
    name: "select_audio_ref",
    description:
      "Select or deselect a voice/sound reference for one episode bundle. Use list_audio_refs to see available references and their `rel` paths.",
    input: v.object({
      bundle: d(v.pipe(v.string(), v.minLength(1)), "Bundle id, e.g. MS-01."),
      rel: d(v.pipe(v.string(), v.minLength(1)), "Project-relative path of the voice reference."),
      selected: d(v.boolean(), "true to add, false to remove."),
    }),
    async run({ input, signal }) {
      const { bundle, rel, selected } = input;
      return await api.post("/api/episode/audio-select", { bundle, rel, selected }, signal);
    },
  });
