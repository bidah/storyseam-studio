import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const attachSound = (api: Api) =>
  defineTool({
    name: "attach_sound",
    description:
      "Attach a rendered audio file to a pending sound version — from a remote URL (downloaded) or a local file path (copied). Flips the version to 'ready', probes its duration, and makes it play in the UI. This is the final step of the render→attach loop after generating with the seed-audio skill.",
    input: v.object({
      id: d(v.pipe(v.string(), v.minLength(1)), "Track id, e.g. trk_2."),
      v: d(v.pipe(v.number(), v.integer(), v.minValue(1)), "Version number to attach to."),
      url: v.optional(d(v.pipe(v.string(), v.url()), "Remote URL of the rendered audio (mp3/wav/…).")),
      localPath: v.optional(d(v.string(), "Absolute local path to the rendered audio file.")),
    }),
    async run({ input, signal }) {
      const { id, v, url, localPath } = input;
      return await api.post(
        `/api/sounds/${encodeURIComponent(String(id))}/version/${v}/attach`,
        { url, localPath },
        signal,
      );
    },
  });
