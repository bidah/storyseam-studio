import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const getMoodboard = (api: Api) =>
  defineTool({
    name: "get_moodboard",
    description:
      "Read the project's Moodboard — the reference wall the author builds before anything is generated: sticky notes, reference images, video clips and unfurled links, each with its position on the canvas. Call it before adding anything (so you don't duplicate a reference that's already up there) and whenever the author asks what the look or tone of the episode is — the moodboard is usually where that lives before it reaches the World bible. Returns every card with its id, type, position, and text/url; image and video cards carry only their stored file name, because you cannot see the picture — describe them by what the author wrote next to them, never by guessing at the image.",
    input: v.object({}),
    async run({ signal }) {
      return { output: await api.get("/api/moodboard", signal) };
    },
  });
