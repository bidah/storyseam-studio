import { defineTool } from "eve/tools";
import { z } from "zod";
import { api } from "../lib/api.js";

interface ScriptState {
  title?: string;
  proposal?: {
    proposedDoc?: unknown;
    proposedTitle?: string | null;
    note?: string | null;
  } | null;
}

// The model sees this as `apply_script_proposal`. Commits the pending script
// proposal on the user's behalf — the same "Accept all" the user would click on
// the Script tab's diff view. This is the review gate crossing: ONLY call it once
// the user has explicitly confirmed in chat that they want the proposed change
// applied. It accepts the WHOLE proposal (every change); if the user wants to keep
// only some lines, direct them to the per-line Accept/Reject on the Script tab
// instead. A direct edit by the user or this tool is what commits a proposal.
export default defineTool({
  description:
    "Commit (accept) the pending script proposal in full, applying every proposed change to the PINNED draft — the same as the user hitting 'Accept all' on the Script tab's diff view. Use ONLY after the user has explicitly confirmed in chat that they want the change applied (propose with save_script/append_script first, then ask for confirmation, then call this). Accepts the whole proposal; for cherry-picking individual lines, point the user to the per-line Accept/Reject controls on the Script tab. Accepting invalidates the draft's sign-off (it must be re-signed before a shot list can be regenerated).",
  inputSchema: z.object({}),
  async execute() {
    const cur = await api<ScriptState>("/api/script");
    const proposal = cur.proposal;
    if (!proposal) {
      return {
        ok: false,
        error:
          "There's no pending proposal to apply. Propose a change first (save_script / append_script), or the user may have already accepted or discarded it on the Script tab.",
      };
    }
    const title =
      typeof proposal.proposedTitle === "string" ? proposal.proposedTitle : cur.title ?? "";
    await api("/api/script/proposal/accept", {
      method: "POST",
      body: { doc: proposal.proposedDoc ?? null, title },
    });
    return { ok: true, applied: true, title };
  },
});
