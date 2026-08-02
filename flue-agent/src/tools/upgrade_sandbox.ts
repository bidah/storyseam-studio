// Escalate this conversation from the free in-memory filesystem to a persistent
// Daytona container — the agent's own way out when local exec runs out of road.
//
// Mounted ONLY when DAYTONA_API_KEY is set (Daytona is paid and shared), and it
// does not replace Settings › Sandbox: both write the SAME per-conversation key
// (lib/sandbox-prefs.ts), so the author's toggle overwrites an escalation on the
// very next send. One source of truth, and the switch stays theirs.
//
// The swap lands on the NEXT message, not this turn: `useSandbox`'s factory is
// read when a submission initializes, and only the hook's PRESENCE is re-read at
// turn boundaries. We stay attached either way, so nothing is announced to the
// model automatically — which is why the returned text says so plainly.
import { defineTool } from "@flue/runtime";
import { getCloudflareContext } from "@flue/runtime/cloudflare";
import type { Json } from "../lib/api.js";
import { writeSandboxMode } from "../lib/sandbox-prefs.js";

export const upgradeSandbox = () =>
  defineTool({
    name: "upgrade_sandbox",
    description:
      "Move this conversation onto a persistent Linux sandbox. Call it when local execution has failed FOR WANT OF RESOURCES — an ffmpeg mix that ran out of memory, a binary that isn't installed, a download too large for the in-memory filesystem, or a file that has to survive to a later message. Do NOT call it for an ordinary command error, a typo, or a wrong path: those fail the same way on both. It takes effect on the author's NEXT message, not this turn, and files staged in the current environment do not come across — so finish or abandon what you were doing before you rely on it, and tell the author what you needed it for.",
    async run(): Promise<{ output: Record<string, Json> }> {
      try {
        writeSandboxMode(getCloudflareContext().storage.sql, "daytona");
      } catch (error) {
        // Say so rather than claiming an upgrade that didn't persist — the
        // model would otherwise plan the next turn around a container that
        // isn't coming.
        return {
          output: {
            upgraded: false,
            error: `Could not switch this conversation to a persistent sandbox: ${
              error instanceof Error ? error.message : String(error)
            }. Ask the author to flip Settings › Sandbox to "daytona" instead.`,
          },
        };
      }
      return {
        output: {
          upgraded: true,
          effective: "next message",
          note: "This conversation will run on a persistent Linux sandbox from the author's next message onward. It is NOT active yet — the current environment is still the in-memory one, and nothing staged in it carries over. Do not retry the failed command this turn. Tell the author what needed the upgrade, and re-stage any files after they reply.",
        },
      };
    },
  });
