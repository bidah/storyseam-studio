import { defineTool } from "@flue/runtime";
import type { Api, Json } from "../lib/api.js";

interface ScriptState {
  title?: string;
  proposal?: {
    proposedDoc?: unknown;
    proposedTitle?: string | null;
    note?: string | null;
  } | null;
}

export const applyScriptProposal = (api: Api) =>
  defineTool({
    name: "apply_script_proposal",
    description:
      "Commit (accept) the pending script proposal in full, applying every proposed change to the PINNED draft — the same as the user hitting 'Accept all' on the Script tab's diff view. Use ONLY after the user has explicitly confirmed in chat that they want the change applied (propose with save_script/append_script first, then ask for confirmation, then call this). Accepts the whole proposal; for cherry-picking individual lines, point the user to the per-line Accept/Reject controls on the Script tab. Accepting invalidates the draft's sign-off (it must be re-signed before a shot list can be regenerated).",
    async run({ signal }) {
      const cur = (await api.get("/api/script", signal)) as unknown as ScriptState;
      const proposal = cur.proposal;
      if (!proposal) {
        return {
          output: {
            ok: false,
            error:
              "There's no pending proposal to apply. Propose a change first (save_script / append_script), or the user may have already accepted or discarded it on the Script tab.",
          } as Json,
        };
      }
      const title =
        typeof proposal.proposedTitle === "string"
          ? proposal.proposedTitle
          : cur.title ?? "";
      await api.post(
        "/api/script/proposal/accept",
        { doc: proposal.proposedDoc ?? null, title },
        signal,
      );
      return { output: { ok: true, applied: true, title } as Json };
    },
  });
