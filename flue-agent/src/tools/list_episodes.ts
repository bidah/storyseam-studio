import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

export const listEpisodes = (api: Api) =>
  defineTool({
    name: "list_episodes",
    description:
      "List the episodes of a SERIES project — each `{ id, number, title }` plus `activeId` (the episode in play) and `format`. A feature film returns the single default episode (\"ep1\"). Use it to see the series structure before referencing or creating an episode. NOTE: everything downstream of the script (shot list, animatic, cut) is per-episode; this conversation is bound to ONE episode (the one it was started on), so your other tools act on that episode, not on whichever you list here.",
    async run({ signal }) {
      return { output: await api.get("/api/episodes", signal) };
    },
  });
