import { defineTool } from "@flue/runtime";
import type { Api } from "../lib/api.js";

// The Script Agents ledger, in full. `get_script` and `get_status` both carry a
// small `reviews` block (the three buckets and the latest headline) because they
// are read on every screen's first paint and must stay cheap; THIS is the
// detailed read — pass counts, structured notes, and the per-specialist history
// that shows whether the script is getting better. The `script-agents` skill is
// built on it.
export const getScriptReviews = (api: Api) =>
  defineTool({
    name: "get_script_reviews",
    description:
      "The script's review board — THE tool for \"what have we done to the script\", \"which agents/doctors have already run\", \"who hasn't read it yet\", \"what's next for the script\", \"how do I continue\", \"show me the script agents\". Read it BEFORE proposing any specialist pass, and before claiming a pass did or didn't happen. Returns the whole roster (each specialist's id, lane — `core` is the ordered spine, `ondemand` is opt-in and never pushed — `stage`, chip, label, title, what it does, and its brief) plus every specialist bucketed against the PINNED draft's current revision: `pending` (never run), `stale` (ran, but the script has been edited since, so its findings point at text that no longer exists) and `fresh` (read this exact revision). `latest[<id>]` carries that pass's summary, findings count, structured `notes` ({severity, where, issue, fix}), when it ran and which draft it read; `passes[<id>]` is the lifetime number of times it has run, and `history[<id>]` is its previous passes newest-first — a specialist going 9 findings → 4 → 1 is visible there. Also returns `draftId` / `draftName` / `scriptUpdatedAt` (the revision everything is measured against) and `totals`. get_script and get_status return a SMALLER `reviews` block; this is the detailed one — use it whenever you are drawing the board or deciding the next pass.",
    async run({ signal }) {
      return { output: await api.get("/api/script/reviews", signal) };
    },
  });
