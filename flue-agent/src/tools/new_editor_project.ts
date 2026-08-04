import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const newEditorProject = (api: Api) =>
  defineTool({
    name: "new_editor_project",
    description:
      "Start a NEW, EMPTY project in the video editor timeline — one picture track and one audio track, no clips. This is the way into the Editor that is NOT derived from an existing cut, radio version or animatic: use it when the user wants to 'start a new project', 'start from scratch', 'build an edit from nothing', 'empty the timeline', or assemble a cut clip by clip from the media pool instead of loading a stitched cut. It REPLACES whatever timeline is currently loaded (the previous one stays in the document history, restorable with restore_version), so only call it when the user asked to start fresh — to keep their edit, use edit_timeline instead. Pass `name` when the user named the project (or ask them what to call it first); it shows in the Editor header and `edit_timeline`'s rename op changes it later. Optional fps/width/height pick the project format (default 24fps 1280×720; pass 1080×1920 for vertical). Returns { ok, timeline }.",
    input: v.object({
      name: v.optional(
        d(
          v.string(),
          "What to call the project — shown in the Editor header. Defaults to 'Untitled project'.",
        ),
      ),
      fps: v.optional(
        d(v.pipe(v.number(), v.integer()), "Frames per second (default 24)."),
      ),
      width: v.optional(
        d(v.pipe(v.number(), v.integer()), "Frame width in pixels (default 1280)."),
      ),
      height: v.optional(
        d(v.pipe(v.number(), v.integer()), "Frame height in pixels (default 720)."),
      ),
    }),
    async run({ data: input, signal }) {
      return { output: await api.post("/api/timeline/new", input, signal) };
    },
  });
