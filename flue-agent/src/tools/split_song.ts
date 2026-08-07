import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api, Json } from "../lib/api.js";

// The cut runs on a Daytona sandbox (ffmpeg + numpy), so it's a detached job:
// POST starts it, GET /api/musical/job/:id polls and — the first time it sees
// the job done — finalizes the doc (upserts the cut segments by label). This
// tool starts the job and polls to completion so the model gets the segments
// back in one call. A cold sandbox image build makes the FIRST split slow
// (~1 min); afterwards it's a few seconds.
const POLL_MS = 3000;
const MAX_POLLS = 90; // ~4.5 min ceiling, then hand back a jobId to re-poll

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
  });

export const splitSong = (api: Api) =>
  defineTool({
    name: "split_song",
    description:
      "Cut the uploaded song into shot-length audio segments on real breath gaps in the vocal stem (the DSP the Musical tab needs, run on Daytona). Requires that the author has uploaded BOTH a vocal stem and a full mix (check get_musical first). Omit `boundaries` for an automatic split that packs phrases onto detected gaps so each shot ≤ cap (default 15s); pass explicit ascending `boundaries` in seconds to REFINE a split by hand (e.g. after listening, to move a held note or a pickup word into the next shot). Re-splitting REPLACES the segments (relabelled 01..NN), so re-author afterwards. Returns the cut segments with their timecodes and playable vocal/mix URLs. If the job is still running when this returns `status:\"running\"`, call split_song again with the returned `jobId` (and no other args) to keep polling — do NOT call it fresh, which starts a second cut.",
    input: v.object({
      capSec: d(v.optional(v.pipe(v.number(), v.minValue(3), v.maxValue(30))), "Max shot length in seconds (default 15). Confirm the target tool's cap with the author — Seedance and Kling differ."),
      boundaries: d(v.optional(v.array(v.pipe(v.number(), v.minValue(0)))), "Explicit cut points in seconds, ascending, to refine the split by hand. Omit for an automatic gap-based split. 0 and the song end are added for you."),
      labels: d(v.optional(v.array(v.string())), "Optional per-shot labels (e.g. [\"01\",\"02\",\"03\"]); defaults to 01..NN. One per shot (= boundaries.length - 1)."),
      jobId: d(v.optional(v.string()), "Only to KEEP POLLING an already-started split that returned status:\"running\". When set, all other args are ignored and no new cut is started."),
    }),
    async run({ data: input, signal }): Promise<{ output: Record<string, Json> }> {
      let jobId = input.jobId;
      if (!jobId) {
        const started = (await api.post(
          "/api/musical/split",
          { capSec: input.capSec, boundaries: input.boundaries, labels: input.labels },
          signal,
        )) as { jobId?: string; error?: string };
        if (!started?.jobId) return { output: { status: "error", error: started?.error || "Could not start the split" } };
        jobId = started.jobId;
      }

      for (let i = 0; i < MAX_POLLS; i++) {
        await sleep(POLL_MS, signal);
        const st = (await api.get(`/api/musical/job/${jobId}`, signal)) as {
          status?: string; segments?: Json; error?: string; forcedCuts?: number;
        };
        if (st.status === "done") {
          return { output: { status: "done", jobId, segments: st.segments ?? [], forcedCuts: st.forcedCuts ?? 0 } };
        }
        if (st.status === "error") {
          return { output: { status: "error", jobId, error: st.error || "The cut job failed" } };
        }
      }
      return {
        output: {
          status: "running",
          jobId,
          note: "Still cutting. Call split_song again with this jobId (and no other args) to keep polling.",
        },
      };
    },
  });
