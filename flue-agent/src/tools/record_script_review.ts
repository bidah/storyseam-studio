import { defineTool } from "@flue/runtime";
import * as v from "valibot";
import { d } from "./_util.js";
import type { Api, Json } from "../lib/api.js";

// The specialists' own log book. Each script doctor calls this as its LAST act,
// so the app and the root agent can tell "plot-doctor has never read this
// script" from "plot-doctor cleared it an hour ago" — the state the chat's
// suggestion cards use to offer the doctor that hasn't looked yet. The draft and
// revision are snapshotted worker-side from the pinned draft, so a pass can only
// ever be stamped onto what the doctor actually read.
export const recordScriptReview = (api: Api) =>
  defineTool({
    name: "record_script_review",
    description:
      "Log that you finished a pass over the script. Call this ONCE as the LAST thing you do, after you have delivered your findings — including when you found nothing to fix (a clean pass is a real result and must be recorded too). It writes no script content and changes nothing the user sees in the editor; it only records that this specialist read this revision, which is what stops the app from suggesting the same review over and over. The pass is invalidated automatically when the script is next edited, so never worry about 'is it still valid' — just record what you did.",
    input: v.object({
      specialist: d(
        v.picklist([
          "story_architect",
          "motivation_doctor",
          "plot_doctor",
          "dialogue_doctor",
        ]),
        "Your own name — the specialist that just ran.",
      ),
      summary: d(
        v.string(),
        "One line, in plain language, on what this pass concluded — shown to the user as the review's headline (e.g. \"Act 2 sags: the midpoint reversal lands 8 pages late\"). Max 600 chars.",
      ),
      findings: d(
        v.optional(v.number()),
        "How many distinct issues you raised (0 for a clean pass).",
      ),
    }),
    async run({ data: input, signal }) {
      const { specialist, summary, findings } = input as {
        specialist: string;
        summary: string;
        findings?: number;
      };
      const res = (await api.post(
        "/api/script/reviews",
        { specialist, summary, findings },
        signal,
      )) as unknown as { entry?: { draftName?: string } };
      return {
        output: {
          ok: true,
          recorded: specialist,
          draft: res?.entry?.draftName ?? null,
        } as Json,
      };
    },
  });
