import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const renameSound = (api: Api) =>
  defineTool({
    name: "rename_sound",
    description: "Rename a Sound Studio track.",
    input: v.object({
      id: d(v.pipe(v.string(), v.minLength(1)), "Track id, e.g. trk_2."),
      name: d(v.pipe(v.string(), v.minLength(1)), "New track name."),
    }),
    async run({ data: input, signal }) {
      const { id, name } = input;
      return {
        output: await api.req(
          `/api/sounds/${encodeURIComponent(String(id))}`,
          "PATCH",
          { name },
          signal,
        ),
      };
    },
  });
