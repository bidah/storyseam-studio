import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";

export const navigate = (api: Api) =>
  defineTool({
    name: "navigate",
    description:
      "Move the author's open app to a tab — the counterpart to view_screen (which tells you where they ARE). Use it right after you make something they should look at: finish a shot list and send them to \"shotlist\", attach a still and send them to \"animatic\", stitch a cut and send them to \"cuts\". Views: the three core surfaces — world (the Bible), script, editor — plus any plugin this project has INSTALLED: episode (pre-installed), agents, moodboard, shotlist, images (image generation), videos (video generation), nodes (the visual node canvas), animatic, radio, sounds, musical, cuts, library. Plus \"plugins\" (the marketplace) and \"settings\". Sending someone to a plugin they have not installed lands them on its install prompt, not on the work — so check `get_status.plugins` first and offer the install instead (see the plugin-gate skill). `hash` scrolls to and flashes one item once the tab loads — \"ep-<bundleId>\" on episode, \"snd-<track>\" on sounds, \"locations\" on world. This is a REQUEST, not a guarantee: it reaches whatever tabs are open right now, and none may be, so never describe the result as though you watched their screen — say what you did, not what they are now seeing. Use it sparingly and only when there is something specific to see; yanking someone off the tab they are working on is worse than a sentence telling them where to look.",
    input: v.object({
      view: d(
        v.picklist([
          // Core — always present.
          "world",
          "script",
          "episode",
          "editor",
          // Plugins — routed for every project, but gated on being installed.
          "agents",
          "moodboard",
          "shotlist",
          "images",
          "videos",
          "nodes",
          "animatic",
          "radio",
          "sounds",
          "musical",
          "cuts",
          "library",
          // Chrome, and the two hidden sample-code surfaces.
          "plugins",
          "settings",
          "shots",
          "multishot",
        ]),
        "The tab to open.",
      ),
      // No surface has sub-views any more: the World tab's old "visual" /
      // "nodes" sub-tabs are top-level surfaces of their own ("images" and
      // "nodes"). Kept in the input, and folded by the worker, only so a plan
      // written before the split still resolves instead of erroring.
      sub: v.optional(
        d(
          v.picklist(["visual", "nodes", "agents"]),
          'DEPRECATED. Was a sub-view of `view: "world"`; those are now top-level views ("images", "nodes", "agents"). Pass the top-level view instead — this is only still accepted so older plans keep working.',
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
    async run({ data: input, signal }) {
      return { output: await api.post("/api/navigate", input, signal) };
    },
  });
