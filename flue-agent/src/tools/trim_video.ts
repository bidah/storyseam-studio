import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const trimVideo = (api: Api) =>
  defineTool({
    name: "trim_video",
    description:
      "Trim a rendered episode take to a sub-range [from,to] seconds with ffmpeg, saving the result as a NEW 'trim' version ALONGSIDE the original (the source take is never overwritten — it stays in history and stays selectable). The trim appears as an extra selectable card in the bundle's video carousel with a TRIM VERSION badge, and can be picked for stitching like any other take. Returns { url, file, name, kind, trim, count }.",
    input: v.object({
      bundle: d(v.string(), "Bundle id, e.g. MS-01"),
      sourceFile: d(
        v.string(),
        "The `file` of the take to trim, e.g. MS-01_gen2.mp4 (from get_cuts / the episode video list)",
      ),
      from: d(
        v.pipe(v.number(), v.minValue(0)),
        "Trim start in seconds (clamped to the clip)",
      ),
      to: d(
        v.pipe(v.number(), v.minValue(0), v.notValue(0)),
        "Trim end in seconds; must be at least 0.1s after `from`",
      ),
    }),
    async run({ input, signal }) {
      const { bundle, sourceFile, from, to } = input;
      return await api.post(
        "/api/episode/trim",
        { bundle, sourceFile, from, to },
        signal,
      );
    },
  });
