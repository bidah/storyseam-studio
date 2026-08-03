import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api } from "../lib/api.js";
import { consumeApproval, gateAction } from "../lib/approval.js";

// Gated behind the author's go-ahead (lib/approval.ts). The stitch itself is
// additive — it mints complete_cut_vN+1 and never overwrites an earlier cut —
// but it is the moment the episode becomes "the thing you send someone", it
// bakes in whichever take is selected on every single bundle, and it is minutes
// of ffmpeg. An agent that decides on its own that the cut looks ready hands the
// author a finished-looking artefact built from picks they never reviewed, which
// reads as done and isn't. So the segment count and the take list go on a card
// first.
const OP = "stitch_cuts";

type Segment = { bundle?: string; file?: string | null; duration?: number };

export const stitchCuts = (api: Api) =>
  defineTool({
    name: "stitch_cuts",
    description:
      "Stitch the selected take of every bundle (in order) into a NEW versioned complete-cut mp4 (complete_cut_vN.mp4) with ffmpeg — never overwrites a prior version, so the browser can't show a stale cached cut. If background music was added before, the fresh cut is automatically re-scored so the newest version keeps its music (carriedMusic=true). Returns { url, file, version, kind, carriedMusic, totalDuration, count }. Requires at least one rendered+selected take. GATED: the first call performs NOTHING — it returns `approved:false` with an `approvalToken` and the segment counts, and you must draw the confirm card (see the **destructive-approval** skill) and wait for the author before calling again with that token.",
    input: v.object({
      approval_token: v.optional(
        d(
          v.string(),
          "ONLY for the confirming second call, and ONLY after the author has actually said yes: the `approvalToken` a previous gated call returned. Never invent one and never reuse a spent one.",
        ),
      ),
    }),
    async run({ data: input, signal }) {
      const { approval_token } = input;

      if (approval_token) {
        await consumeApproval(api, approval_token, OP, signal);
        return { output: await api.post("/api/episode/stitch", undefined, signal) };
      }

      // The card must show the REAL plan, so read it here rather than letting
      // the model recite a count from an earlier turn — the selection may well
      // have moved since it last looked.
      const cuts = await api.get<{
        segments?: Segment[];
        output?: { file?: string; v?: number } | null;
      }>("/api/episode/cuts", signal);
      const segments = cuts?.segments ?? [];
      const usable = segments.filter((s) => s?.file);
      const seconds = usable.reduce((a, s) => a + (Number(s?.duration) || 0), 0);

      // No rendered take means the stitch would 400 anyway. Fail on the spot
      // instead of asking the author to approve something that cannot run.
      if (!usable.length) {
        throw new Error(
          "Nothing to stitch: no bundle has a rendered, selected take yet. Render and select takes first (get_cuts shows the plan).",
        );
      }

      return {
        output: await gateAction(
          api,
          {
            op: OP,
            summary: `Stitch ${usable.length} selected take(s) into a new complete cut (~${Math.round(seconds)}s). The existing cut is kept as an earlier version.`,
            params: null,
            facts: {
              "Bundles in the cut": String(usable.length),
              ...(segments.length > usable.length
                ? { "Bundles with no rendered take": String(segments.length - usable.length) }
                : {}),
              "Approx. length": `${Math.round(seconds)}s`,
              "Current cut": cuts?.output?.file ?? "none yet",
            },
          },
          signal,
        ),
      };
    },
  });
