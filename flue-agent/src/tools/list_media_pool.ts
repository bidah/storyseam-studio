import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const listMediaPool = (api: Api) =>
  defineTool({
    name: "list_media_pool",
    description:
      "List the video editor's MEDIA POOL — every rendered video generation and every Sound Studio track's latest audio, i.e. the source clips an edit can be built from. This is what the Editor tab shows to the left of the player and drags onto the timeline. Returns { video, audio }, each item { id, mediaType, name, src, bundle? }: `src` is the value to put on an inserted clip ('/gen/<file>' for video, '/sound-media/<file>' for audio). Call this before building an edit clip by clip with edit_timeline's `insert` op — especially after new_editor_project, where the empty timeline has nothing to work from. NOTE: the pool carries no durations; take a shot's intended length from the Shot list's `dur` (get_shotlist / list_shots) rather than guessing.",
    async run({ signal }) {
      return { output: await api.get("/api/pool", signal) };
    },
  });
