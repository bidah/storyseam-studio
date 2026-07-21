import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const selectReference = (api: Api) =>
  defineTool({
    name: "select_reference",
    description:
      "Select or deselect a final-selection image as a chosen reference for one episode bundle. `rel` is the image's project-relative path.",
    input: v.object({
      bundle: d(v.pipe(v.string(), v.minLength(1)), "Bundle id, e.g. MS-01."),
      rel: d(
        v.pipe(v.string(), v.minLength(1)),
        "Project-relative path of the image.",
      ),
      selected: d(v.boolean(), "true to add, false to remove."),
    }),
    async run({ input, signal }) {
      const { bundle, rel, selected } = input;
      return await api.post(
        "/api/episode/select",
        { bundle, rel, selected },
        signal,
      );
    },
  });
