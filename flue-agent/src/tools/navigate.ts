import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const navigate = (api: Api) =>
  defineTool({
    name: "navigate",
    description:
      "Move the author's open app to a tab — the counterpart to view_screen (which tells you where they ARE). Use it right after you make something they should look at: finish a shot list and send them to \"shotlist\", attach a still and send them to \"animatic\", stitch a cut and send them to \"cuts\". Views: world (sub \"visual\" or \"nodes\"), script, shotlist, radio, animatic, episode, cuts, editor, library, sounds, settings. `hash` scrolls to and flashes one item once the tab loads — \"ep-<bundleId>\" on episode, \"snd-<track>\" on sounds, \"locations\" on world. This is a REQUEST, not a guarantee: it reaches whatever tabs are open right now, and none may be, so never describe the result as though you watched their screen — say what you did, not what they are now seeing. Use it sparingly and only when there is something specific to see; yanking someone off the tab they are working on is worse than a sentence telling them where to look.",
    input: v.object({
      view: d(
        v.picklist([
          "world",
          "script",
          "shotlist",
          "radio",
          "animatic",
          "shots",
          "multishot",
          "episode",
          "cuts",
          "editor",
          "library",
          "sounds",
          "settings",
        ]),
        "The tab to open.",
      ),
      sub: v.optional(
        d(
          v.picklist(["visual", "nodes"]),
          'Sub-view, only for `view: "world"` — "visual" for the Visual World board, "nodes" for the node graph.',
        ),
      ),
      hash: v.optional(
        d(
          v.string(),
          'Anchor to scroll to and flash once the tab has loaded, e.g. "ep-b3", "snd-rain", "locations". Omit to land at the top.',
        ),
      ),
      reason: v.optional(
        d(
          v.string(),
          "One short phrase on why you are sending them there, e.g. \"the 12 new shots\". Recorded with the command; keep it under a dozen words.",
        ),
      ),
    }),
    async run({ input, signal }) {
      return await api.post("/api/navigate", input, signal);
    },
  });
